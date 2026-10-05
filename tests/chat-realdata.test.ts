import { describe, expect, it } from "vitest";
import { answerCourseInfo, answerPersonalAudit, categoryFromText } from "@/lib/chat/capabilities";
import { allOfferings } from "@/lib/offerings";
import { applyParams } from "@/lib/chat/apply";
import { fillEmpty } from "@/lib/chat/route";
import { ruleAskIntent } from "@/lib/chat/intent";
import type { AuditResult, CategoryResult } from "@/lib/types";
import type { ConstraintSet } from "@/lib/chat/types";
import type { PlanParams } from "@/lib/chat/intent";

/**
 * 用輔大真實資料實測對話時找到的問題（2026-10-05）。
 * 單元測試不連 Supabase，載不到輔大規則包，所以類別直接照輔大的名稱造。
 */

const cat = (name: string, unmet: number, sub?: string): CategoryResult =>
  ({
    id: name, name, shortName: name.slice(0, 2), required: 10, earned: 10 - unmet, inProgress: 0, unmet, overflow: 0,
    status: unmet > 0 || sub ? "unmet" : "satisfied",
    subRules: sub ? [{ status: "unmet", detail: sub }] : [],
    citations: [], notes: [], assignedCodes: [],
  }) as unknown as CategoryResult;

const audit = {
  categories: [
    cat("全人教育核心課程", 6),
    cat("通識涵養課程", 4, "社會科學領域尚未修習"),
    cat("院系必修課程", 12),
    cat("本系專業選修", 2),
    cat("其他選修", 16),
  ],
  holds: [], unmet: 40, minCredits: 128, totalEarned: 88, countable: 88, inProgress: 0, overflow: 0,
} as unknown as AuditResult;

describe("類別名稱照學生自己的規則包比對", () => {
  it.each([
    ["院系必修還差多少？", "院系必修課程"],
    ["系專選還差多少學分？", "本系專業選修"],
    ["其他選修還差多少", "其他選修"],
    ["通識課程還缺幾學分", "通識涵養課程"],
  ])("%s → %s", (said, name) => {
    expect(categoryFromText(audit, said)).toBe(name);
  });

  it("沒提到類別、或對到好幾類一樣多的，不猜", () => {
    expect(categoryFromText(audit, "我還差幾學分畢業？")).toBeUndefined();
    expect(categoryFromText(audit, "課程學分還差多少")).toBeUndefined();
  });

  it("口語簡稱也查得到類別的回答", () => {
    expect(answerPersonalAudit(audit, "院系必修").headline).toBe("院系必修課程還差 12 學分。");
  });
});

describe("通識缺領域時要講出缺哪個領域", () => {
  it("類別回答：學分不夠又缺領域，兩件都講", () => {
    expect(answerPersonalAudit(audit, "通識").headline).toContain("社會科學領域尚未修習");
  });
  it("整體回答也列出未過的分項條件", () => {
    expect(answerPersonalAudit(audit).detail).toContain("通識涵養課程：社會科學領域尚未修習");
  });
});

describe("用課名找課：輔大同一門課所有班共用課號", () => {
  const set: ConstraintSet = {
    avoidDays: [], avoidPeriods: [], avoidEarly: false, preferCompactDays: false, maxCredits: 25,
    targetCourseCount: 3, goal: "balanced", goals: [], excludeCourses: [], pinCourses: [],
  } as unknown as ConstraintSet;
  const params = {
    avoidDays: [], allowDays: [], avoidEarly: null, avoidMorning: null, avoidDayParts: [],
    preferCompactDays: null, maxDays: null, maxCredits: null, courseCountDelta: null, courseCountTarget: null,
    goal: null, goals: [], excludeCourses: ["人生哲學"], pinCourses: [], reset: false,
  } as PlanParams;

  it("「把人生哲學換掉」解析成課號 00007，而不是查無此課", () => {
    const r = applyParams(set, set, params, "", "把人生哲學換掉", undefined, "fju");
    expect(r.unresolved).toEqual([]);
    expect(r.next.excludeCourses).toEqual(["00007"]);
  });
});

describe("模型留空的欄位由規則補上", () => {
  it("模型填了的不覆蓋，留空的補上", () => {
    const merged = fillEmpty({ a: true, b: null, c: [] as number[] }, { a: false, b: true, c: [1] });
    expect(merged).toEqual({ a: true, b: true, c: [1] });
  });
  it("模型填 false 也算留空：qwen3:14b 對「不要早上的課」會填 avoidEarly true、avoidMorning false", () => {
    const merged = fillEmpty({ avoidEarly: true, avoidMorning: false }, { avoidEarly: null, avoidMorning: true });
    expect(merged).toEqual({ avoidEarly: true, avoidMorning: true });
  });
  it("沒有可補的回傳同一個物件", () => {
    const m = { a: true, b: null };
    expect(fillEmpty(m, { a: false, b: null })).toBe(m);
  });
});

describe("課名裡的字不觸發拒絕；問上課時間走開課資訊", () => {
  it.each(["法律與生活什麼時候上課？", "自我心理探索誰教？"])("%s 不當成專業諮詢", (q) => {
    const r = ruleAskIntent(q);
    expect(r.kind === "intent" ? r.intent : r.kind).toBe("course-info");
  });

  it("真的問法律問題仍然拒絕", () => {
    expect(ruleAskIntent("我被房東告了要找律師嗎？")).toMatchObject({ kind: "forbidden", topic: "professional-advice" });
  });

  it.each(["人生哲學什麼時候上課？", "生死學的上課時間", "財務管理星期幾上？"])("%s → course-info", (q) => {
    const r = ruleAskIntent(q);
    expect(r.kind === "intent" ? r.intent : r.kind).toBe("course-info");
  });
});

describe("開課資訊只列學生下學期那一期", () => {
  it("人生哲學 113-1：每一班都是 113-1 的，不混入其他學期", () => {
    const r = answerCourseInfo("人生哲學", "113-1", "fju");
    expect(r.headline).toContain("113-1 開");
    const want = new Set(
      allOfferings("fju").filter((o) => o.code === "00007" && `${o.year}-${o.term}` === "113-1").map((o) => o.teacher),
    );
    for (const line of (r.detail ?? "").split("\n").filter((l) => l.startsWith("00007"))) {
      expect([...want].some((t) => line.includes(t))).toBe(true);
    }
  });

  it("下學期沒開時明講，列最近一期", () => {
    const r = answerCourseInfo("人生哲學", "120-1", "fju");
    expect(r.headline).toContain("120-1 沒有開課");
  });
});

describe("額外目標要原句有提到", () => {
  const set = {
    avoidDays: [], avoidPeriods: [], avoidEarly: false, preferCompactDays: false, maxCredits: 25,
    targetCourseCount: 3, goal: "balanced", goals: [], excludeCourses: [], pinCourses: [],
  } as unknown as ConstraintSet;
  const p = (goals: PlanParams["goals"]) =>
    ({
      avoidDays: [], allowDays: [], avoidEarly: null, avoidMorning: null, avoidDayParts: [],
      preferCompactDays: null, maxDays: null, maxCredits: null, courseCountDelta: null, courseCountTarget: null,
      goal: null, goals, excludeCourses: [], pinCourses: [], reset: false,
    }) as PlanParams;

  it("「多選一堂課」模型填了輔系 → 擋下", () => {
    const r = applyParams(set, set, p(["minor"]), "", "多選一堂課");
    expect(r.next.goals).toEqual([]);
    expect(r.refusedParams.some((x) => x.includes("輔系"))).toBe(true);
  });

  it("「我想加修輔系」照常加入", () => {
    expect(applyParams(set, set, p(["minor"]), "", "我想加修輔系").next.goals).toEqual(["minor"]);
  });
});
