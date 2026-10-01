import { takenCourseCodes } from "@/lib/solver/taken";
import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/agent/runner";
import {
  solveWithRelaxation,
  requirementsFrom,
  reservedFrom,
  constraintsFrom,
  describeConstraints,
  PRESET_OF_GOAL,
  type SolveContext,
} from "@/lib/solver/schedule";
import { preferencesOf } from "@/lib/chat/apply";
import { offeringsFor } from "@/lib/offerings";
import { fixture } from "@/lib/providers/fixtures";
import type { CoursePreferences } from "@/lib/types";

async function demoContext(
  prefs: Partial<CoursePreferences> = {},
  over: Partial<SolveContext> = {},
): Promise<SolveContext> {
  const run = await runAudit({ providerKind: "mock", fixture: "demo", currentTerm: "114-2" });
  if (!run.ok) throw new Error("demo 應可完成審查");
  const record = fixture("demo").record;
  const preferences = { ...preferencesOf(record.preferences), ...prefs };
  return {
    offerings: offeringsFor(115, 1),
    requirements: requirementsFrom(run.audit),
    passedCodes: new Set(
      record.courses.filter((c) => c.status === "passed" || c.status === "waived").map((c) => c.code),
    ),
    takenCodes: takenCourseCodes(record.courses, { yearLongCourses: [] }),
    reserved: reservedFrom(record.plannedCommitments),
    preferences,
    constraints: constraintsFrom(preferences, { maxCredits: 25, minCredits: 9 }),
    termLabel: "115-1",
    termMinCredits: 9,
    termMaxCredits: 25,
    ...over,
  };
}

const solveWith = async (prefs: Partial<CoursePreferences>, over?: Partial<SolveContext>) => {
  const ctx = await demoContext(prefs, over);
  return { ctx, result: solveWithRelaxation(ctx, PRESET_OF_GOAL[ctx.preferences.goal], []) };
};

describe("第一版課表依基本資料的選課傾向產生", () => {
  it("三種目標得到不同的課表，且都補足未修學分", async () => {
    const asap = await solveWith({ goal: "asap", targetCourseCount: undefined });
    const balanced = await solveWith({ goal: "balanced", targetCourseCount: undefined });
    const light = await solveWith({ goal: "light", targetCourseCount: undefined });

    for (const r of [asap, balanced, light]) {
      expect(r.result.ok).toBe(true);
      if (r.result.ok) expect(r.result.plans[0]!.unmetAfter).toBe(0);
    }
    if (!asap.result.ok || !light.result.ok) return;

    // 最快畢業會修到學期學分下限以上；輕量修課則以堂數最少為優先
    expect(asap.result.plans[0]!.totalCredits).toBeGreaterThanOrEqual(9);
    expect(light.result.plans[0]!.courses.length).toBeLessThanOrEqual(
      asap.result.plans[0]!.courses.length,
    );
  });

  it("「不排早八」是偏好而非硬限制：有別的選擇時避開，沒有時照排並標示", async () => {
    const normal = await solveWith({ avoidEarly: true, targetCourseCount: undefined });
    expect(normal.result.ok).toBe(true);
    if (normal.result.ok) {
      const early = normal.result.plans[0]!.courses.filter((c) => /^一\s*1/.test(c.slotText));
      expect(early).toHaveLength(0);
    }

    // 只留下早八的自然科技通識，避開早八就變成做不到 —— 此時應照排並在 warnings 說明
    const onlyEarly = await solveWith(
      { avoidEarly: true, targetCourseCount: undefined },
      {
        offerings: offeringsFor(115, 1).filter(
          (o) => o.generalDomain !== "自然科技" || o.code === "GE2115",
        ),
      },
    );
    expect(onlyEarly.result.ok).toBe(true);
    if (onlyEarly.result.ok) {
      const plan = onlyEarly.result.plans[0]!;
      expect(plan.courses.some((c) => c.code === "GE2115")).toBe(true);
      expect(plan.warnings.some((w) => w.includes("早八"))).toBe(true);
    }
  });

  it("「空出某一天」是硬限制：那一天完全不排課", async () => {
    const { result } = await solveWith({ avoidDays: [3], targetCourseCount: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const p of result.plans) {
      expect(p.courses.every((c) => !c.slotText.startsWith("三"))).toBe(true);
    }
  });

  it("期望堂數做不到時照實說，不偷偷忽略", async () => {
    const { result } = await solveWith({ goal: "asap", targetCourseCount: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.plans[0]!;
    // 補足通識自然科技與系專選共需至少 2 門
    expect(plan.courses.length).toBeGreaterThan(1);
    expect(plan.warnings.some((w) => w.includes("期望 1 堂課"))).toBe(true);
  });

  it("方案會附上實際生效的條件，使用者看得到系統照哪些條件算", async () => {
    const { ctx, result } = await solveWith({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans[0]!.appliedConstraints).toEqual(
      describeConstraints(ctx.constraints, ctx.preferences),
    );
    expect(result.plans[0]!.appliedConstraints.length).toBeGreaterThan(0);
  });
});

describe("候選過濾", () => {
  it("不推薦已額滿、先修未過或與已登記時段衝突的課程", async () => {
    const { result } = await solveWith({ targetCourseCount: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const picked = result.plans.flatMap((p) => p.courses.map((c) => c.code));
    expect(picked).not.toContain("IM4045"); // 餘額 0
    expect(picked).not.toContain("IM4055"); // 先修 IM3009 未修
    expect(picked).not.toContain("IM4033"); // 與校外實習 五 2-4 衝堂
    const reasons = result.excluded.excludedBy.map((e) => e.reason);
    expect(reasons).toContain("修課餘額為 0");
    expect(reasons).toContain("先修科目未修畢");
    expect(reasons).toContain("與已登記時段衝突");
  });

  it("時段未知的課程可被採計，但方案會標示衝堂判定未涵蓋", async () => {
    const { result } = await solveWith(
      { targetCourseCount: undefined },
      {
        offerings: offeringsFor(115, 1).filter(
          (o) => o.slotsUnknown || o.generalDomain === "自然科技",
        ),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withUnknown = result.plans.find((p) =>
      p.courses.some((c) => c.slotText.startsWith("時段未知")),
    );
    if (withUnknown) {
      expect(withUnknown.warnings.some((w) => w.includes("時段未知"))).toBe(true);
    }
  });
});

describe("無解與放寬", () => {
  it("無解時回報 Infeasibility 而非空清單，並說明哪兩個條件在打架", async () => {
    const { result } = await solveWith(
      {},
      { offerings: offeringsFor(115, 1).filter((o) => o.generalDomain !== "自然科技") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.infeasibilities.length).toBeGreaterThan(0);
    expect(result.infeasibilities[0]!.suggestion).toBeTruthy();
  });

  it("使用者設定的學分上限太緊時自動放寬，並把放寬內容記下來", async () => {
    const { result } = await solveWith({ maxCredits: 2, targetCourseCount: undefined });
    if (result.ok) {
      expect(result.relaxations.length).toBeGreaterThan(0);
      expect(result.plans[0]!.relaxations.length).toBeGreaterThan(0);
    } else {
      expect(result.relaxations.length).toBeGreaterThan(0);
    }
  });
});

describe("修課人數未知（系上課表沒有人數）", () => {
  it("未知不是額滿：不排除，課表上的餘額是 null 而不是編出來的數字", async () => {
    // 把所有開課的人數拿掉，模擬只有系上課表、沒有教務處人數資料的情況
    const base = await demoContext();
    const unknownSeats = base.offerings.map(({ capacity: _c, enrolled: _e, ...o }) => o);
    const result = solveWithRelaxation({ ...base, offerings: unknownSeats }, PRESET_OF_GOAL[base.preferences.goal], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const courses = result.plans[0]!.courses;
    expect(courses.length).toBeGreaterThan(0);
    expect(courses.every((c) => c.remaining === null)).toBe(true);
    // 沒有任何一門因為「餘額為 0」被排除
    expect(result.excluded.excludedBy.some((e) => e.reason.includes("餘額"))).toBe(false);
  });
});

describe("同一門課分好幾班", () => {
  it("一份課表只能選其中一班 —— 不能拿同一門課的兩班湊學分", async () => {
    const base = await demoContext();
    // 只有一門 3 學分的課可以修，分甲、乙兩班（同課號、不同時段），而這個類別還缺 6 學分。
    // 不擋的話，求解器會選兩班湊滿 6 學分 —— 同一門課修兩次，學分只算一次。
    const course = base.offerings.find((o) => o.credits === 3 && !o.slotsUnknown)!;
    const sectionA = { ...course, category: ["test-cat"], slots: [{ day: 1 as const, periods: [2, 3, 4] }] };
    const sectionB = { ...course, category: ["test-cat"], slots: [{ day: 3 as const, periods: [2, 3, 4] }] };
    const r = solveWithRelaxation(
      {
        ...base,
        offerings: [sectionA, sectionB],
        requirements: [{ id: "test", label: "測試類別 6 學分", shortLabel: "測試", categoryId: "test-cat", minCredits: 6 }],
        termMinCredits: 0,
      },
      PRESET_OF_GOAL[base.preferences.goal],
      [],
    );
    const plans = r.ok ? r.plans : [];
    for (const plan of plans) {
      const codes = plan.courses.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});
