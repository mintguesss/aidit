"use client";

import { useRef, useState } from "react";
import type { WhatIfResult } from "@/lib/types";
import { CitationToggle } from "../sources/CitationToggle";
import { Spinner } from "@/components/shell/Spinner";

/**
 * 情境試算。
 *
 * 不是聊天機器人，也刻意不做成聊天泡泡：使用者問的每一句與系統的每一個回答
 * 都是一筆「試算紀錄」，有編號、有時間、有依據，承辦人要能逐筆查核。
 *
 * LLM 只做意圖解析，推算全部由確定性程式負責；
 * 意圖不明就回問一個澄清問題，對應不到任何情境就明說不處理。
 */

type Outcome =
  | { kind: "result"; result: WhatIfResult }
  | { kind: "clarify"; question: string }
  | { kind: "out-of-scope"; message: string }
  | { kind: "error"; message: string };

type Entry = { no: number; asked: string; at: string; outcome: Outcome };

/**
 * 情境目錄。
 *
 * 情境變多之後，一排平鋪的按鈕看不出「哪些現在算得出來、哪些需要先有規定」，
 * 也看不出輔系／雙主修／轉系是三件不同的事。因此改成分組目錄，
 * 每一項標明它屬於哪一類、現在能不能算。
 *
 *   ready　立刻可推算（引擎重跑一次就有答案）
 *   needs　需要先收錄該項規定，否則系統只會告訴你缺什麼，不會給數字
 */
type Ready = "ready" | "needs";
type Item = { label: string; ask: string; ready: Ready; note: string };
type Group = { title: string; hint: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "畢業時程",
    hint: "改變時程或修課內容，重跑同一套引擎",
    items: [
      { label: "提前一學期畢業", ask: "我想提前一學期畢業，有可能嗎？", ready: "ready", note: "" },
      { label: "停修某一門課", ask: "停修專題研究（二）", ready: "ready", note: "" },
    ],
  },
  {
    title: "加修另一套規定",
    hint: "這三件事的規定完全不同，系統不會拿其中一種代替另一種",
    items: [
      {
        label: "輔系",
        ask: "申請財金系輔系",
        ready: "needs",
        note: "只修另一系的指定科目，不另發學位",
      },
      {
        label: "雙主修",
        ask: "申請財金系雙主修",
        ready: "needs",
        note: "兩系的畢業條件都要滿足，兩張學位",
      },
      {
        label: "學分學程",
        ask: "加修資訊安全學程",
        ready: "needs",
        note: "跨系的課程模組，另發學程證明",
      },
    ],
  },
  {
    title: "改變學籍",
    hint: "會換掉適用的課程規劃表版本，學分採計須逐案認定",
    items: [
      {
        label: "轉系",
        ask: "我想轉到財金系",
        ready: "needs",
        note: "已修學分能採計多少、採計到哪一類，由轉入學系認定",
      },
    ],
  },
  {
    title: "門檻查詢",
    hint: "只回報已登錄的成績，不預測未來",
    items: [
      { label: "成績門檻", ask: "研究所甄試成績門檻", ready: "ready", note: "" },
    ],
  },
];

export function ScenarioPanel({
  fixture,
  term,
  uncountedHolds,
  nextTerm,
}: {
  /** 資料來源識別；試算時一併送出，讓伺服器以相同輸入重新推導審查結果 */
  fixture: string;
  term: string;
  uncountedHolds: number;
  nextTerm: string;
}) {
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const submit = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    const no = ++seq.current;
    try {
      const res = await fetch("/api/whatif", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixture, term, scenario: q }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      const outcome: Outcome = !res.ok
        ? { kind: "error", message: String(data.error ?? "試算失敗。") }
        : data.kind === "result"
          ? { kind: "result", result: data.result as WhatIfResult }
          : data.kind === "clarify"
            ? { kind: "clarify", question: String(data.question) }
            : { kind: "out-of-scope", message: String(data.message) };

      setEntries((e) => [{ no, asked: q, at: now(), outcome }, ...e]);
      setValue("");
    } catch (err) {
      setEntries((e) => [
        { no, asked: q, at: now(), outcome: { kind: "error", message: `試算失敗：${String(err)}` } },
        ...e,
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>試算條件</h2>
        <span className="hint">以本次審查結果為基礎重新推算</span>
      </div>

      <form
        className="convo-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
      >
        <input
          type="text"
          placeholder={`例如：我想在 ${nextTerm} 畢業，有可能嗎？`}
          aria-label="輸入試算情境"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? <Spinner label="推算中…" /> : "試算"}
        </button>
      </form>

      <div className="scen-cat">
        {GROUPS.map((g) => (
          <div className="scen-grp" key={g.title}>
            <div className="scen-grp-hd">
              <b>{g.title}</b>
              <span>{g.hint}</span>
            </div>
            <ul>
              {g.items.map((it) => (
                <li key={it.label}>
                  <button type="button" disabled={busy} onClick={() => void submit(it.ask)}>
                    {it.label}
                  </button>
                  <span className={`scen-rd ${it.ready}`}>
                    {it.ready === "ready" ? "可推算" : "需先收錄規定"}
                  </span>
                  {it.note ? <span className="scen-note">{it.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {entries.length === 0 ? (
        <Empty uncountedHolds={uncountedHolds} />
      ) : (
        <div className="log">
          {entries.map((e) => (
            <EntryView key={e.no} entry={e} fallbackHolds={uncountedHolds} />
          ))}
        </div>
      )}
    </section>
  );
}

function Empty({ uncountedHolds }: { uncountedHolds: number }) {
  return (
    <div className="empty" style={{ borderTop: "1px solid var(--line)" }}>
      <b>標示「需先收錄規定」的情境，系統會告訴你缺什麼，不會給數字。</b>
      <p style={{ margin: "8px 0 0" }}>
        輔系、雙主修、學分學程、轉系都需要另一套規定才能判定。沒有規則依據時給出的學分數字，
        看起來跟真的一樣，但它是猜的 —— 在畢業審查場域，那比不回答危險得多。
        規定取得後可到「適用規劃表」頁上傳，經人工校對鎖版即可試算。
      </p>
      <p style={{ margin: "10px 0 0" }}>
        <b>不會回答的題目</b>　教師評價、被當機率、錄取機會，以及任何需要預測成績的問題。
        對應不到上述情境時，系統會明白告訴你請洽哪個單位，而不是自由發揮。
      </p>
      {uncountedHolds > 0 ? (
        <p style={{ margin: "10px 0 0", color: "var(--hold)" }}>
          注意：本次審查有 {uncountedHolds} 項待確認事項未計入，所有試算結果都建立在這個前提上。
        </p>
      ) : null}
    </div>
  );
}

function EntryView({ entry, fallbackHolds }: { entry: Entry; fallbackHolds: number }) {
  const o = entry.outcome;
  return (
    <article className="entry">
      <div className="entry-hd">
        <span className="entry-no">#{String(entry.no).padStart(2, "0")}</span>
        <span className="entry-q">{entry.asked}</span>
        <span className="entry-time">{entry.at}</span>
      </div>

      {o.kind === "clarify" ? (
        <div className="entry-body hold">
          <div className="entry-h">需要再確認一項條件</div>
          <p className="entry-p">{o.question}</p>
        </div>
      ) : o.kind === "out-of-scope" ? (
        <div className="entry-body">
          <div className="entry-h">此問題不在可推算範圍內</div>
          <p className="entry-p">{o.message}</p>
        </div>
      ) : o.kind === "error" ? (
        <div className="entry-body unmet">
          <div className="entry-h">試算未能完成</div>
          <p className="entry-p">{o.message}</p>
        </div>
      ) : (
        <ResultView r={o.result} fallbackHolds={fallbackHolds} />
      )}
    </article>
  );
}

function ResultView({ r, fallbackHolds }: { r: WhatIfResult; fallbackHolds: number }) {
  const tone = r.level === "feasible" ? "ok" : r.level === "infeasible" ? "unmet" : "hold";
  return (
    <div className={`entry-body ${tone}`}>
      <div className="entry-h">{r.headline}</div>
      <p className="entry-p">{r.detail}</p>

      {r.conflict ? (
        <div className="entry-conflict">
          <b>條件衝突</b>　「{r.conflict.a}」對「{r.conflict.b}」
          <br />
          {r.conflict.explanation}
        </div>
      ) : null}

      {r.alternatives.length > 0 ? (
        <div className="entry-sub">
          <span className="lb">替代路徑</span>
          {r.alternatives.join("　／　")}
        </div>
      ) : null}

      <CitationToggle citations={r.citations}>
        <div style={{ marginTop: 8 }}>
          本試算未計入 {r.uncountedHolds || fallbackHolds} 項待確認事項，結果可能因承辦單位認定而改變。
        </div>
      </CitationToggle>
    </div>
  );
}

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
