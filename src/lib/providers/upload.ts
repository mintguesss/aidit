import type { CourseRecord, Student, StudentRecord, Term } from "@/lib/types";
import type { Capabilities, CourseRecordProvider } from "./types";

/**
 * 學生自行從校務系統匯出的檔案解析（SPEC.md §4）。
 *
 * 刻意只接受「學生自己拿得到的匯出檔」：系統不代為登入、不儲存帳密。
 * 解析失敗的欄位一律拋錯並指出行號，不做任何補值猜測。
 */

export type UploadPayload = {
  /** 檔案內容 */
  content: string;
  format?: "csv" | "html" | "auto";
  /** 匯出檔通常不含學籍欄位，由使用者於前端確認後帶入 */
  student: Pick<Student, "dept" | "admissionYear" | "actualAdmissionYear" | "program"> &
    Partial<Pick<Student, "status" | "className" | "maskedId">>;
};

export class UploadProvider implements CourseRecordProvider {
  readonly kind = "upload" as const;
  private last: StudentRecord | null = null;

  async fetch(input?: unknown): Promise<StudentRecord> {
    const payload = assertPayload(input);
    const format = payload.format && payload.format !== "auto" ? payload.format : sniff(payload.content);
    const rows = format === "html" ? parseHtmlTable(payload.content) : parseCsv(payload.content);
    if (rows.length === 0) throw new UploadError("匯出檔中找不到任何修課紀錄列。");

    const header = rows[0]!;
    const map = mapColumns(header);
    const courses: CourseRecord[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      if (row.every((cell) => cell.trim() === "")) continue;
      courses.push(toCourse(row, map, i + 1));
    }

    const record: StudentRecord = {
      student: {
        // 匯出檔不含可識別資訊；代號由伺服器產生，永不回寫學號
        id: `S-UPLOAD-${Date.now().toString(36)}`,
        dept: payload.student.dept,
        admissionYear: payload.student.admissionYear,
        actualAdmissionYear: payload.student.actualAdmissionYear,
        program: payload.student.program,
        status: payload.student.status ?? "enrolled",
        className: payload.student.className,
        maskedId: payload.student.maskedId,
      },
      courses,
      fetchedAt: new Date().toISOString(),
      source: "upload",
      // 匯出檔通常不含檢定佐證 —— 缺項一律進 holds，不猜測
      graduationEvidence: undefined,
    };
    this.last = record;
    return record;
  }

  capabilities(): Capabilities {
    return {
      hasWaivers: this.last?.courses.some((c) => c.status === "waived") ?? false,
      hasEnrollment: this.last?.courses.some((c) => c.status === "in_progress") ?? false,
      hasCertPrograms: false,
      hasGraduationEvidence: false,
    };
  }
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

function assertPayload(input: unknown): UploadPayload {
  if (!input || typeof input !== "object") throw new UploadError("缺少上傳內容。");
  const p = input as Partial<UploadPayload>;
  if (typeof p.content !== "string" || p.content.trim() === "") throw new UploadError("上傳檔案為空。");
  if (!p.student) throw new UploadError("缺少學籍欄位（系所、入學學年、學制）。");
  return p as UploadPayload;
}

function sniff(content: string): "csv" | "html" {
  return /<\s*table/i.test(content) ? "html" : "csv";
}

// ---------------------------------------------------------------- CSV

/** 支援引號跳脫與 CRLF 的最小 CSV 解析；不引入外部套件以縮小攻擊面 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- HTML

/** 校務系統匯出的 HTML 表格：只取第一個 table，不執行任何腳本 */
export function parseHtmlTable(html: string): string[][] {
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) throw new UploadError("HTML 檔中找不到 <table>。");
  const rows: string[][] = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) =>
      decodeEntities(cell.replace(/<[^>]+>/g, "")).trim(),
    );
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

// ------------------------------------------------------------ 欄位對應

type ColumnMap = Record<string, number>;

const ALIASES: Record<string, string[]> = {
  code: ["課號", "科目代號", "科目代碼", "課程代碼", "code"],
  name: ["科目名稱", "課程名稱", "科目", "name"],
  credits: ["學分", "學分數", "credits"],
  year: ["學年", "學年度", "year"],
  term: ["學期", "term"],
  selectType: ["選別", "修別", "課別", "selecttype"],
  score: ["成績", "分數", "score"],
  status: ["狀態", "修課狀態", "status"],
  generalDomain: ["通識領域", "領域", "generaldomain"],
  offeringDept: ["開課單位", "開課系所", "dept"],
  offeringCollege: ["開課學院", "學院", "college"],
  equivalentOf: ["對照課號", "抵免對照", "equivalentof"],
  waiverSource: ["抵免來源", "抵免說明", "waiversource"],
};

const REQUIRED_COLS = ["code", "name", "credits", "year", "term"] as const;

function mapColumns(header: string[]): ColumnMap {
  const norm = header.map((h) => h.replace(/\s/g, "").toLowerCase());
  const map: ColumnMap = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = norm.findIndex((h) => names.some((n) => h === n.toLowerCase()));
    if (idx >= 0) map[field] = idx;
  }
  const missing = REQUIRED_COLS.filter((f) => map[f] === undefined);
  if (missing.length > 0) {
    throw new UploadError(
      `匯出檔缺少必要欄位：${missing.map((m) => ALIASES[m]![0]).join("、")}。實際標題列為：${header.join(" / ")}`,
    );
  }
  return map;
}

const SELECT_TYPE: Record<string, CourseRecord["selectType"]> = {
  必修: "required",
  必: "required",
  選修: "elective",
  選: "elective",
  通識: "general",
  通: "general",
  required: "required",
  elective: "elective",
  general: "general",
};

const STATUS: Record<string, CourseRecord["status"]> = {
  及格: "passed",
  通過: "passed",
  不及格: "failed",
  未通過: "failed",
  修課中: "in_progress",
  進行中: "in_progress",
  停修: "withdrawn",
  撤選: "withdrawn",
  抵免: "waived",
  passed: "passed",
  failed: "failed",
  in_progress: "in_progress",
  withdrawn: "withdrawn",
  waived: "waived",
};

function cellOf(row: string[], map: ColumnMap, field: string): string {
  const idx = map[field];
  return idx === undefined ? "" : (row[idx] ?? "").trim();
}

function toCourse(row: string[], map: ColumnMap, lineNo: number): CourseRecord {
  const fail = (msg: string): never => {
    throw new UploadError(`第 ${lineNo} 列：${msg}`);
  };

  const code = cellOf(row, map, "code");
  if (!code) fail("課號為空。");

  const credits = Number(cellOf(row, map, "credits"));
  if (!Number.isFinite(credits) || credits < 0) fail(`學分「${cellOf(row, map, "credits")}」無法解析。`);

  const year = Number(cellOf(row, map, "year"));
  if (!Number.isInteger(year)) fail(`學年「${cellOf(row, map, "year")}」無法解析。`);

  const termRaw = cellOf(row, map, "term");
  const term: Term =
    termRaw === "1" || termRaw === "上" ? 1 : termRaw === "2" || termRaw === "下" ? 2 : termRaw.includes("暑") ? "summer" : fail(`學期「${termRaw}」無法解析。`);

  const selectRaw = cellOf(row, map, "selectType").replace(/\s/g, "");
  const selectType = SELECT_TYPE[selectRaw] ?? SELECT_TYPE[selectRaw.toLowerCase()];
  if (!selectType) fail(`選別「${selectRaw}」無法解析，請確認匯出檔的修別欄位。`);

  const scoreRaw = cellOf(row, map, "score");
  const score = scoreRaw === "" || /[^\d.]/.test(scoreRaw) ? null : Number(scoreRaw);

  const statusRaw = cellOf(row, map, "status").replace(/\s/g, "");
  const status =
    STATUS[statusRaw] ??
    STATUS[statusRaw.toLowerCase()] ??
    // 無狀態欄位時由成績推定：這是唯一允許的推定，且僅依「有無成績」與及格線
    (score === null ? "in_progress" : score >= 60 ? "passed" : "failed");

  return {
    code,
    name: cellOf(row, map, "name"),
    credits,
    year,
    term,
    selectType: selectType!,
    status,
    score,
    generalDomain: cellOf(row, map, "generalDomain") || undefined,
    offeringDept: cellOf(row, map, "offeringDept") || undefined,
    offeringCollege: cellOf(row, map, "offeringCollege") || undefined,
    equivalentOf: cellOf(row, map, "equivalentOf") || undefined,
    waiverSource: cellOf(row, map, "waiverSource") || undefined,
  };
}
