import { describe, it, expect } from "vitest";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import type { CourseRecord, StudentRecord, Term } from "@/lib/types";

/**
 * 全學年課程與「只有課名」的科目（docs/BACKEND.md §1 的延伸）。
 *
 * 兩者都是接上第一所真實學校（輔大資管）時才冒出來的：合成資料裡沒有全學年課，
 * 也沒有分組上課、規劃表不列課號的科目。這裡用最小的規則包隔離驗證，
 * 不碰 golden set —— golden set 綁著合成規則包，是 CI 的回歸基準。
 */

const cite = { docId: "plan", locator: "測試", quote: "測試用原文" };

const pack = zRulePack.parse({
  id: "test-year-long",
  dept: "IM",
  admissionYear: 111,
  program: "day",
  version: "0",
  approvedAt: "2026-10-01",
  provenance: "synthetic",
  minCredits: 20,
  college: "MGT",
  documents: [{ id: "plan", title: "測試規劃表" }],
  categories: [
    { id: "required", name: "院系必修", shortName: "必修", credits: 6, order: 1,
      match: { type: "courseList", codes: ["02390"] }, citation: cite },
    { id: "basic", name: "基本能力", shortName: "基本", credits: 4, order: 2,
      match: { type: "courseNames", names: ["國文"] }, citation: cite },
    { id: "free", name: "選修", shortName: "選修", credits: 10, order: 3,
      match: { type: "anyPassed" }, citation: cite },
  ],
  overflowPolicy: { free: { countsToTotal: true, transferable: false, citation: cite } },
  // 微積分：上、下學期共用 02390
  yearLongCourses: ["02390"],
  termLimits: { maxCredits: 25, minCredits: 9 },
});

function c(
  code: string,
  name: string,
  credits: number,
  year: number,
  term: Term,
  status: CourseRecord["status"] = "passed",
): CourseRecord {
  return { code, name, credits, year, term, status, selectType: "required", score: 80 };
}

function audit(courses: CourseRecord[]) {
  const record: StudentRecord = {
    student: { id: "S-TEST", dept: "IM", admissionYear: 111, actualAdmissionYear: 111,
      status: "enrolled", program: "day" },
    courses,
    fetchedAt: "2026-10-01T00:00:00Z",
    source: "mock",
  };
  const a = auditCredits({ record, pack, traceId: "t", currentTerm: "115-1", nextTerm: "115-2" });
  // 不變式照樣要成立
  expect(a.countable + a.inProgress + a.unmet).toBe(a.minCredits);
  return a;
}

const cat = (a: ReturnType<typeof audit>, id: string) => a.categories.find((x) => x.id === id)!;

describe("全學年課程：上、下學期共用課號", () => {
  it("上 3＋下 3 都要採計，不能把下學期當成重修丟掉", () => {
    const a = audit([c("02390", "微積分", 3, 111, 1), c("02390", "微積分", 3, 111, 2)]);
    expect(cat(a, "required").earned).toBe(6);
    expect(cat(a, "required").unmet).toBe(0);
  });

  it("上學期重修過一次：取較好的那筆上學期，加上下學期", () => {
    const a = audit([
      c("02390", "微積分", 3, 111, 1, "failed"),
      c("02390", "微積分", 3, 112, 1),
      c("02390", "微積分", 3, 111, 2),
    ]);
    expect(cat(a, "required").earned).toBe(6);
  });

  it("下學期沒過、暑修補上：暑修那筆填下學期的缺", () => {
    const a = audit([
      c("02390", "微積分", 3, 111, 1),
      c("02390", "微積分", 3, 111, 2, "failed"),
      c("02390", "微積分", 3, 111, "summer"),
    ]);
    expect(cat(a, "required").earned).toBe(6);
  });

  it("上、下、暑修三筆都及格：最多採計兩筆，不能一門課算成一門半", () => {
    const a = audit([
      c("02390", "微積分", 3, 111, 1),
      c("02390", "微積分", 3, 111, 2),
      c("02390", "微積分", 3, 111, "summer"),
    ]);
    expect(cat(a, "required").earned).toBe(6);
    expect(a.totalEarned).toBe(6);
  });

  it("沒列為全學年的課號，同課號仍一律視為重補修", () => {
    // IM4045 不在 yearLongCourses：第二筆是重修，只採計一次
    const a = audit([c("IM4045", "企業流程管理", 3, 111, 1), c("IM4045", "企業流程管理", 3, 112, 2)]);
    expect(cat(a, "free").earned).toBe(3);
  });
});

describe("只有課名的科目（規劃表不列課號）", () => {
  it("課名完全相等才採計", () => {
    const a = audit([c("D0001", "國文", 2, 111, 1), c("D0002", "國文", 2, 111, 2)]);
    expect(cat(a, "basic").earned).toBe(4);
  });

  it("去掉空白後相等也算（含全形空白）", () => {
    const a = audit([c("D0001", "國　文", 2, 111, 1), c("D0002", " 國文 ", 2, 111, 2)]);
    expect(cat(a, "basic").earned).toBe(4);
  });

  it("課名不同就不採計，不做模糊比對 —— 寧可比不到，也不要算錯類別", () => {
    const a = audit([c("D0001", "國文（一）", 2, 111, 1)]);
    expect(cat(a, "basic").earned).toBe(0);
    expect(cat(a, "free").earned).toBe(2);
  });

  it("具排他性：比到課名的課不會同時落進承接類別", () => {
    const a = audit([c("D0001", "國文", 2, 111, 1)]);
    expect(cat(a, "basic").earned).toBe(2);
    expect(cat(a, "free").earned).toBe(0);
  });
});
