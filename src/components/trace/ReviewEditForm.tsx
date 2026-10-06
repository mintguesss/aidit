"use client";

import { useState } from "react";
import type { Editable } from "@/lib/review/edit";
import type { ReviewItem } from "@/lib/review/store";
import { Spinner } from "@/components/shell/Spinner";
import { reviewHeaders } from "./review-password";

/**
 * 「需要修正」的修改表單。
 *
 * 每種項目只開放固定幾個欄位（lib/review/edit.ts 的 Editable）。存檔時伺服器跑跟上傳草稿
 * 一樣的自動驗證，不通過就逐條列出問題、不存。表單改不了的，用「留言給維護者」。
 */

type Doc = { id: string; title: string };

const toLines = (v: string[] | undefined) => (v ?? []).join("\n");
const fromLines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** 多行欄位的原始文字 */
function initialRaw(e: Editable): Record<string, string> {
  switch (e.kind) {
    case "category":
      return {
        courses: (e.courses ?? []).map((c) => `${c.code} ${c.title}`.trim()).join("\n"),
        names: toLines(e.names),
        prefixes: toLines(e.prefixes),
        excludeNames: toLines(e.excludeNames),
      };
    case "domainCoverage":
      return { domains: toLines(e.domains) };
    case "check":
      return { courseNames: toLines(e.courseNames) };
    case "termLimits":
      return {
        byStudyYear: e.byStudyYear.map((y) => `${y.fromYear} ${y.minCredits ?? "-"} ${y.maxCredits ?? "-"}`).join("\n"),
      };
    default:
      return {};
  }
}

/** 把多行欄位解析回結構；格式錯的交給伺服器的驗證回報 */
function withRaw(e: Editable, raw: Record<string, string>): Editable {
  const n = (x?: string) => (x && x !== "-" && !Number.isNaN(Number(x)) ? Number(x) : undefined);
  switch (e.kind) {
    case "category":
      return {
        ...e,
        courses: e.courses
          ? fromLines(raw.courses ?? "").map((line) => {
              const [code, ...rest] = line.split(/\s+/);
              return { code: code!, title: rest.join(" ") };
            })
          : undefined,
        names: e.names ? fromLines(raw.names ?? "") : undefined,
        prefixes: e.prefixes ? fromLines(raw.prefixes ?? "") : undefined,
        excludeNames: e.excludeNames ? fromLines(raw.excludeNames ?? "") : undefined,
      };
    case "domainCoverage":
      return { ...e, domains: fromLines(raw.domains ?? "") };
    case "check":
      return { ...e, courseNames: fromLines(raw.courseNames ?? "") };
    case "termLimits":
      return {
        ...e,
        byStudyYear: fromLines(raw.byStudyYear ?? "").map((line) => {
          const [y, lo, hi] = line.split(/\s+/);
          return { fromYear: Number(y), minCredits: n(lo), maxCredits: n(hi) };
        }),
      };
    default:
      return e;
  }
}

const RULES: { value: Extract<Editable, { kind: "check" }>["rule"]; label: string }[] = [
  { value: "evidence", label: "請學生自行確認（成績單看不出來）" },
  { value: "passedCourse", label: "看成績單上的課名" },
  { value: "deptDefined", label: "由系上另訂（文件沒寫標準）" },
];

export function ReviewEditForm({
  item,
  docs,
  packId,
  draftHash,
  reviewer,
  password,
  freeCategory,
  onCancel,
  onNoteOnly,
}: {
  item: ReviewItem;
  docs: Doc[];
  packId: string;
  draftHash: string;
  reviewer: string;
  password: string;
  /** 承接類別（其他選修）目前的學分與名稱；改學分時可選擇一併調整 */
  freeCategory: { name: string; credits: number; othersExcludingThis: number; minCredits: number } | null;
  onCancel: () => void;
  onNoteOnly: () => void;
}) {
  const original = item.editable!;
  const [v, setV] = useState<Editable>(structuredClone(original));
  // 多行欄位保留原始文字，存檔時才解析 —— 每打一個字就解析的話，換行會被立刻吃掉
  const [raw, setRaw] = useState<Record<string, string>>(() => initialRaw(original));
  const setRawField = (k: string) => (s: string) => setRaw((r) => ({ ...r, [k]: s }));
  const [reason, setReason] = useState("");
  const [rebalance, setRebalance] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<Editable>) => setV((cur) => ({ ...cur, ...p }) as Editable);
  const setCit = (p: Partial<Editable["citation"]>) => setV((cur) => ({ ...cur, citation: { ...cur.citation, ...p } }) as Editable);

  const creditsChanged = v.kind === "category" && original.kind === "category" && v.credits !== original.credits;
  const canRebalance = creditsChanged && v.kind === "category" && v.matchType !== "anyPassed" && freeCategory;

  const save = async () => {
    if (!reviewer.trim()) {
      setProblems(["請先在頁面上方填寫你的姓名或代號。"]);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: reviewHeaders(password),
        body: JSON.stringify({
          action: "edit",
          packId,
          itemId: item.id,
          draftHash,
          values: withRaw(v, raw),
          reason,
          reviewer: reviewer.trim(),
          options: { rebalanceFree: Boolean(canRebalance && rebalance) },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; problems?: string[] };
      if (res.ok) {
        // 重新載入新版草稿；載入完成前維持「存檔中」
        window.location.reload();
        return;
      }
      else setProblems(data.problems ?? [data.error ?? "存檔失敗。"]);
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {input}
      {hint ? <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>{hint}</div> : null}
    </label>
  );
  const inputStyle = { width: "100%", padding: "6px 8px", fontSize: 14, border: "1px solid var(--line)", borderRadius: 4 };
  const num = (value: number | null, on: (n: number | null) => void, allowEmpty = false) => (
    <input
      type="number"
      min={0}
      style={{ ...inputStyle, width: 120 }}
      value={value ?? ""}
      onChange={(e) => on(e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))}
    />
  );
  const area = (value: string, on: (s: string) => void, rows = 4) => (
    <textarea style={{ ...inputStyle, fontFamily: "inherit" }} rows={rows} value={value} onChange={(e) => on(e.target.value)} />
  );

  return (
    <div className="note" style={{ marginTop: 12, background: "var(--surface)", border: "2px solid var(--hold)" }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>修改這一項</div>

      {v.kind === "minCredits" ? field("畢業最低學分", num(v.minCredits, (n) => patch({ minCredits: n ?? 0 }))) : null}

      {v.kind === "category" ? (
        <>
          {field("學分", num(v.credits, (n) => patch({ credits: n ?? 0 })))}
          {canRebalance ? (
            <label style={{ display: "flex", gap: 6, fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={rebalance} onChange={(e) => setRebalance(e.target.checked)} />
              同時把「{freeCategory!.name}」改成{" "}
              {freeCategory!.minCredits - freeCategory!.othersExcludingThis - (v.credits ?? 0)} 學分，讓各類加起來仍是{" "}
              {freeCategory!.minCredits}
            </label>
          ) : null}
          {v.courses
            ? field(
                "算在這一類的課（一行一門：課號 空格 課名）",
                area(raw.courses!, setRawField("courses"), Math.min(20, v.courses.length + 2)),
                "例如「02390 微積分」。課號以科目表為準；課名只用來顯示。",
              )
            : null}
          {v.names
            ? field(
                "成績單上的課名，一字不差（一行一個）",
                area(raw.names!, setRawField("names"), 3),
              )
            : null}
          {v.prefixes
            ? field(
                "課名開頭（一行一個）",
                area(raw.prefixes!, setRawField("prefixes"), 2),
                "例如填「外國語文」，成績單上的「外國語文(中級英文)」「外國語文(基礎日文)」都算。",
              )
            : null}
          {v.excludeNames
            ? field(
                "本系開、但不算在這一類的課名（一行一個）",
                area(raw.excludeNames!, setRawField("excludeNames"), 2),
                "沒有就留空。",
              )
            : null}
        </>
      ) : null}

      {v.kind === "domainCoverage" ? (
        <>
          {field("領域名稱（一行一個）", area(raw.domains!, setRawField("domains"), 3))}
          {field(
            "每個領域至少幾學分",
            num(v.minCreditsPerDomain, (n) => patch({ minCreditsPerDomain: n }), true),
            "留空表示只要求每個領域至少一門。",
          )}
        </>
      ) : null}

      {v.kind === "deptCredits"
        ? field("至少幾學分要是本系開的選修", num(v.minCredits, (n) => patch({ minCredits: n ?? 1 })))
        : null}

      {v.kind === "check" ? (
        <>
          {field("名稱", <input style={inputStyle} value={v.name} onChange={(e) => patch({ name: e.target.value })} />)}
          {field(
            "系統怎麼判斷",
            <select
              style={inputStyle}
              value={v.rule}
              onChange={(e) => patch({ rule: e.target.value as Extract<Editable, { kind: "check" }>["rule"] })}
            >
              {RULES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>,
          )}
          {v.rule === "passedCourse" ? (
            <>
              {field(
                "成績單上的課名，一字不差（一行一個）",
                area(raw.courseNames!, setRawField("courseNames"), 2),
              )}
              {field("至少要修幾個學期", num(v.minTerms, (n) => patch({ minTerms: n ?? 1 })))}
            </>
          ) : null}
        </>
      ) : null}

      {v.kind === "overflow"
        ? field(
            "修超過規定的學分",
            <select
              style={inputStyle}
              value={v.countsToTotal ? "yes" : "no"}
              onChange={(e) => patch({ countsToTotal: e.target.value === "yes" })}
            >
              <option value="no">不算進畢業總學分</option>
              <option value="yes">仍算進畢業總學分</option>
            </select>,
            "不論哪一種，修超過的學分都不能拿去抵其他類別。",
          )
        : null}

      {v.kind === "termLimits" ? (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {field("每學期最少", num(v.minCredits, (n) => patch({ minCredits: n ?? 0 })))}
            {field("每學期最多", num(v.maxCredits, (n) => patch({ maxCredits: n ?? 0 })))}
          </div>
          {field(
            "依學年調整（一行一筆：從第幾學年起 最少 最多）",
            area(raw.byStudyYear!, setRawField("byStudyYear"), 2),
            "例如「4 9 32」表示第 4 學年起最少 9、最多 32；不調整的寫「-」。",
          )}
        </>
      ) : null}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
        {field(
          "依據的原文句子",
          area(v.citation.quote, (s) => setCit({ quote: s }), 2),
          "從右邊的原文或原始文件複製那一句貼上。系統會檢查原文裡真的有這句話，改過的數字也要出現在這句話裡。",
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 260px" }}>
            {field(
              "出自哪份文件",
              <select style={inputStyle} value={v.citation.docId} onChange={(e) => setCit({ docId: e.target.value })}>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>,
            )}
          </div>
          <div style={{ flex: "1 1 160px" }}>
            {field(
              "位置",
              <input style={inputStyle} value={v.citation.locator} onChange={(e) => setCit({ locator: e.target.value })} />,
              "例如「第 1 頁 第二條（一）」",
            )}
          </div>
        </div>
        {field("為什麼要改（必填，會記在修改紀錄）", area(reason, setReason, 2))}
      </div>

      {problems.length ? (
        <div className="note warn" style={{ marginBottom: 12 }}>
          <b>沒有存檔，請先處理：</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Spinner label="檢查與存檔中…" /> : "存檔"}
        </button>
        <button className="btn" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button className="btn" disabled={busy} onClick={onNoteOnly} style={{ marginLeft: "auto" }}>
          這裡改不了，留言給維護者
        </button>
      </div>
    </div>
  );
}
