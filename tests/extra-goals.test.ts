import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/agent/runner";
import { registeredGoals, summariseExtraGoals } from "@/lib/extra/goals";
import { resolveDept } from "@/lib/offerings/depts";
import { resolveRulePack } from "@/lib/rules/loader";
import { solve, requirementsFrom, reservedFrom, constraintsFrom } from "@/lib/solver/schedule";
import { offeringsFor } from "@/lib/offerings";
import { preferencesOf } from "@/lib/chat/apply";
import {
  savePrefs,
  loadPrefs,
  deleteOptional,
  deletePrefs,
  isExpired,
} from "@/lib/store/prefs-store";
import { fixture } from "@/lib/providers/fixtures";

async function demo() {
  const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
  if (!run.ok) throw new Error("demo 應可完成審查");
  return { audit: run.audit, courses: fixture("demo").record.courses };
}

describe("額外修業目標", () => {
  it("系所對照：代碼、簡稱、全名都查得到；查不到就回 undefined，不猜", () => {
    expect(resolveDept("FN")?.code).toBe("FN");
    expect(resolveDept("財金")?.code).toBe("FN");
    expect(resolveDept("財務金融學系")?.code).toBe("FN");
    expect(resolveDept("不存在的系")).toBeUndefined();
  });

  it("列出相關的已修課程與學分小計，並標明目前計入本系哪一類別", async () => {
    const { audit, courses } = await demo();
    const [r] = summariseExtraGoals([{ kind: "double-major", target: "財金" }], courses, audit);
    expect(r!.dept?.code).toBe("FN");
    expect(r!.courses.length).toBeGreaterThan(0);
    expect(r!.credits).toBe(r!.courses.reduce((a, c) => a + c.credits, 0));
    // 每一門都要說得出目前計入本系的哪一類（或明確為未採計）
    for (const c of r!.courses) expect(typeof c.countedAs === "string" || c.countedAs === undefined).toBe(true);
  });

  it("已收錄規定時逐項算出應修／已修／未修，且每一項都附得出依據", async () => {
    const { audit, courses } = await demo();
    const rows = summariseExtraGoals(
      [
        { kind: "minor", target: "財金" },
        { kind: "double-major", target: "財金" },
        { kind: "cert-program", target: "資訊安全" },
      ],
      courses,
      audit,
    );
    for (const r of rows) {
      expect(r.rulesLoaded).toBe(true);
      const a = r.audit!;
      expect(a.requirements.length).toBeGreaterThan(0);
      // 每一項都要有可回查的原文
      for (const req of a.requirements) expect(req.citation.quote?.length ?? 0).toBeGreaterThan(3);
      // 不變式：各項應修加總 = 最低應修學分；已修 + 修課中 + 未修 = 最低應修學分
      expect(a.requirements.reduce((x, q) => x + q.required, 0)).toBe(a.minCredits);
      expect(a.earned + a.inProgress + a.unmet).toBe(a.minCredits);
    }
  });

  it("一門課不得同時滿足兩個項目", async () => {
    const { audit, courses } = await demo();
    const [r] = summariseExtraGoals([{ kind: "double-major", target: "財金" }], courses, audit);
    const a = r!.audit!;
    // 財金雙主修：demo 修過 FN3001、FN3002（必修）與 FN3003（選修）
    const req = a.requirements.find((x) => x.id === "required")!;
    const ele = a.requirements.find((x) => x.id === "elective")!;
    expect(req.earned).toBe(6);
    expect(ele.earned).toBe(3);
    expect(a.earned).toBe(9);
  });

  it("尚未收錄的項目不得出現「還差幾學分」這種數字", async () => {
    const { audit, courses } = await demo();
    const rows = summariseExtraGoals(
      [
        { kind: "minor", target: "機械" },
        { kind: "cert-program", target: "綠能科技" },
        { kind: "transfer", target: "財金" },
      ],
      courses,
      audit,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.rulesLoaded).toBe(false);
      expect(r.audit).toBeUndefined();
      expect((r.blocked ?? "").length).toBeGreaterThan(0);
      expect(r.needs.length).toBeGreaterThan(0);
    }
  });

  it("四種目標的名稱不得互相代用", async () => {
    const { audit, courses } = await demo();
    const rows = summariseExtraGoals(
      [
        { kind: "minor", target: "財金" },
        { kind: "double-major", target: "財金" },
        { kind: "transfer", target: "財金" },
      ],
      courses,
      audit,
    );
    expect(rows.map((r) => r.kindLabel)).toEqual(["輔系", "雙主修", "轉系"]);
    // 需要補齊的資料也各自不同
    expect(new Set(rows.map((r) => r.needs.join()))).toHaveProperty("size", 3);
  });
});

describe("轉系生", () => {
  it("未完成學分採計認定：全案轉人工，並說明為什麼不能推導", async () => {
    const r = resolveRulePack(fixture("transfer-student").record.student);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("admission_year_mismatch");
      expect(r.detail).toContain("尚未取得學分採計認定結果");
    }
  });

  it("已完成認定：依轉入學系的規劃表正常判定", async () => {
    const rec = fixture("transfer-approved").record;
    const r = resolveRulePack(rec.student, rec.transferApproval);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pack.dept).toBe(rec.student.dept);

    const run = await runAudit({
      providerKind: "mock",
      fixture: "transfer-approved",
      currentTerm: "114-2",
    });
    expect(run.ok).toBe(true);
    if (run.ok) {
      // 認定文件要出現在執行紀錄裡，承辦人才查得到判定是建立在哪一份認定上
      const step = run.trace.steps.find((s) => s.name === "resolveRuleVersion")!;
      expect(step.summary).toContain("IM-TR-113-0007");
      // 不變式與一般案例一樣必須成立
      expect(run.audit.countable + run.audit.inProgress + run.audit.unmet).toBe(run.audit.minCredits);
    }
  });

  it("認定結果只在轉入學系相符時才生效，不得用來繞過版本綁定", () => {
    const rec = fixture("transfer-approved").record;
    const wrong = { ...rec.transferApproval!, toDept: "FN" };
    expect(resolveRulePack(rec.student, wrong).ok).toBe(false);
    expect(resolveRulePack(rec.student, { ...rec.transferApproval!, accepted: [] }).ok).toBe(false);
  });
});

describe("隱私分層：選填只影響排序，不影響任何判定", () => {
  it("同一組必填條件下，填不填選填都得到相同的可行性與學分", async () => {
    const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
    if (!run.ok) throw new Error("demo 應可完成審查");
    const rec = fixture("demo").record;
    const pack = resolveRulePack(rec.student);
    if (!pack.ok) throw new Error(pack.detail);

    const base = {
      offerings: offeringsFor(115, 1),
      requirements: requirementsFrom(run.audit),
      passedCodes: new Set(
        rec.courses.filter((c) => c.status === "passed" || c.status === "waived").map((c) => c.code),
      ),
      reserved: reservedFrom(rec.plannedCommitments),
      preferences: preferencesOf(rec.preferences),
      constraints: constraintsFrom(preferencesOf(rec.preferences), pack.pack.termLimits),
      termLabel: "115-1",
      termMinCredits: pack.pack.termLimits.minCredits,
      termMaxCredits: pack.pack.termLimits.maxCredits,
    };

    const without = solve(base);
    const with_ = solve({
      ...base,
      optional: {
        careerDirection: "資料分析",
        interestAreas: ["資料", "行銷"],
        avoidCourseTypes: ["實習"],
      },
    });

    expect(without.ok).toBe(with_.ok);
    if (!without.ok || !with_.ok) return;

    // 可行性、學分、未修學分完全不受選填影響
    expect(with_.plans[0]!.totalCredits).toBe(without.plans[0]!.totalCredits);
    expect(with_.plans[0]!.unmetAfter).toBe(without.plans[0]!.unmetAfter);
    expect(with_.plans.length).toBe(without.plans.length);
    // 選出來的課程集合也相同（只可能換順序）
    const set = (r: typeof without) =>
      r.ok ? [...new Set(r.plans.flatMap((p) => p.courses.map((c) => c.code)))].sort() : [];
    expect(set(with_)).toEqual(set(without));
  });

  it("選填偏好本身仍是確定性的：同樣輸入給同樣順序", async () => {
    const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
    if (!run.ok) throw new Error("demo 應可完成審查");
    const rec = fixture("demo").record;
    const pack = resolveRulePack(rec.student);
    if (!pack.ok) throw new Error(pack.detail);
    const ctx = {
      offerings: offeringsFor(115, 1),
      requirements: requirementsFrom(run.audit),
      passedCodes: new Set<string>(),
      reserved: reservedFrom(rec.plannedCommitments),
      preferences: preferencesOf(rec.preferences),
      constraints: constraintsFrom(preferencesOf(rec.preferences), pack.pack.termLimits),
      termLabel: "115-1",
      termMinCredits: pack.pack.termLimits.minCredits,
      termMaxCredits: pack.pack.termLimits.maxCredits,
      optional: { interestAreas: ["資料"], avoidCourseTypes: [] },
    };
    const a = solve(ctx);
    const b = solve(ctx);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.plans.map((p) => p.courses.map((c) => c.code))).toEqual(
        b.plans.map((p) => p.courses.map((c) => c.code)),
      );
    }
  });
});

describe("偏好的伺服器端儲存與刪除", () => {
  const hash = "0".repeat(32);
  const base = {
    required: { goal: "balanced" as const, avoidEarly: true, avoidDays: [], preferCompactDays: false, extraGoals: [] },
    optional: { careerDirection: "資料分析", interestAreas: ["機器學習"], avoidCourseTypes: [] },
    lastUsedAt: new Date().toISOString(),
  };

  it("存得進去、讀得回來", () => {
    expect(savePrefs(hash, base)).toBe(true);
    const v = loadPrefs(hash);
    expect(v?.optional.careerDirection).toBe("資料分析");
    deletePrefs(hash);
  });

  it("只刪選填：必填保留，系統仍可正常使用", () => {
    savePrefs(hash, base);
    expect(deleteOptional(hash)).toBe(true);
    const v = loadPrefs(hash);
    expect(v?.optional.careerDirection).toBeUndefined();
    expect(v?.optional.interestAreas).toEqual([]);
    expect(v?.required.goal).toBe("balanced");
    deletePrefs(hash);
  });

  it("全部刪除是真的刪掉，不是標記為已刪除", () => {
    savePrefs(hash, base);
    expect(deletePrefs(hash)).toBe(true);
    expect(loadPrefs(hash)).toBeNull();
  });

  it("畢業或離校時讀取即刪除", () => {
    savePrefs(hash, { ...base, status: "graduated" });
    expect(loadPrefs(hash)).toBeNull();
    savePrefs(hash, { ...base, status: "leave" });
    expect(loadPrefs(hash)).toBeNull();
  });

  it("12 個月未使用即刪除", () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 13);
    savePrefs(hash, base);
    // savePrefs 會蓋掉 lastUsedAt，所以直接驗判定函式
    expect(isExpired(old.toISOString())).toBe(true);
    expect(isExpired(new Date().toISOString())).toBe(false);
    deletePrefs(hash);
  });

  it("鍵必須是合法的 studentHash —— 不接受路徑穿越", () => {
    expect(savePrefs("../../etc/passwd", base)).toBe(false);
    expect(loadPrefs("../../etc/passwd")).toBeNull();
    expect(deletePrefs("not-a-hash")).toBe(false);
  });
});

describe("額外修業目標的來源", () => {
  it("一般生沒有額外修業目標", async () => {
    const run = await runAudit({ providerKind: "mock", fixture: "plain", currentTerm: "114-2" });
    if (!run.ok) throw new Error("plain 應可完成審查");
    const rec = fixture("plain").record;
    expect(registeredGoals(rec.student)).toEqual([]);
    expect(rec.preferences?.extraGoals ?? []).toEqual([]);
    expect(summariseExtraGoals([], rec.courses, run.audit, registeredGoals(rec.student))).toEqual([]);
  });

  it("有註冊的案例由學籍資料推導，不需要學生自己再宣告一次", () => {
    const minor = fixture("minor-student").record.student;
    expect(registeredGoals(minor)).toEqual([
      { kind: "minor", target: "FN" },
      { kind: "cert-program", target: "資訊安全" },
    ]);
    expect(registeredGoals(fixture("double-major").record.student)).toEqual([
      { kind: "double-major", target: "FN" },
    ]);
  });

  it("已註冊與自行宣告分得開，重複的不列兩次", async () => {
    const run = await runAudit({ providerKind: "mock", fixture: "double-major", currentTerm: "114-2" });
    if (!run.ok) throw new Error("double-major 應可完成審查");
    const rec = fixture("double-major").record;
    const reg = registeredGoals(rec.student);
    const rows = summariseExtraGoals(
      [
        { kind: "double-major", target: "FN" }, // 與已註冊重複
        { kind: "minor", target: "會計" }, // 自行宣告
      ],
      rec.courses,
      run.audit,
      reg,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.registered).toBe(true);
    expect(rows[1]!.registered).toBe(false);
  });
});
