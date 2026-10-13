import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import { fixture } from "@/lib/providers/fixtures";
import { activeCourseCodes, offeringsFor } from "@/lib/offerings";
import { ruleConflict, ruleReconcile, withAnnouncedEffects } from "@/lib/agent/tools";
import { LlmBudget } from "@/lib/llm/client";
import { buildContext } from "@/lib/chat/plan-turn";
import { constraintSetFrom, preferencesOf } from "@/lib/chat/apply";
import { solve } from "@/lib/solver/schedule";
import { classAllows, classProfileOf } from "@/lib/offerings/class-group";

/**
 * 第二個真實系所：輔大物理學系光電物理組 112 入學、大三結束（真實成績單，只取課名與及格與否）。
 * 規則包還是草稿，測試時暫時當成已核可。
 */

const read = (f: string) => zRulePack.parse({ ...JSON.parse(readFileSync(f, "utf8")), provenance: "approved", approvedBy: "t" });
const pack = read("tests/fixtures/rulepacks/fju-phoe-112.draft.json");
const im = read("tests/fixtures/rulepacks/fju-im-111.draft.json");
const rec = fixture("fju-phoe-112-year3").record;
const audit = (p = pack) =>
  auditCredits({ record: rec, pack: p, traceId: "t", currentTerm: "114-2", nextTerm: "115-1", activeCourseCodes: activeCourseCodes() });
const cat = (id: string) => audit().categories.find((c) => c.id === id)!;

describe("審查結果與成績單對得上", () => {
  it("已修得 111 學分（成績單學分累計 111），還差 17", () => {
    const a = audit();
    expect(a.countable).toBe(111);
    expect(a.unmet).toBe(17);
  });

  it("院系必修缺 5：光學沒過（3）、書報討論是大四的課（2）；暑修重修的近代物理、量子物理(一)有算", () => {
    expect(cat("dept-required").unmet).toBe(5);
    expect(cat("dept-required").assignedCodes).toEqual(expect.arrayContaining(["01751", "21639"]));
    expect(cat("dept-required").assignedCodes).not.toContain("01404");
  });

  it("群組必修 3 學分修滿；多修的群組課（統計物理、專題研究）改算選修，不白修", () => {
    expect(cat("group-required").unmet).toBe(0);
    expect(cat("free-elective").assignedCodes).toEqual(expect.arrayContaining(["18155", "04880", "04655"]));
  });

  it("選修 16／24，本系專業選修 11／13（物理系開的選修才算）", () => {
    const e = cat("free-elective");
    expect(e.earned).toBe(16);
    expect(e.subRules[0]!.detail).toContain("已修 11 學分，還差 2 學分");
  });

  it("通識缺人文與藝術 4 學分（停修的那門正好是人文）", () => {
    expect(cat("general").unmet).toBe(4);
    expect(cat("general").subRules[0]!.detail).toContain("人文與藝術");
  });

  it("歷史與文化學群：兩份文件寫的不一樣 → 待確認，說明寫出真正的原因", () => {
    const h = audit().holds.find((x) => x.id === "hold-check-history-culture")!;
    expect(h.body).toContain("兩份文件寫的不一樣");
    expect(h.body).not.toContain("各系自訂");
  });
});

describe("公告：只套到該套的系所與入學年", () => {
  it("物理系 113 起的新科目表對 112 入學生不適用；資管學生根本不會比對到它", async () => {
    const conflicts = ruleConflict(pack);
    const c = conflicts.find((x) => x.announcement.id === "fju-phoe-113-plan")!;
    const o = await ruleReconcile(c, rec.student, new LlmBudget());
    expect(o).toMatchObject({ resolved: true, appliesToStudent: false });
    expect(ruleConflict(im).some((x) => x.announcement.id === "fju-phoe-113-plan")).toBe(false);
  });
});

describe("下學期（115-1，大四上）排課", () => {
  it("排得到光學重修、書報討論、人文通識、本系選修；不會被當成要修資管的必修", async () => {
    const outs = await Promise.all(ruleConflict(pack).map((c) => ruleReconcile(c, rec.student, new LlmBudget())));
    const p = withAnnouncedEffects(pack, outs);
    const r = solve(buildContext(audit(p), rec, p, constraintSetFrom(preferencesOf(rec.preferences))));
    expect(r.ok).toBe(true);
    const plan = r.ok ? r.plans[0]! : null;
    const names = plan!.courses.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["光學", "書報討論"]));
    expect(plan!.courses.some((c) => c.categoryLabel.includes("通識"))).toBe(true);
    const imCodes = new Set(offeringsFor(115, 1, "fju").filter((o) => o.dept === "IM" && o.selectType === "required").map((o) => o.code));
    expect(plan!.courses.filter((c) => imCodes.has(c.code))).toEqual([]);
  });

  it("班級：光電的班、保留給光電物理的人生哲學可以修；保留給資管的不行", () => {
    const prof = classProfileOf(rec.student, pack.college);
    expect(classAllows("光電四", prof).ok).toBe(true);
    expect(classAllows("光電物理人哲", prof).ok).toBe(true);
    expect(classAllows("資管系人哲", prof).ok).toBe(false);
  });
});
