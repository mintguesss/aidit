import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST as declare } from "@/app/api/declarations/route";
import { DELETE as erasePrefs, POST as savePrefs } from "@/app/api/preferences/route";
import { REAL_CASES } from "@/eval/baseline-c/cases";
import { PLAN_GROUPS, RULE_ARTICLES } from "@/lib/trial/reference";
import { isSharedCase } from "@/lib/trial/shared-case";
import {
  applyAction,
  CSV_HEADER,
  csvRow,
  DEMO_URL,
  emptyMod,
  GEN_ED_DOMAINS,
  gradeManual,
  gradeT1,
  manualSheetOf,
  MANUAL_LIMIT_MS,
  newSession,
  moderatorView,
  publicView,
  SHEET_CATEGORIES,
  sheetRows,
  stepOf,
  systemSheetOf,
  systemUrlOf,
  toCsv,
  type ManualAnswer,
  type TrialSession,
} from "@/lib/trial/session";
import { fixture } from "@/lib/providers/fixtures";
import { nextParticipantNumber } from "@/lib/trial/session";

describe("多人共用的試用案例", () => {
  const post = (body: unknown, method = "POST") =>
    new Request("http://test/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("任務案例和導覽學生都算共用案例，其他合成案例不算", () => {
    for (const g of ["A", "B"] as const) expect(isSharedCase(new URL(systemUrlOf(g), "http://x").searchParams.get("fixture") ?? "")).toBe(true);
    expect(isSharedCase(new URL(DEMO_URL, "http://x").searchParams.get("fixture") ?? "")).toBe(true);
    expect(isSharedCase("demo")).toBe(false);
    expect(isSharedCase(undefined)).toBe(false);
  });

  it("不能在共用案例上勾選畢業條件", async () => {
    const res = await declare(post({ fixture: "school-a-im-111-year2", checkId: "x", passed: true }));
    expect(res.status).toBe(403);
  });

  it("共用案例的偏好不存伺服器，讀也讀不到別人的", async () => {
    const write = await (await savePrefs(post({ fixture: "tour", required: {} }))).json();
    expect(write).toMatchObject({ ok: true, stored: null });
    const read = await (await savePrefs(post({ fixture: "school-a-im-111-b-year2" }))).json();
    expect(read.stored).toBeNull();
  });

  it("在共用案例上刪除不會動到執行紀錄", async () => {
    const res = await (await erasePrefs(post({ fixture: "school-a-im-111-year2", scope: "all" }, "DELETE"))).json();
    expect(res).toMatchObject({ ok: true, traces: 0 });
  });
});

/** 只靠畫面上的修課紀錄與規劃表分類，模擬學生手算 */
function computeFromMaterials(sheet: 1 | 2) {
  const groupOf = (name: string) => {
    const lower = name.toLowerCase();
    const base = lower.startsWith("外國語文") ? "外國語文" : lower;
    return PLAN_GROUPS.find((g) => g.courses.some((c) => c.name.toLowerCase() === base))?.category;
  };
  const earned: Record<string, number> = {};
  const domains: Record<string, number> = {};
  for (const r of sheetRows(sheet)) {
    // 體育課的課名是項目（如保齡球），0 學分，看開課單位
    const category =
      r.type === "通" ? "通識涵養課程" : r.type === "選" ? "選修課程" : r.dept === "體育" ? "全人教育核心課程" : groupOf(r.name);
    expect(category, `${r.name} 在規劃表找不到類別`).toBeDefined();
    earned[category as string] = (earned[category as string] ?? 0) + r.credits;
    if (r.domain) domains[r.domain] = (domains[r.domain] ?? 0) + r.credits;
  }
  return { earned, domains };
}

describe("手算對照資料", () => {
  const compact = (s: string) => s.replace(/\s+/g, "");
  const plan = compact(readFileSync("src/lib/rules/corpus/fju-im-plan-111.txt", "utf8"));
  const rules = compact(readFileSync("src/lib/rules/corpus/fju-im-rules-111.txt", "utf8"));

  it("課名都在規劃表原文裡", () => {
    for (const g of PLAN_GROUPS) for (const c of g.courses) expect(plan, c.name).toContain(compact(c.name));
  });

  it("各類別應修學分和答題欄、課程學分加總一致", () => {
    for (const c of SHEET_CATEGORIES) {
      const g = PLAN_GROUPS.find((x) => x.category === c.name);
      expect(g?.required, c.name).toBe(c.required);
      if (c.name !== "選修課程") expect(g?.courses.reduce((a, x) => a + x.credits, 0), c.name).toBe(c.required);
    }
    expect(SHEET_CATEGORIES.reduce((a, c) => a + c.required, 0)).toBe(128);
  });

  it("條文的關鍵句都在修業規則原文裡", () => {
    for (const phrase of ["修滿全人教育核心課程", "至少128學分", "擋修「資訊系統專題一」", "累計通過3題機測題目", "以英語授課的專業課程"]) {
      expect(rules, phrase).toContain(compact(phrase));
    }
    expect(RULE_ARTICLES.flatMap((a) => a.items).map(compact).join("")).toContain("至少128學分");
  });

  it("只靠畫面上的資料算得出兩份題目的標準答案", () => {
    for (const sheet of [1, 2] as const) {
      const fx = sheet === 1 ? "fju-im-111-b-year2" : "fju-im-111-year2";
      const key = REAL_CASES.find((x) => x.fixture === fx)!.expect;
      const { earned, domains } = computeFromMaterials(sheet);
      const unmet = key.categories.map((c) => Math.max(0, c.required - (earned[c.name] ?? 0)));
      expect(unmet).toEqual(key.categories.map((c) => c.unmet));
      expect(unmet.reduce((a, b) => a + b, 0)).toBe(key.totalUnmet);
      expect(GEN_ED_DOMAINS.filter((d) => (domains[d] ?? 0) < 4).sort()).toEqual([...key.missingGenEdDomains].sort());
    }
  });
});

const T0 = 1_000_000;
const make =(number = 1, practice = false) => newSession({ id: "a".repeat(32), number, practice, createdBy: "主持人", now: T0 });
const profile = { identity: "大二", minorProgram: false, lastCheck: "10 分鐘內" };

const answerFor40: ManualAnswer = {
  categories: { 全人教育核心課程: 6, 基本能力課程: 0, 通識涵養課程: 4, 院系必修課程: 12, 選修課程: 18 },
  total: 40,
  missingDomains: ["社會科學"],
  canGraduate: false,
  note: "",
  uncertain: false,
};

function runAll(s: TrialSession) {
  applyAction(s, { type: "consent", agreed: true, profile }, T0);
  applyAction(s, { type: "manual.start" }, T0 + 1000);
  applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + 601_000);
  applyAction(s, { type: "orientation.start" }, T0 + 610_000);
  applyAction(s, { type: "orientation.end" }, T0 + 670_000);
  for (const [i, task] of (["t1", "t2", "t3"] as const).entries()) {
    applyAction(s, { type: "task.start", task }, T0 + 700_000 + i * 100_000);
    applyAction(
      s,
      task === "t1"
        ? { type: "task.submit", task, gaveUp: false, total: 37, categories: ["全人教育核心課程", "通識涵養課程", "院系必修課程", "選修課程"] }
        : { type: "task.submit", task, gaveUp: false, text: "作答" },
      T0 + 730_000 + i * 100_000,
    );
  }
  applyAction(s, { type: "survey", scores: [5, 4, 5, 3, 4], open: "=SUM(A1)" }, T0 + 1_100_000);
}

describe("分組", () => {
  it("依報到順序輪流，A 組手算題目二、系統題目一", () => {
    expect(make(1).group).toBe("A");
    expect(make(2).group).toBe("B");
    expect(make(3).group).toBe("A");
    expect(manualSheetOf("A")).toBe(2);
    expect(systemSheetOf("A")).toBe(1);
    expect(systemUrlOf("A")).toBe("/?fixture=school-a-im-111-b-year2");
    expect(systemUrlOf("B")).toBe("/?fixture=school-a-im-111-year2");
  });

  it("練習另外編號", () => {
    expect(make(1).code).toBe("P01");
    expect(make(1, true).code).toBe("T01");
  });
});

describe("編號", () => {
  const withCode = (code: string, practice = false) => ({ ...make(1, practice), code });
  it("刪掉中間一筆，新的不會和現有代號重複，也不補洞", () => {
    expect(nextParticipantNumber([withCode("P01"), withCode("P03")], false)).toBe(4);
    expect(nextParticipantNumber([], false)).toBe(1);
  });
  it("練習和正式各算各的", () => {
    expect(nextParticipantNumber([withCode("P05"), withCode("T02", true)], true)).toBe(3);
  });
});

describe("題目與紙本題目卷一致", () => {
  const sum = (sheet: 1 | 2) => sheetRows(sheet).reduce((a, r) => a + r.credits, 0);
  it("題目一 41 筆 91 學分，含 2 門入學前抵免", () => {
    const rows = sheetRows(1);
    expect(rows).toHaveLength(41);
    expect(sum(1)).toBe(91);
    expect(rows.filter((r) => r.note === "入學前抵免")).toHaveLength(2);
    expect(rows.find((r) => r.name === "領導心靈與技巧")?.dept).toBe("通識（社會）");
    expect(rows.find((r) => r.name === "微積分")?.dept).toBe("本系");
  });
  it("題目二 40 筆 88 學分，沒有抵免", () => {
    expect(sheetRows(2)).toHaveLength(40);
    expect(sum(2)).toBe(88);
    expect(sheetRows(2).some((r) => r.note)).toBe(false);
  });
});

describe("流程", () => {
  it("照順序走完", () => {
    const s = make();
    expect(stepOf(s)).toBe("consent");
    runAll(s);
    expect(stepOf(s)).toBe("done");
  });

  it("不同意就結束，不留基本資料，也不能開始手算", () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: false, profile }, T0);
    expect(stepOf(s)).toBe("declined");
    expect(s.profile).toBeUndefined();
    expect(applyAction(s, { type: "manual.start" }, T0).ok).toBe(false);
  });

  it("重新整理或重送不會改掉已記錄的時間", () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: true, profile }, T0);
    applyAction(s, { type: "manual.start" }, T0 + 1000);
    applyAction(s, { type: "manual.start" }, T0 + 9000);
    expect(s.manual.startedAt).toBe(T0 + 1000);
    applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + 2000);
    applyAction(s, { type: "manual.submit", answer: { ...answerFor40, total: 1 }, gaveUp: true }, T0 + 3000);
    expect(s.manual.endedAt).toBe(T0 + 2000);
    expect(s.manual.answer?.total).toBe(40);
  });

  it("任務不能跳著做", () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: true, profile }, T0);
    applyAction(s, { type: "manual.start" }, T0);
    applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0);
    expect(applyAction(s, { type: "task.start", task: "t1" }, T0).ok).toBe(false);
    applyAction(s, { type: "orientation.start" }, T0);
    applyAction(s, { type: "orientation.end" }, T0);
    expect(applyAction(s, { type: "task.start", task: "t2" }, T0).ok).toBe(false);
    expect(applyAction(s, { type: "task.start", task: "t1" }, T0).ok).toBe(true);
  });

  it("滿 15 分鐘才交卷記為超時，時間內不算", () => {
    const late = make();
    applyAction(late, { type: "consent", agreed: true, profile }, T0);
    applyAction(late, { type: "manual.start" }, T0);
    applyAction(late, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + MANUAL_LIMIT_MS);
    expect(late.manual.timedOut).toBe(true);

    const onTime = make();
    applyAction(onTime, { type: "consent", agreed: true, profile }, T0);
    applyAction(onTime, { type: "manual.start" }, T0);
    applyAction(onTime, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + 60_000);
    expect(onTime.manual.timedOut).toBe(false);

    // 時間到之前幾秒自己交卷，不算超時
    const close = make();
    applyAction(close, { type: "consent", agreed: true, profile }, T0);
    applyAction(close, { type: "manual.start" }, T0);
    applyAction(close, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + MANUAL_LIMIT_MS - 8000);
    expect(close.manual.timedOut).toBe(false);
  });

  it("問卷分數超出範圍要擋", () => {
    const s = make();
    runAll(s);
    const t = make();
    applyAction(t, { type: "consent", agreed: true, profile }, T0);
    expect(applyAction(t, { type: "survey", scores: [5, 5, 5, 5, 5], open: "" }, T0).ok).toBe(false);
    const u = structuredClone(s);
    u.survey = undefined;
    expect(applyAction(u, { type: "survey", scores: [6, 5, 5, 5, 5], open: "" }, T0).ok).toBe(false);
  });
});

describe("熟悉系統", () => {
  const atOrientation = () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: true, profile }, T0);
    applyAction(s, { type: "manual.start" }, T0);
    applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + 1000);
    return s;
  };

  it("手算之後才看系統，手算前不給連結", () => {
    const before = make();
    applyAction(before, { type: "consent", agreed: true, profile }, T0);
    expect(publicView(before, T0).demoUrl).toBeNull();
    expect(applyAction(before, { type: "orientation.start" }, T0).ok).toBe(false);
    const s = atOrientation();
    expect(stepOf(s)).toBe("orientation");
    expect(publicView(s, T0).demoUrl).toBe("/?fixture=tour");
    expect(publicView(s, T0).systemUrl).toBeNull();
  });

  it("用的是合成案例，不是任務那兩位學生", () => {
    const url = publicView(atOrientation(), T0).demoUrl!;
    expect(url).not.toBe(systemUrlOf("A"));
    expect(url).not.toBe(systemUrlOf("B"));
  });

  it("時間單獨記，不算進任務", () => {
    const s = make();
    runAll(s);
    const row = csvRow(s, emptyMod());
    expect(row[CSV_HEADER.indexOf("熟悉系統秒")]).toBe("60");
    expect(row[CSV_HEADER.indexOf("T1秒")]).toBe("30");
  });
});

describe("案例不會認錯", () => {
  it("導覽學生沒有已登記時段，星期五不會多出實習", () => {
    expect(fixture("tour").record.plannedCommitments).toEqual([]);
    expect(JSON.stringify(fixture("tour").record)).not.toContain("實習");
    expect(fixture("demo").record.plannedCommitments?.length).toBe(1);
  });

  it("任務時會告訴受試者右上角該顯示誰，和導覽學生不同", () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: true, profile }, T0);
    applyAction(s, { type: "manual.start" }, T0);
    applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0);
    expect(publicView(s, T0).systemStudent).toBeNull();
    applyAction(s, { type: "orientation.start" }, T0);
    applyAction(s, { type: "orientation.end" }, T0);
    const name = publicView(s, T0).systemStudent;
    expect(name).toBe("示範學生（第二位）");
    expect(name).not.toBe(fixture("tour").record.student.displayName);
  });
});

describe("批改", () => {
  it("全部相同才算對，任一類別不同就算錯", () => {
    expect(gradeManual(2, answerFor40)).toEqual({ allCategories: true, domains: true, graduate: true });
    const wrong = { ...answerFor40, categories: { ...answerFor40.categories, 選修課程: 19 } };
    expect(gradeManual(2, wrong).allCategories).toBe(false);
    expect(gradeManual(2, { ...answerFor40, total: 39 }).allCategories).toBe(false);
  });
  it("沒交卷不算對", () => {
    expect(gradeManual(1, undefined).allCategories).toBe(false);
  });
  it("T1 要合計與缺的類別都對；基本能力不缺", () => {
    const cats = ["全人教育核心課程", "通識涵養課程", "院系必修課程", "選修課程"];
    expect(gradeT1(1, { total: 37, categories: cats })).toEqual({ total: true, categories: true });
    expect(gradeT1(2, { total: 40, categories: cats })).toEqual({ total: true, categories: true });
    expect(gradeT1(1, { total: 37, categories: [...cats, "基本能力課程"] }).categories).toBe(false);
    expect(gradeT1(1, { total: 40, categories: cats }).total).toBe(false);
  });
});

describe("受試者看不到答案", () => {
  it("回傳內容沒有批改與標準答案，題目只在手算時給，也不含他人紀錄", () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: true, profile }, T0);
    expect(publicView(s, T0).rows).toBeNull();
    applyAction(s, { type: "manual.start" }, T0);
    expect(publicView(s, T0).rows).toHaveLength(40);
    applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + 1000);
    const json = JSON.stringify(publicView(s, T0));
    expect(publicView(s, T0).rows).toBeNull();
    for (const leak of ["unmet", "totalUnmet", "allCategories", "expectedTotal", "answer"]) expect(json).not.toContain(leak);
  });
});

describe("匯出", () => {
  it("前 35 欄與 試用紀錄表.csv 相同", () => {
    expect(CSV_HEADER.slice(0, 35).join(",")).toBe(
      "代號,組別,身分,修學程輔系雙主修,上次確認進度耗時,手算題目,手算開始,手算結束,手算耗時分,手算合計作答,手算各類別全對,手算放棄,手算標註不確定,手算超時,系統題目,T1完成,T1秒,T1協助,T1答案全對,T2完成,T2秒,T2協助,T3完成,T3秒,T3協助,Q1比手算快,Q2看得懂,Q3更相信,Q4接受不確定,Q5會使用,開放題,對話traceId,主持人備註,是否排除,排除理由",
    );
  });

  it("欄數一致、批改與時間正確", () => {
    const s = make();
    runAll(s);
    const row = csvRow(s, { ...emptyMod(), t2Ok: true, t3Ok: false });
    expect(row).toHaveLength(CSV_HEADER.length);
    const at = (name: string) => row[CSV_HEADER.indexOf(name)];
    expect(at("代號")).toBe("P01");
    expect(at("手算題目")).toBe("2");
    expect(at("手算耗時分")).toBe("10");
    expect(at("手算各類別全對")).toBe("是");
    expect(at("系統題目")).toBe("1");
    expect(at("T1秒")).toBe("30");
    expect(at("T1答案全對")).toBe("是");
    expect(at("T2完成")).toBe("是");
    expect(at("T3完成")).toBe("否");
    expect(at("Q1比手算快")).toBe("5");
    expect(at("是否排除")).toBe("否");
  });

  it("練習與不同意都會留下並標記排除", () => {
    const p = csvRow(make(1, true), emptyMod());
    expect(p[CSV_HEADER.indexOf("是否排除")]).toBe("是");
    expect(p[CSV_HEADER.indexOf("排除理由")]).toBe("練習");
    const d = make();
    applyAction(d, { type: "consent", agreed: false }, T0);
    expect(csvRow(d, emptyMod())[CSV_HEADER.indexOf("排除理由")]).toBe("不同意參與");
  });

  it("受試者輸入的公式不會被 Excel 執行，逗號與引號有跳脫", () => {
    const s = make();
    runAll(s);
    const csv = toCsv([{ session: s, mod: { ...emptyMod(), note: 'a,"b"' } }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('"a,""b"""');
  });
});

describe("手算的正確答案", () => {
  it("受試者全部做完才看得到，主持人一直看得到", () => {
    const s = make();
    applyAction(s, { type: "consent", agreed: true, profile }, T0);
    applyAction(s, { type: "manual.start" }, T0 + 1);
    applyAction(s, { type: "manual.submit", answer: answerFor40, gaveUp: false }, T0 + 2);
    expect(publicView(s, T0 + 3).manualReview).toBeNull();
    expect(moderatorView(s, emptyMod()).manualKey.total).toBe(manualSheetOf(s.group) === 2 ? 40 : 37);
    applyAction(s, { type: "orientation.start" }, T0 + 4);
    applyAction(s, { type: "orientation.end" }, T0 + 5);
    for (const t of ["t1", "t2", "t3"] as const) {
      applyAction(s, { type: "task.start", task: t }, T0 + 6);
      expect(publicView(s, T0 + 6).manualReview).toBeNull();
      applyAction(s, { type: "task.submit", task: t, gaveUp: false, text: "x" }, T0 + 7);
    }
    expect(publicView(s, T0 + 8).manualReview).toBeNull();
    applyAction(s, { type: "survey", scores: [3, 3, 3, 3, 3], open: "" }, T0 + 9);
    const review = publicView(s, T0 + 10).manualReview;
    expect(review?.answer.total).toBe(40);
    expect(review?.key.categories.map((c) => c.name)).toEqual(SHEET_CATEGORIES.map((c) => c.name));
  });
});
