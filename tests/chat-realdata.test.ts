import { describe, expect, it } from "vitest";
import { answerCourseInfo, answerPersonalAudit, categoryFromText } from "@/lib/chat/capabilities";
import { allOfferings } from "@/lib/offerings";
import { applyParams, sanitiseConstraintSet } from "@/lib/chat/apply";
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

describe("對話送回的條件不得無聲截斷", () => {
  const fallback = {
    avoidDays: [], avoidPeriods: [], avoidEarly: false, preferCompactDays: false, maxCredits: 25,
    targetCourseCount: 3, goal: "balanced", goals: [], excludeCourses: [], pinCourses: [],
  } as unknown as ConstraintSet;

  it("排除第 11 門課時，前 10 門都還在", () => {
    const codes = Array.from({ length: 11 }, (_, i) => `IM${String(4001 + i)}`);
    const r = sanitiseConstraintSet({ ...fallback, excludeCourses: codes }, fallback);
    expect(r.excludeCourses).toEqual(codes);
  });

  it("輔大整天不排（D0 到 E4 共 16 節）時，E4 不會被丟掉", () => {
    const periods = Array.from({ length: 16 }, (_, i) => i);
    const r = sanitiseConstraintSet({ ...fallback, avoidPeriods: [{ day: 1, periods }] }, fallback);
    expect(r.avoidPeriods[0]!.periods).toEqual(periods);
  });

  it("期望堂數可以超過 10", () => {
    expect(sanitiseConstraintSet({ ...fallback, targetCourseCount: 12 }, fallback).targetCourseCount).toBe(12);
  });
});

describe("有本系保留班的課，只列本系的班", () => {
  it("資管學生問人生哲學：只列資管那 2 班，並說明其他班是開給別系的", () => {
    const r = answerCourseInfo("人生哲學", "113-1", "fju", "IM");
    expect(r.headline).toContain("開 2 個班可選");
    expect(r.detail).toContain("開給別系的");
    const own = allOfferings("fju").filter((o) => o.code === "00007" && o.year === 113 && o.term === 1 && o.dept === "IM");
    for (const o of own) expect(r.detail).toContain(o.teacher);
  });
});

describe("分項條件：v0.7 的「本系專業選修」是「選修課程」底下的條件，不是一類", () => {
  const withSub = (name: string, unmet: number, subs: { name: string; status: "satisfied" | "unmet"; detail: string }[]) =>
    ({
      ...(cat(name, unmet) as object),
      subRules: subs.map((s) => ({ id: s.name, ...s, citations: [] })),
    }) as unknown as CategoryResult;
  const v07 = {
    ...audit,
    categories: [
      cat("全人教育核心課程", 0),
      withSub("通識涵養課程", 2, [{ name: "三大通識領域", status: "unmet", detail: "三大領域各至少 4 學分；尚缺 社會科學 領域。" }]),
      cat("院系必修課程", 0),
      withSub("選修課程", 18, [{ name: "本系專業選修", status: "satisfied", detail: "至少 10 學分，已修 14 學分。" }]),
    ],
  } as unknown as AuditResult;

  it.each([
    ["本系專業選修夠了嗎", "本系專業選修"],
    ["系專選還差多少", "本系專業選修"],
    ["通識還差多少", "通識涵養課程"], // 「通識」對類別與「三大通識領域」一樣長：仍答類別
    ["選修還差多少", "選修課程"],
  ])("%s → %s", (said, name) => {
    expect(categoryFromText(v07, said)).toBe(name);
  });

  it("答條件本身：已滿足，並附上整個選修課程的進度", () => {
    const r = answerPersonalAudit(v07, "本系專業選修");
    expect(r.headline).toBe("本系專業選修已滿足：至少 10 學分，已修 14 學分。");
    expect(r.detail).toContain("選修課程整體");
    expect(r.detail).toContain("未修 18");
  });
});
