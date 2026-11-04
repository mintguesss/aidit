import { describe, expect, it } from "vitest";
import {
  applyAction,
  CSV_HEADER,
  csvRow,
  emptyMod,
  gradeManual,
  gradeT1,
  manualSheetOf,
  MANUAL_LIMIT_MS,
  newSession,
  publicView,
  sheetRows,
  stepOf,
  systemSheetOf,
  systemUrlOf,
  toCsv,
  type ManualAnswer,
  type TrialSession,
} from "@/lib/trial/session";

const T0 = 1_000_000;
const make = (number = 1, practice = false) => newSession({ id: "a".repeat(32), number, practice, createdBy: "主持人", now: T0 });
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
