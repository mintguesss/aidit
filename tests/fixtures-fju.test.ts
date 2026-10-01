import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import { fixture } from "@/lib/providers/fixtures";
import { offeringsFor } from "@/lib/offerings";

/**
 * 輔大資管 111 的示範學生（真實成績單，只有課名、學分、學期）跑真實規則。
 *
 * 執行期用的是 Supabase 上鎖版的規則包；這裡用 repo 裡的草稿副本 —— 內容與鎖版的 v0.6 相同，
 * 只差 provenance 與校對人。期望值照規則手算，算式寫在每個 it 裡。
 */

const pack = zRulePack.parse({
  ...JSON.parse(readFileSync("docs/review/fju-im-111.draft.json", "utf8")),
  provenance: "approved",
  approvedBy: "測試",
});

function audit(id: "fju-im-111-full" | "fju-im-111-year2", currentTerm: string, nextTerm: string) {
  const a = auditCredits({ record: fixture(id).record, pack, traceId: `t-${id}`, currentTerm, nextTerm });
  expect(a.countable + a.inProgress + a.unmet).toBe(a.minCredits);
  const cat = (cid: string) => a.categories.find((x) => x.id === cid)!;
  const check = (cid: string) => a.graduationChecks.find((x) => x.id === cid)!;
  return { a, cat, check };
}

describe("四年修完（成績單 138 學分）", () => {
  const { a, cat, check } = audit("fju-im-111-full", "114-2", "115-1");

  it("每一類都滿足，可採計 128", () => {
    for (const c of a.categories) expect(c.unmet, c.id).toBe(0);
    expect(a.countable).toBe(128);
  });

  it("全人核心 8 ＝ 大學入門 2 ＋ 人生哲學 4（全學年，上下各 2）＋ 專業倫理-企業倫理 2", () => {
    expect(cat("holistic-core").earned).toBe(8);
  });

  it("基本能力 12 ＝ 國文 4 ＋ 外國語文(中級英文) 4 ＋ 外國語文(基礎日文) 4 —— 開頭比對", () => {
    expect(cat("basic-skills").earned).toBe(12);
  });

  it("院系必修 64：18 門全到，含五門全學年課程上下學期", () => {
    expect(cat("dept-required").earned).toBe(64);
  });

  it("通識修了 14，規定 12：多的 2 學分不算畢業學分（超修的全人教育課程）", () => {
    expect(cat("general").earned).toBe(12);
    expect(cat("general").overflow).toBe(2);
  });

  it("通識三領域各至少 4 學分：人文與藝術 4、自然與科技 6、社會科學 4", () => {
    const s = cat("general").subRules.find((x) => x.id === "general-domains")!;
    expect(s.status).toBe("satisfied");
  });

  it("系專選 10 由資管系開的選修補滿；外系、學程的課（-網）只能算其他選修", () => {
    expect(cat("major-elective").earned).toBe(10);
    expect(cat("free-elective").earned).toBe(22);
  });

  it("國防看成績單：上下學期各一次 → 通過；體育 4 學期、英語授課 6 學分 → 通過", () => {
    expect(check("defense-education").status).toBe("satisfied");
    expect(check("pe").status).toBe("satisfied");
    expect(check("emi").status).toBe("satisfied");
  });

  it("成績單看不出來的照實列待確認，不推定通過：資訊能力、英文 B2、程式機測、導師時間", () => {
    for (const id of ["info-test", "english", "programming-test", "advisor-time"]) {
      expect(check(id).status, id).toBe("hold");
    }
  });
});

describe("大二結束、準備升大三（只到 112-2）", () => {
  const { a, cat, check } = audit("fju-im-111-year2", "112-2", "113-1");

  it("院系必修 52/64：還缺作業系統、資訊系統專題一二、管理資訊系統（各 3）", () => {
    expect(cat("dept-required").earned).toBe(52);
    expect(cat("dept-required").unmet).toBe(12);
  });

  it("全人核心只有大學入門 2：人生哲學 4、專業倫理 2 還沒修", () => {
    expect(cat("holistic-core").earned).toBe(2);
    expect(cat("holistic-core").unmet).toBe(6);
  });

  it("基本能力 12 已滿", () => {
    expect(cat("basic-skills").unmet).toBe(0);
  });

  it("通識 8/12，社會科學一門都還沒有", () => {
    expect(cat("general").earned).toBe(8);
    const s = cat("general").subRules.find((x) => x.id === "general-domains")!;
    expect(s.status).toBe("unmet");
  });

  it("資管系選修 14 學分全部採計（系專選＋其他選修）", () => {
    expect(cat("major-elective").earned + cat("free-elective").earned).toBe(14);
  });

  // 已知問題（TODO H9）：原文是「選修課程中**包含**本系專業選修至少 10 學分」，規則包卻建成
  // 「系專選 10」＋「其他選修 22」兩個切開的類別。課不能拆，2＋3＋3＋3＋3 湊不出剛好 10，
  // 引擎只能給 8 或 9，畫面就說「系專選還差」—— 其實 14 ≥ 10 已經滿足。要改規則包的結構
  it.todo("修了 14 學分本系選修，系專選（選修中至少 10 學分本系）應判定滿足");

  it("總共還缺 128 − 88 ＝ 40", () => {
    expect(a.countable).toBe(88);
    expect(a.unmet).toBe(40);
  });

  it("英語授課還沒修 → 未達；體育已滿 4 學期 → 通過", () => {
    expect(check("emi").status).toBe("unmet");
    expect(check("pe").status).toBe("satisfied");
  });

  it("下學期 113-1 有真實開課資料可排", () => {
    const t = offeringsFor(113, 1, "fju");
    expect(t.length).toBeGreaterThan(600);
    for (const code of ["01558", "04317"]) expect(t.some((o) => o.code === code), code).toBe(true);
  });
});

describe("示範資料不含成績與個資", () => {
  it("每一筆成績都是 null", () => {
    for (const id of ["fju-im-111-full", "fju-im-111-year2"] as const) {
      expect(fixture(id).record.courses.every((c) => c.score === null)).toBe(true);
    }
  });
});

describe("真實資料做出來的引擎問題（修正後不得再出現）", () => {
  it("合成資料的公告不會套到輔大學生身上（兩邊都有 general、english 這兩個 id）", async () => {
    const { ruleConflict } = await import("@/lib/agent/tools/rule");
    expect(ruleConflict(pack)).toEqual([]);
  });

  it("畢業條件還有待確認時，結論不能只寫「已符合畢業學分條件」", () => {
    const { a } = audit("fju-im-111-full", "114-2", "115-1");
    expect(a.verdict.headline).toBe("學分條件已符合，另有待確認事項");
    expect(a.verdict.detail).toContain("畢業條件待確認");
  });

  it("超修的說明寫出是哪幾類 —— 不是全部叫「自由選修超修」：通識多修的 2 學分要寫出來", () => {
    const { a } = audit("fju-im-111-full", "114-2", "115-1");
    expect(a.verdict.detail).toContain("通識涵養課程 2");
    expect(a.verdict.detail).not.toContain("自由選修超修");
  });
});

describe("大二結束：113-1 選課建議", async () => {
  const { solve, requirementsFrom, constraintsFrom, reservedFrom } = await import("@/lib/solver/schedule");
  const { takenCourseCodes } = await import("@/lib/solver/taken");
  const { termLimitsFor } = await import("@/lib/rules/term-limits");
  const { preferencesOf } = await import("@/lib/chat/apply");

  const rec = fixture("fju-im-111-year2").record;
  const { a } = audit("fju-im-111-year2", "112-2", "113-1");
  const prefs = preferencesOf(rec.preferences);
  const limits = termLimitsFor(pack, rec.student, "113-1");
  const reqs = requirementsFrom(a);
  const r = solve({
    offerings: offeringsFor(113, 1, "fju"),
    requirements: reqs,
    passedCodes: new Set(rec.courses.map((c) => c.code)),
    takenCodes: takenCourseCodes(rec.courses, pack),
    reserved: reservedFrom(rec.plannedCommitments),
    preferences: prefs,
    constraints: constraintsFrom(prefs, limits),
    termLabel: "113-1",
    termMinCredits: limits.minCredits,
    termMaxCredits: limits.maxCredits,
  });
  const plan = r.ok ? r.plans[0]! : null;

  it("以學分判定的通識領域也變成排課需求：社會科學還差 4 學分", () => {
    expect(reqs.find((x) => x.domain === "社會科學")?.minCredits).toBe(4);
  });

  it("排得出課表，而且不含修過的課（微積分、會計學、統計學）", () => {
    expect(plan).not.toBeNull();
    for (const code of ["02390", "02412", "02222", "02457"]) {
      expect(plan!.courses.some((c) => c.code === code), code).toBe(false);
    }
  });

  it("社會科學通識有排進來（以前以學分判定的領域需求被漏掉）", () => {
    const t = offeringsFor(113, 1, "fju");
    expect(plan!.courses.some((c) => t.find((o) => o.code === c.code)?.generalDomain === "社會科學")).toBe(true);
  });

  // 已知限制（TODO G4）：一學期最多排 6 門、目標是補最多學分，
  // 2 學分的人生哲學（必修）會被只補其他選修的 3 學分課擠掉。課表合法，但不像真人會排的
  it.todo("人生哲學（必修、2 學分）應優先於只補其他選修的 3 學分課");
});
