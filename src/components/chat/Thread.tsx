"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dots,
  KIND_CLASS,
  ReplyText,
  SendIcon,
  WhatIfCard,
  enterToSend,
  tipText,
  useAutosize,
  type ChatView,
  type Turn,
  redirectLinks,
} from "./shared";

/**
 * 修業問答：問答串版面。
 *
 * 這裡的問題通常一次一題、答案比較長（規定、數字、出處），像在查資料而不是傳訊息，
 * 所以不用泡泡：你的問題是一個標題，答案在下面攤開成段落，依據接在答案後面。
 * 還沒開始時是一個置中的起始畫面，常見問題做成可以直接點的卡片。
 * 輸入框浮在畫面底部，捲到哪裡都能接著問。
 */
export function Thread(v: ChatView) {
  const [guideOpen, setGuideOpen] = useState(false);
  const taRef = useAutosize(v.input, 200);
  const empty = v.turns.length === 0;

  // 一問一答配成一組
  const pairs: { q: Turn; a?: Turn }[] = [];
  for (const t of v.turns) {
    if (t.role === "user") pairs.push({ q: t });
    else if (pairs.length > 0 && !pairs[pairs.length - 1]!.a) pairs[pairs.length - 1]!.a = t;
    else pairs.push({ q: { id: -t.id, role: "user", at: t.at }, a: t });
  }

  return (
    <section className={`qa${empty ? " empty" : ""}`} aria-label={v.title}>
      <header className="qa-hd">
        <h2>{v.title}</h2>
        {v.stamp ? <span className="stamp">{v.stamp}</span> : null}
        <span className="qa-tools">
          {v.userTurns > 0 ? (
            <span className="qa-turns">
              第 {v.userTurns} / {v.maxTurns} 題
            </span>
          ) : null}
          <button type="button" className="qa-tool" aria-expanded={guideOpen} onClick={() => setGuideOpen((o) => !o)}>
            怎麼回答的
          </button>
          {!empty ? (
            <button type="button" className="qa-tool" disabled={v.busy} onClick={v.clear}>
              重新開始
            </button>
          ) : null}
        </span>
      </header>

      {guideOpen ? <div className="qa-guide">{v.guide}</div> : null}

      {empty ? (
        <div className="qa-hero">
          <p className="qa-hello">想問什麼？</p>
          <p className="qa-sub">{v.intro}</p>
          <div className="qa-sugg">
            {v.tips.map((t, i) => (
              <button
                key={tipText(t)}
                type="button"
                disabled={v.busy}
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => v.send(tipText(t))}
              >
                {typeof t !== "string" ? <span className="qa-sugg-k">{t.k}</span> : null}
                <span className="qa-sugg-q">{tipText(t)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="qa-log">
          {pairs.map((p, i) => (
            <article className="qa-pair" key={p.q.id}>
              {p.q.text ? (
                <div className="qa-q">
                  <span className="qa-n">Q{i + 1}</span>
                  <h3>{p.q.text}</h3>
                </div>
              ) : null}
              {p.a ? <Answer t={p.a} planHref={v.planHref} /> : null}
            </article>
          ))}
          <div ref={v.endRef} />
        </div>
      )}

      <div className="qa-dock">
        <form
          className="qa-box"
          onSubmit={(e) => {
            e.preventDefault();
            v.send(v.input);
          }}
        >
          <textarea
            ref={taRef}
            rows={1}
            placeholder={v.placeholder}
            aria-label={v.title}
            value={v.input}
            onChange={(e) => v.setInput(e.target.value)}
            onKeyDown={enterToSend(() => v.send(v.input))}
            disabled={v.busy}
          />
          <div className="qa-box-row">
            <button type="button" className="qa-attach" disabled={v.busy} title="課程規劃表（.pdf／.json）" onClick={v.pickFile}>
              ＋ 附加檔案
            </button>
            {v.rulepackHref ? (
              <Link className="qa-more" href={v.rulepackHref}>
                規劃表版本不對？
              </Link>
            ) : null}
            <button className="qa-send" type="submit" aria-label="送出" disabled={v.busy || v.input.trim() === ""}>
              {v.busy ? <Dots /> : <SendIcon />}
            </button>
          </div>
        </form>
        {!empty ? (
          <div className="qa-chips">
            {v.tips.slice(0, 4).map((t) => (
              <button key={tipText(t)} type="button" disabled={v.busy} onClick={() => v.send(tipText(t))}>
                {tipText(t)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const KIND_LABEL = { 決定: "有答案", 不確定: "查不到明確答案", 超出範圍: "不在服務範圍" } as const;

function Answer({ t, planHref }: { t: Turn; planHref?: string }) {
  if (t.pending) {
    return (
      <div className="qa-a pending">
        <span className="qa-a-mark" aria-hidden />
        <div className="qa-a-body">
          <span className="qa-thinking">
            <Dots />
            查詢中
          </span>
        </div>
      </div>
    );
  }
  const r = t.reply!;
  return (
    <div className={`qa-a ${KIND_CLASS[r.kind]}`}>
      <span className="qa-a-mark" aria-hidden />
      <div className="qa-a-body">
        <span className={`qa-kind ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
        <ReplyText r={r} />
        {t.whatif ? <WhatIfCard r={t.whatif} /> : null}
        {redirectLinks(t.redirect, planHref).map((l) => (
          <Link key={l.href} className="qa-go" href={l.href}>
            {l.label}
          </Link>
        ))}
        <div className="qa-a-foot">
          <span>{t.at}</span>
          {t.traceId ? (
            <a href={`/api/trace/${t.traceId}`} target="_blank" rel="noreferrer">
              本題執行紀錄
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
