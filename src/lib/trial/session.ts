import { z } from "zod";
import { REAL_CASES } from "@/eval/baseline-c/cases";
import { fixture, type FixtureId } from "@/lib/providers/fixtures";

/**
 * 學生試用的流程與紀錄（場域驗證 Level 3＋人工基準）。
 *
 * 主持人在旁邊，這個網站只是計時與記錄的工具：時間一律由伺服器記，答案由伺服器批改，
 * 標準答案和批改結果不回傳給受試者的頁面。判斷不了的項目（T2、T3、需要協助）留給主持人。
 */

export const MANUAL_LIMIT_MS = 15 * 60_000;

export type TaskId = "t1" | "t2" | "t3";
export const TASK_IDS: TaskId[] = ["t1", "t2", "t3"];
export type SheetNo = 1 | 2;
export type Group = "A" | "B";

/**
 * A 組手算題目二、系統題目一；B 組相反（試用執行手冊第 2 節）。
 * 題目編號與題目卷、答案卷一致。
 */
const SHEET_FIXTURE: Record<SheetNo, { fixture: FixtureId; publicId: string }> = {
  1: { fixture: "fju-im-111-b-year2", publicId: "school-a-im-111-b-year2" },
  2: { fixture: "fju-im-111-year2", publicId: "school-a-im-111-year2" },
};
export const manualSheetOf = (g: Group): SheetNo => (g === "A" ? 2 : 1);
export const systemSheetOf = (g: Group): SheetNo => (g === "A" ? 1 : 2);
export const systemUrlOf = (g: Group) => `/?fixture=${SHEET_FIXTURE[systemSheetOf(g)].publicId}`;
/** 熟悉系統用合成案例，不是任務那位學生，先看過也不會知道答案 */
export const DEMO_URL = "/?fixture=tour";
/** 任務案例在系統右上角顯示的名字，讓受試者確認開對了 */
export const systemStudentOf = (g: Group) => fixture(SHEET_FIXTURE[systemSheetOf(g)].fixture).record.student.displayName;

function keyOf(sheet: SheetNo) {
  const c = REAL_CASES.find((x) => x.fixture === SHEET_FIXTURE[sheet].fixture);
  if (!c) throw new Error(`找不到題目 ${sheet} 的標準答案`);
  return c.expect;
}

/** 題目的類別與應修學分（不含答案，可以給受試者看） */
export const SHEET_CATEGORIES = keyOf(1).categories.map((c) => ({ name: c.name, required: c.required }));
export const GEN_ED_DOMAINS = ["人文與藝術", "自然與科技", "社會科學"];

const SELECT_LABEL: Record<string, string> = { required: "必", elective: "選", general: "通" };
const DEPT_LABEL: Record<string, string> = {
  IM: "本系",
  CT: "國文",
  IT: "全人中心",
  FT: "外語中心",
  YT: "軍訓",
  AT: "體育",
  PT: "通識（人文）",
  NT: "通識（自然）",
  ST: "通識（社會）",
};

export type SheetRow = { term: string; name: string; credits: number; type: string; domain: string; dept: string; note: string };

/** 手算題目的修課紀錄，欄位與紙本題目卷相同 */
export function sheetRows(sheet: SheetNo): SheetRow[] {
  return fixture(SHEET_FIXTURE[sheet].fixture).record.courses.map((c) => ({
    term: `${c.year}-${c.term}`,
    name: c.name,
    credits: c.credits,
    type: SELECT_LABEL[c.selectType] ?? (c.generalDomain ? "通" : "選"),
    domain: c.generalDomain ?? "",
    dept: DEPT_LABEL[c.offeringDept ?? ""] ?? "外系",
    note: c.waiverSource !== undefined || c.status === "waived" ? "入學前抵免" : "",
  }));
}

/* ---------- 紀錄 ---------- */

export type ManualAnswer = {
  categories: Record<string, number | null>;
  total: number | null;
  missingDomains: string[];
  canGraduate: boolean | null;
  note: string;
  uncertain: boolean;
};

export type TaskRecord = {
  startedAt?: number;
  endedAt?: number;
  gaveUp?: boolean;
  /** t1：合計與缺的類別；t2、t3：受試者的文字 */
  total?: number | null;
  categories?: string[];
  text?: string;
};

export type TrialSession = {
  id: string;
  code: string;
  group: Group;
  practice: boolean;
  createdAt: number;
  createdBy: string;
  consent?: { agreed: boolean; at: number };
  profile?: { identity: string; minorProgram: boolean; lastCheck: string };
  manual: {
    startedAt?: number;
    endedAt?: number;
    gaveUp?: boolean;
    timedOut?: boolean;
    answer?: ManualAnswer;
  };
  /** 手算後、任務前自由看一下系統，不算進任務時間 */
  orientation?: { startedAt?: number; endedAt?: number };
  tasks: Record<TaskId, TaskRecord>;
  traceIds: string[];
  survey?: { scores: [number, number, number, number, number]; open: string; at: number };
};

/** 主持人的判定。和受試者的紀錄分開存，兩邊同時送出才不會互相蓋掉 */
export type TrialMod = {
  help: Record<TaskId, boolean>;
  t2Ok: boolean | null;
  t3Ok: boolean | null;
  note: string;
  excluded: boolean;
  excludeReason: string;
};

export const emptyMod = (): TrialMod => ({
  help: { t1: false, t2: false, t3: false },
  t2Ok: null,
  t3Ok: null,
  note: "",
  excluded: false,
  excludeReason: "",
});

export function newSession(args: { id: string; number: number; practice: boolean; createdBy: string; now: number }): TrialSession {
  const { id, number, practice, createdBy, now } = args;
  return {
    id,
    code: `${practice ? "T" : "P"}${String(number).padStart(2, "0")}`,
    // 依報到順序輪流：第 1、3、5 位 A 組
    group: number % 2 === 1 ? "A" : "B",
    practice,
    createdAt: now,
    createdBy,
    manual: {},
    tasks: { t1: {}, t2: {}, t3: {} },
    traceIds: [],
  };
}

/** 下一個編號：取現有最大值加一。用筆數會在刪除後和現有代號重複；空號留著，看得出有刪過 */
export function nextParticipantNumber(existing: TrialSession[], practice: boolean): number {
  const nums = existing.filter((x) => x.practice === practice).map((x) => Number(x.code.slice(1))).filter(Number.isFinite);
  return Math.max(0, ...nums) + 1;
}

export type Step = "consent" | "declined" | "manual-intro" | "manual" | "orientation" | "system" | "survey" | "done";

export function stepOf(s: TrialSession): Step {
  if (!s.consent) return "consent";
  if (!s.consent.agreed) return "declined";
  if (!s.manual.startedAt) return "manual-intro";
  if (!s.manual.endedAt) return "manual";
  if (!s.orientation?.endedAt) return "orientation";
  if (TASK_IDS.some((t) => !s.tasks[t].endedAt)) return "system";
  return s.survey ? "done" : "survey";
}

/* ---------- 受試者的操作 ---------- */

const text = (max: number) => z.string().trim().max(max);
const credits = z.number().int().min(0).max(300).nullable();

const manualAnswer = z.object({
  categories: z.record(z.string().max(40), credits),
  total: credits,
  missingDomains: z.array(z.string().max(20)).max(5),
  canGraduate: z.boolean().nullable(),
  note: text(2000),
  uncertain: z.boolean(),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("consent"),
    agreed: z.boolean(),
    profile: z.object({ identity: text(40), minorProgram: z.boolean(), lastCheck: text(40) }).optional(),
  }),
  z.object({ type: z.literal("manual.start") }),
  z.object({ type: z.literal("manual.submit"), answer: manualAnswer, gaveUp: z.boolean() }),
  z.object({ type: z.literal("orientation.start") }),
  z.object({ type: z.literal("orientation.end") }),
  z.object({ type: z.literal("task.start"), task: z.enum(["t1", "t2", "t3"]) }),
  z.object({
    type: z.literal("task.submit"),
    task: z.enum(["t1", "t2", "t3"]),
    gaveUp: z.boolean(),
    total: credits.optional(),
    categories: z.array(z.string().max(40)).max(10).optional(),
    text: text(2000).optional(),
  }),
  z.object({ type: z.literal("trace"), traceId: z.string().regex(/^[\w-]{1,80}$/) }),
  z.object({
    type: z.literal("survey"),
    scores: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
    open: text(4000),
  }),
]);
export type TrialAction = z.infer<typeof actionSchema>;

/**
 * 套用一個操作。時間都用伺服器的 now。
 * 開始與交卷都只記第一次：重新整理或重送不會改掉已記錄的時間，順序不對就回錯。
 */
export function applyAction(s: TrialSession, a: TrialAction, now: number): { ok: true } | { ok: false; error: string } {
  const step = stepOf(s);
  switch (a.type) {
    case "consent":
      if (s.consent) return { ok: true };
      if (a.agreed && !a.profile) return { ok: false, error: "請先填基本資料。" };
      s.consent = { agreed: a.agreed, at: now };
      if (a.agreed) s.profile = a.profile;
      return { ok: true };
    case "manual.start":
      if (s.manual.startedAt) return { ok: true };
      if (step !== "manual-intro") return { ok: false, error: "還不能開始手算。" };
      s.manual.startedAt = now;
      return { ok: true };
    case "manual.submit":
      if (s.manual.endedAt) return { ok: true };
      if (!s.manual.startedAt) return { ok: false, error: "手算還沒開始。" };
      s.manual.endedAt = now;
      s.manual.answer = a.answer;
      s.manual.gaveUp = a.gaveUp;
      // 自動交卷用伺服器時間倒數，送達時一定已滿 15 分鐘，不需要容許值
      s.manual.timedOut = now - s.manual.startedAt >= MANUAL_LIMIT_MS;
      return { ok: true };
    case "orientation.start":
      if (s.orientation?.startedAt) return { ok: true };
      if (step !== "orientation") return { ok: false, error: "還不能開始。" };
      s.orientation = { startedAt: now };
      return { ok: true };
    case "orientation.end":
      if (s.orientation?.endedAt) return { ok: true };
      if (!s.orientation?.startedAt) return { ok: false, error: "還沒開始。" };
      s.orientation.endedAt = now;
      return { ok: true };
    case "task.start": {
      if (s.tasks[a.task].startedAt) return { ok: true };
      const prev = TASK_IDS[TASK_IDS.indexOf(a.task) - 1];
      if (step !== "system" || (prev && !s.tasks[prev].endedAt)) return { ok: false, error: "請照順序完成任務。" };
      s.tasks[a.task].startedAt = now;
      return { ok: true };
    }
    case "task.submit": {
      const t = s.tasks[a.task];
      if (t.endedAt) return { ok: true };
      if (!t.startedAt) return { ok: false, error: "這個任務還沒開始。" };
      t.endedAt = now;
      t.gaveUp = a.gaveUp;
      if (a.total !== undefined) t.total = a.total;
      if (a.categories) t.categories = a.categories;
      if (a.text !== undefined) t.text = a.text;
      return { ok: true };
    }
    case "trace":
      if (!s.traceIds.includes(a.traceId) && s.traceIds.length < 100) s.traceIds.push(a.traceId);
      return { ok: true };
    case "survey":
      if (s.survey) return { ok: true };
      if (step !== "survey") return { ok: false, error: "還不能填問卷。" };
      if (a.scores.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) return { ok: false, error: "每一題都要圈選 1 到 5。" };
      s.survey = { scores: a.scores as [number, number, number, number, number], open: a.open, at: now };
      return { ok: true };
  }
}

/* ---------- 批改（只在伺服器與主持人那邊） ---------- */

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** 任一類別或合計不同就算錯，與系統、單一模型同一標準（試用執行手冊第 4 節） */
export function gradeManual(sheet: SheetNo, a: ManualAnswer | undefined) {
  const key = keyOf(sheet);
  return {
    allCategories:
      !!a && a.total === key.totalUnmet && key.categories.every((c) => a.categories[c.name] === c.unmet),
    domains: !!a && sameSet(a.missingDomains, key.missingGenEdDomains),
    graduate: !!a && a.canGraduate === (key.canGraduate === "yes"),
  };
}

export function gradeT1(sheet: SheetNo, t: TaskRecord) {
  const key = keyOf(sheet);
  const missing = key.categories.filter((c) => c.unmet > 0).map((c) => c.name);
  return { total: t.total === key.totalUnmet, categories: sameSet(t.categories ?? [], missing) };
}

export const expectedTotal = (sheet: SheetNo) => keyOf(sheet).totalUnmet;

/** 手算的標準答案（給主持人，以及做完全部流程的受試者對照） */
export function manualKeyOf(sheet: SheetNo) {
  const key = keyOf(sheet);
  return {
    categories: key.categories.map((c) => ({ name: c.name, unmet: c.unmet })),
    total: key.totalUnmet,
    domains: key.missingGenEdDomains,
    canGraduate: key.canGraduate === "yes",
  };
}
export type ManualKey = ReturnType<typeof manualKeyOf>;

const secs = (t: TaskRecord) => (t.startedAt && t.endedAt ? Math.round((t.endedAt - t.startedAt) / 1000) : null);
export const taskSeconds = secs;
const orientationSeconds = (s: TrialSession) => secs(s.orientation ?? {});
export const manualMinutes = (s: TrialSession) =>
  s.manual.startedAt && s.manual.endedAt ? Math.round((s.manual.endedAt - s.manual.startedAt) / 6000) / 10 : null;

/** 受試者頁面看得到的內容：沒有批改結果，題目在手算開始後才給 */
export function publicView(s: TrialSession, now: number) {
  const step = stepOf(s);
  return {
    id: s.id,
    code: s.code,
    step,
    now,
    manual: { startedAt: s.manual.startedAt ?? null, limitMs: MANUAL_LIMIT_MS },
    sheetNo: manualSheetOf(s.group),
    rows: step === "manual" ? sheetRows(manualSheetOf(s.group)) : null,
    demoUrl: step === "orientation" ? DEMO_URL : null,
    orientation: { startedAt: s.orientation?.startedAt ?? null },
    categories: SHEET_CATEGORIES,
    domains: GEN_ED_DOMAINS,
    systemUrl: step === "system" ? systemUrlOf(s.group) : null,
    systemStudent: step === "system" ? systemStudentOf(s.group) : null,
    // 兩題缺的類別一樣，太早給答案會影響任務 1；全部做完才給受試者對照
    manualReview:
      step === "done" && s.manual.answer ? { answer: s.manual.answer, key: manualKeyOf(manualSheetOf(s.group)) } : null,
    tasks: Object.fromEntries(
      TASK_IDS.map((t) => [t, { startedAt: s.tasks[t].startedAt ?? null, endedAt: s.tasks[t].endedAt ?? null }]),
    ) as Record<TaskId, { startedAt: number | null; endedAt: number | null }>,
  };
}
export type TrialPublicView = ReturnType<typeof publicView>;

/* ---------- 匯出 ---------- */

/** 前 35 欄與 試用紀錄表.csv 相同，後面是自動批改的明細 */
export const CSV_HEADER = [
  "代號", "組別", "身分", "修學程輔系雙主修", "上次確認進度耗時",
  "手算題目", "手算開始", "手算結束", "手算耗時分", "手算合計作答", "手算各類別全對", "手算放棄", "手算標註不確定", "手算超時",
  "系統題目", "T1完成", "T1秒", "T1協助", "T1答案全對", "T2完成", "T2秒", "T2協助", "T3完成", "T3秒", "T3協助",
  "Q1比手算快", "Q2看得懂", "Q3更相信", "Q4接受不確定", "Q5會使用", "開放題", "對話traceId", "主持人備註", "是否排除", "排除理由",
  "同意", "手算通識領域全對", "手算是否符合畢業全對", "手算各類別作答", "手算通識缺領域", "手算備註", "T1合計作答", "T1缺類別作答", "T2作答", "T3作答", "熟悉系統秒",
];

const yn = (b: boolean | null | undefined) => (b === null || b === undefined ? "" : b ? "是" : "否");
const clock = (ms?: number) => (ms ? new Date(ms).toISOString() : "");

export function csvRow(s: TrialSession, mod: TrialMod): string[] {
  const mSheet = manualSheetOf(s.group);
  const sysSheet = systemSheetOf(s.group);
  const a = s.manual.answer;
  const done = !!s.manual.endedAt;
  const g = gradeManual(mSheet, a);
  const declined = s.consent?.agreed === false;
  const taskDone = (t: TaskId) => (s.tasks[t].endedAt ? !s.tasks[t].gaveUp : false);
  const t1 = gradeT1(sysSheet, s.tasks.t1);
  const excluded = s.practice || declined || mod.excluded;
  const reason = [s.practice ? "練習" : "", declined ? "不同意參與" : "", mod.excludeReason].filter(Boolean).join("；");
  return [
    s.code, s.group, s.profile?.identity ?? "", s.profile ? yn(s.profile.minorProgram) : "", s.profile?.lastCheck ?? "",
    String(mSheet), clock(s.manual.startedAt), clock(s.manual.endedAt), String(manualMinutes(s) ?? ""), String(a?.total ?? ""),
    done ? yn(g.allCategories) : "", done ? yn(!!s.manual.gaveUp) : "", done ? yn(!!a?.uncertain) : "", done ? yn(!!s.manual.timedOut) : "",
    String(sysSheet),
    s.tasks.t1.endedAt ? yn(taskDone("t1")) : "", String(secs(s.tasks.t1) ?? ""), yn(mod.help.t1),
    s.tasks.t1.endedAt ? yn(t1.total && t1.categories) : "",
    yn(mod.t2Ok), String(secs(s.tasks.t2) ?? ""), yn(mod.help.t2),
    yn(mod.t3Ok), String(secs(s.tasks.t3) ?? ""), yn(mod.help.t3),
    ...[0, 1, 2, 3, 4].map((i) => String(s.survey?.scores[i] ?? "")),
    s.survey?.open ?? "", s.traceIds.join(" "), mod.note, yn(excluded), reason,
    s.consent ? yn(s.consent.agreed) : "", done ? yn(g.domains) : "", done ? yn(g.graduate) : "",
    a ? SHEET_CATEGORIES.map((c) => `${c.name}=${a.categories[c.name] ?? ""}`).join("；") : "",
    a?.missingDomains.join("、") ?? "", a?.note ?? "",
    String(s.tasks.t1.total ?? ""), s.tasks.t1.categories?.join("、") ?? "", s.tasks.t2.text ?? "", s.tasks.t3.text ?? "",
    String(orientationSeconds(s) ?? ""),
  ];
}

/** 開頭是公式字元的儲存格加單引號，避免 Excel 把受試者輸入的文字當公式執行 */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: { session: TrialSession; mod: TrialMod }[]): string {
  const lines = [CSV_HEADER, ...rows.map((r) => csvRow(r.session, r.mod))];
  // BOM：Excel 才認得 UTF-8
  return `﻿${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** 給主持人後台看的摘要（含批改結果） */
export function moderatorView(s: TrialSession, mod: TrialMod) {
  const mSheet = manualSheetOf(s.group);
  const sysSheet = systemSheetOf(s.group);
  return {
    session: s,
    mod,
    step: stepOf(s),
    manualSheet: mSheet,
    systemSheet: sysSheet,
    manualMinutes: manualMinutes(s),
    manualGrade: s.manual.endedAt ? gradeManual(mSheet, s.manual.answer) : null,
    t1Grade: s.tasks.t1.endedAt ? gradeT1(sysSheet, s.tasks.t1) : null,
    expectedTotal: expectedTotal(sysSheet),
    manualKey: manualKeyOf(mSheet),
    seconds: { t1: secs(s.tasks.t1), t2: secs(s.tasks.t2), t3: secs(s.tasks.t3), orientation: orientationSeconds(s) },
  };
}
export type TrialModeratorView = ReturnType<typeof moderatorView>;

export const modSchema = z.object({
  help: z.object({ t1: z.boolean(), t2: z.boolean(), t3: z.boolean() }),
  t2Ok: z.boolean().nullable(),
  t3Ok: z.boolean().nullable(),
  note: text(2000),
  excluded: z.boolean(),
  excludeReason: text(500),
});
