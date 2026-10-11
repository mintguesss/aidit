"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WhatIfResult } from "@/lib/types";
import { WhatIfSections } from "../chat/shared";
import { CitationToggle } from "../sources/CitationToggle";
import { Spinner } from "@/components/shell/Spinner";

/**
 * 情境試算。
 *
 * 輸入框做成一句填空：「如果我＿＿＿，會怎樣？」—— 使用者只要想「要改什麼」，
 * 空格裡會輪流打出例子，按「換一個」可以直接借用。問完的每一筆仍是一筆試算紀錄
 * （有編號、有時間、有依據），承辦人要能逐筆查核。
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
 * 情境目錄。分組卡片，每一項標明現在能不能算：
 *   ready　立刻可推算（引擎重跑一次就有答案）
 *   needs　需要先收錄該項規定，否則系統只會告訴你缺什麼，不會給數字
 * 補充說明不常駐：卡片右上角「說明」把卡片翻到背面看。
 */
type Ready = "ready" | "needs";
type Item = { label: string; ask: string; ready: Ready; note: string };
type Group = { title: string; hint: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "畢業時程",
    hint: "改變時程或修課內容，用同一套引擎重算。",
    items: [
      { label: "提前一學期畢業", ask: "我想提前一學期畢業，有可能嗎？", ready: "ready", note: "看下學期修完能不能補足所有缺口。" },
      { label: "停修某一門課", ask: "停修專題研究（二）", ready: "ready", note: "拿掉這門課之後，哪一類會變成不足。" },
      { label: "下學期修某一門課", ask: "如果我下學期修生死學會怎樣？", ready: "ready", note: "這門課算哪一類、採計方式確不確定。" },
    ],
  },
  {
    title: "加修另一套規定",
    hint: "三件事的規定完全不同，系統不會拿其中一種代替另一種。依學校的雙主修、輔系、學程辦法計算。",
    items: [
      { label: "雙主修", ask: "如果我雙主修心理系會怎樣？", ready: "ready", note: "要修完另一系全部專業必修（至少 40 學分），兩張學位。有收錄科目表的系會算出還差哪些課、每學期要修多少；沒收錄的講學校規定與缺哪份資料。" },
      { label: "輔系", ask: "如果我修心理系輔系會怎樣？", ready: "ready", note: "至少修另一系 20 學分的專業必修，不另發學位。算法同雙主修。" },
      { label: "學分學程", ask: "如果我修雲端學程會怎樣？", ready: "ready", note: "跨系的課程模組，另發學程證明；可事先申請，也可修完後申請認定。有收錄修習要點的學程會算出還差哪些課。" },
    ],
  },
  {
    title: "改變學籍",
    hint: "會換掉適用的規劃表版本，學分採計要逐案認定。",
    items: [
      { label: "轉系", ask: "我想轉到財金系", ready: "needs", note: "已修學分能採計多少、採計到哪一類，由轉入學系認定。" },
    ],
  },
  {
    title: "門檻查詢",
    hint: "只回報已登錄的成績，不預測未來。",
    items: [{ label: "成績門檻", ask: "研究所甄試成績門檻", ready: "ready", note: "依已登錄成績計算，不推估之後的分數。" }],
  },
];

/** 空格裡輪流打出來的例子；「換一個」也從這裡抽 */
const EXAMPLES = [
  "提前一學期畢業",
  "停修專題研究（二）",
  "下學期修生死學",
  "申請財金系輔系",
  "轉到財金系",
  "加修資訊安全學程",
];

/** 使用者只填空格時，補成完整的一句；自己打了整句就照原樣送 */
function toSentence(q: string): string {
  if (/^(如果|假如|要是|我)/.test(q) || /[？?]$/.test(q)) return q;
  return `如果我${q}，會怎樣？`;
}

export function ScenarioPanel({
  fixture,
  term,
  uncountedHolds,
}: {
  /** 資料來源識別；試算時一併送出，讓伺服器以相同輸入重新推導審查結果 */
  fixture: string;
  term: string;
  uncountedHolds: number;
  nextTerm?: string;
}) {
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [shake, setShake] = useState(false);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const typed = useTypewriter(EXAMPLES, !focused && value === "");
  const search = `?fixture=${fixture}&term=${term}`;

  const submit = async (text: string) => {
    const raw = text.trim();
    if (!raw || busy) return;
    const q = toSentence(raw);
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
      requestAnimationFrame(() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
  };

  const borrow = () => {
    const pool = EXAMPLES.filter((x) => x !== value);
    setValue(pool[Math.floor(Math.random() * pool.length)]!);
    // 只換 class 觸發動畫，不重新掛載輸入框，焦點才不會跑掉
    setShake(true);
    setTimeout(() => setShake(false), 420);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="scen">
      {/* 一句填空：如果我＿＿＿，會怎樣？ */}
      <form
        className={`wi${busy ? " busy" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value || typed.full);
        }}
      >
        <label className="wi-line">
          <span className="wi-word">如果我</span>
          <span className={`wi-blank${shake ? " pop" : ""}`}>
            <input
              data-anon-keep
              ref={inputRef}
              type="text"
              aria-label="輸入試算情境"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              disabled={busy}
              size={1}
            />
            {value === "" ? (
              <span className="wi-ghost" aria-hidden>
                {focused ? "想改變什麼？" : typed.text}
                {!focused ? <i className="wi-caret" /> : null}
              </span>
            ) : null}
          </span>
          <span className="wi-word">，會怎樣？</span>
        </label>
        <div className="wi-row">
          <button type="button" className="wi-dice" onClick={borrow} disabled={busy}>
            <span className="wi-dice-ic" aria-hidden />
            換一個
          </button>
          {entries.length > 0 ? <span className="wi-count">已試算 {entries.length} 次</span> : null}
          <button className="wi-go" type="submit" disabled={busy}>
            {busy ? <Spinner label="推算中…" /> : <>試算 <span aria-hidden>→</span></>}
          </button>
        </div>
      </form>

      {entries.length > 0 ? (
        <div className="log scen-log" ref={logRef}>
          {entries.map((e) => (
            <EntryView key={e.no} entry={e} fallbackHolds={uncountedHolds} />
          ))}
        </div>
      ) : null}

      {/* 情境目錄 */}
      <div className="scen-hd">
        <h2>可以試算的情境</h2>
        <span className="scen-legend">
          <span className="scen-rd ready">可推算</span>馬上有結果
          <span className="scen-rd needs">需先收錄規定</span>只說缺什麼
        </span>
      </div>
      <div className="scen-grid">
        {GROUPS.map((g) => (
          <GroupCard key={g.title} g={g} busy={busy} onAsk={(a) => void submit(a)} />
        ))}
      </div>

      {/* 系統的界線 */}
      <div className="scen-hd">
        <h2>系統的界線</h2>
      </div>
      {/* 兩組圓：左邊三個圓沿著虛線箭頭走成一條之字形的流程，右邊一個圓被四個「不回答」圍住 */}
      <div className="bound2">
        <div className="bz">
          <h3>沒有規定，就不給數字</h3>
          <div className="bz-canvas flow">
            <svg className="bz-lines" viewBox="0 0 460 330" aria-hidden>
              <defs>
                <marker id="bz-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L10 5L0 10z" fill="currentColor" />
                </marker>
              </defs>
              <path d="M118 158 C 128 205, 140 228, 152 236" markerEnd="url(#bz-arrow)" />
              <path d="M276 214 C 300 206, 310 196, 316 186" markerEnd="url(#bz-arrow)" />
            </svg>
            <div className="bc c1">
              <b>你問</b>
              <span>輔系・雙主修</span>
              <span>學程・轉系</span>
            </div>
            <div className="bc c2">
              <b>系統查</b>
              <span>那一套規定</span>
              <span>有沒有收錄</span>
            </div>
            <div className="bc c3">
              <b>沒收錄</b>
              <span>只告訴你</span>
              <span>缺哪一份</span>
              <em>不給數字</em>
            </div>
          </div>
          <p>猜出來的學分數字看起來跟真的一樣，在畢業審查裡比不回答更危險。</p>
          <Link className="bound-go" href={`/rulepack${search}`}>
            有那份規定？到適用規劃表上傳 →
          </Link>
        </div>

        <div className="bz">
          <h3>這些不會回答</h3>
          <div className="bz-canvas no">
            <div className="bc core">
              <b>不回答</b>
              <span>改告訴你</span>
              <span>該找哪個單位</span>
            </div>
            <div className="bc ban b1">教師評價</div>
            <div className="bc ban b2">被當機率</div>
            <div className="bc ban b3">錄取機會</div>
            <div className="bc ban b4">預測成績</div>
          </div>
          <p>對應不到情境時不自由發揮，直接說該找誰。</p>
        </div>
      </div>

      {uncountedHolds > 0 ? (
        <Link className="bound-hold" href={`/holds${search}`}>
          <b>{uncountedHolds}</b> 項待確認事項沒有算進任何試算結果 <span>查看 →</span>
        </Link>
      ) : null}
    </div>
  );
}

/** 一組情境一張卡；按「說明」翻到背面看每一項的補充，再按一次翻回來 */
function GroupCard({ g, busy, onAsk }: { g: Group; busy: boolean; onAsk: (ask: string) => void }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={`scard${flipped ? " flipped" : ""}`}>
      <div className="scard-in">
        <div className="scard-face front" aria-hidden={flipped}>
          <div className="scard-hd">
            <h3>{g.title}</h3>
            <button type="button" className="scard-flip" onClick={() => setFlipped(true)} tabIndex={flipped ? -1 : 0}>
              說明
            </button>
          </div>
          <ul className="scard-items">
            {g.items.map((it) => (
              <li key={it.label}>
                <button
                  type="button"
                  className={`scard-ask ${it.ready}`}
                  disabled={busy}
                  tabIndex={flipped ? -1 : 0}
                  onClick={() => onAsk(it.ask)}
                >
                  <span className="scard-label">{it.label}</span>
                  <span className={`scen-rd ${it.ready}`}>{it.ready === "ready" ? "可推算" : "需先收錄規定"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="scard-face back" aria-hidden={!flipped}>
          <div className="scard-hd">
            <h3>{g.title}</h3>
            <button type="button" className="scard-flip" onClick={() => setFlipped(false)} tabIndex={flipped ? 0 : -1}>
              翻回去
            </button>
          </div>
          <p className="scard-hint">{g.hint}</p>
          <dl className="scard-notes">
            {g.items.map((it) => (
              <div key={it.label}>
                <dt>{it.label}</dt>
                <dd>{it.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

/** 空格裡一個字一個字打出例子，打完停一下再刪掉、換下一個 */
function useTypewriter(words: string[], running: boolean) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [del, setDel] = useState(false);

  useEffect(() => {
    if (!running) return;
    const w = words[i % words.length]!;
    const delay = del ? 45 : n === w.length ? 1400 : 110;
    const t = setTimeout(() => {
      if (!del && n === w.length) setDel(true);
      else if (del && n === 0) {
        setDel(false);
        setI((x) => x + 1);
      } else setN((x) => x + (del ? -1 : 1));
    }, delay);
    return () => clearTimeout(t);
  }, [running, words, i, n, del]);

  const full = words[i % words.length]!;
  return { text: full.slice(0, n), full };
}

function EntryView({ entry, fallbackHolds }: { entry: Entry; fallbackHolds: number }) {
  const o = entry.outcome;
  return (
    <article className="entry">
      <div className="entry-hd">
        <span className="entry-no">#{String(entry.no).padStart(2, "0")}</span>
        <span className="entry-q" data-anon-keep>
          {entry.asked}
        </span>
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
      {r.sections?.length ? <WhatIfSections sections={r.sections} /> : <p className="entry-p">{r.detail}</p>}

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
          {r.alternatives.length === 1 ? (
            r.alternatives[0]
          ) : (
            <ul className="wi-sec-list">
              {r.alternatives.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
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
