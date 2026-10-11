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
  type PlanUpdate,
  type Turn,
  redirectLinks,
} from "./shared";

/**
 * 調整課表：訊息泡泡版面。
 *
 * 這是一來一往的短句（「不要早八」「空出星期五」），像傳訊息，就用傳訊息的樣子：
 * 你說的在右、Aidit 回的在左（附頭像），課表的變動用「加入／移除／換班」小標籤夾在回覆泡泡裡，
 * 要看整份課表就按「看這一版」開彈出視窗。開場白就是第一則訊息，不是一段說明文字。
 */
export function Messenger(v: ChatView) {
  const [guideOpen, setGuideOpen] = useState(false);
  const taRef = useAutosize(v.input, 120);
  const planTurns = v.turns.filter((t) => t.plan).map((t) => t.id);

  return (
    <section className="msgr" aria-label={v.title}>
      <header className="msgr-hd">
        <span className="msgr-av lg" aria-hidden>
          A
        </span>
        <div className="msgr-id">
          <h2>{v.title}</h2>
          <span className={`msgr-status${v.busy ? " busy" : ""}`}>{v.busy ? "正在重排課表…" : v.hint}</span>
        </div>
        <span className="msgr-tools">
          {/* §0.7 單一 session 的輪次上限是規則，就該讓使用者看得到還剩幾輪 */}
          {v.userTurns > 0 ? (
            <span className="msgr-turns">
              {v.userTurns}/{v.maxTurns}
            </span>
          ) : null}
          <button type="button" className="msgr-tool" aria-expanded={guideOpen} onClick={() => setGuideOpen((o) => !o)}>
            怎麼用
          </button>
          {v.turns.length > 0 ? (
            <button type="button" className="msgr-tool" disabled={v.busy} onClick={v.clear}>
              清除
            </button>
          ) : null}
        </span>
      </header>

      {guideOpen ? <div className="msgr-guide">{v.guide}</div> : null}

      <div className="msgr-log">
        {/* 開場白：Aidit 的第一則訊息 */}
        <div className="msg them">
          <span className="msgr-av" aria-hidden>
            A
          </span>
          <div className="msg-col">
            <div className="bubble">{v.intro}</div>
          </div>
        </div>

        {v.turns.map((t) => (
          <MsgView
            key={t.id}
            t={t}
            v={v}
            version={t.plan ? planTurns.indexOf(t.id) + 1 : 0}
          />
        ))}
        <div ref={v.endRef} />
      </div>

      <div className="msgr-quick" role="group" aria-label="常用說法">
        {v.tips.map((t) => (
          <button key={tipText(t)} type="button" disabled={v.busy} onClick={() => v.send(tipText(t))}>
            {tipText(t)}
          </button>
        ))}
      </div>

      <form
        className="msgr-input"
        onSubmit={(e) => {
          e.preventDefault();
          v.send(v.input);
        }}
      >
        <button type="button" className="msgr-attach" disabled={v.busy} title="附加課程規劃表（.pdf／.json）" aria-label="附加檔案" onClick={v.pickFile}>
          ＋
        </button>
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
        <button className="msgr-send" type="submit" aria-label="送出" disabled={v.busy || v.input.trim() === ""}>
          <SendIcon />
        </button>
      </form>
    </section>
  );
}

function MsgView({ t, v, version }: { t: Turn; v: ChatView; version: number }) {
  if (t.role === "user") {
    return (
      <div className="msg me">
        <div className="msg-col">
          <div className="bubble">{t.text}</div>
          <span className="msg-time">{t.at}</span>
        </div>
      </div>
    );
  }

  if (t.pending) {
    return (
      <div className="msg them">
        <span className="msgr-av" aria-hidden>
          A
        </span>
        <div className="msg-col">
          <div className="bubble typing" aria-label="處理中">
            <Dots />
          </div>
        </div>
      </div>
    );
  }

  const r = t.reply!;
  return (
    <div className="msg them">
      <span className="msgr-av" aria-hidden>
        A
      </span>
      <div className="msg-col">
        <div className={`bubble ${KIND_CLASS[r.kind]}`}>
          {r.kind !== "決定" ? <span className={`msg-kind ${KIND_CLASS[r.kind]}`}>{r.kind}</span> : null}
          <ReplyText r={r} />
          {t.plan ? (
            <Change
              p={t.plan}
              version={version}
              isCurrent={t.id === v.current}
              busy={v.busy}
              onPick={v.send}
              onRestore={() => v.restore(t.id)}
              onOpen={v.onOpenPlan ? () => v.onOpenPlan!(t.plan!, `第 ${version} 版`) : undefined}
            />
          ) : null}
          {t.whatif ? <WhatIfCard r={t.whatif} /> : null}
          {redirectLinks(t.redirect, v.planHref).map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>
        <span className="msg-time">
          {t.at}
          {t.traceId ? (
            <a href={`/api/trace/${t.traceId}`} target="_blank" rel="noreferrer">
              執行紀錄
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** §1.3 每輪回報三件事：改了什麼條件、課表差異、代價 —— 縮成標籤，整份課表在彈出視窗 */
function Change({
  p,
  version,
  isCurrent,
  busy,
  onPick,
  onRestore,
  onOpen,
}: {
  p: PlanUpdate;
  version: number;
  isCurrent: boolean;
  busy: boolean;
  onPick: (s: string) => void;
  onRestore: () => void;
  onOpen?: () => void;
}) {
  const plan = p.plans[0];
  return (
    <div className="chg">
      <div className="chg-tags">
        {/* changed 為空＝條件與目前設定相同。留白會看起來像壞掉，要講出來 */}
        {p.changed.length > 0
          ? p.changed.map((c) => (
              <span className="chg-tag set" key={c}>
                {c}
              </span>
            ))
          : <span className="chg-tag none">條件沒有變動</span>}
      </div>
      <div className="chg-tags">
        {p.diff.unchanged ? <span className="chg-tag none">課表沒有變動</span> : null}
        {p.diff.added.map((c) => (
          <span className="chg-tag add" key={`a${c}`}>
            ＋ {c}
          </span>
        ))}
        {p.diff.removed.map((c) => (
          <span className="chg-tag del" key={`d${c}`}>
            − {c}
          </span>
        ))}
        {(p.diff.moved ?? []).map((c) => (
          <span className="chg-tag mv" key={`m${c}`}>
            換班 {c}
          </span>
        ))}
      </div>
      {p.costs.length > 0 ? <p className="chg-cost">代價：{p.costs.join(" ")}</p> : null}

      {p.relaxOptions.length > 0 ? (
        <div className="chg-relax">
          <span>要放寬哪一項由你決定</span>
          {p.relaxOptions.map((o) => (
            <button key={o} type="button" disabled={busy} onClick={() => onPick(o)}>
              {o}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chg-foot">
        <span className="chg-ver">
          第 {version} 版{plan ? `・${plan.totalCredits} 學分／${plan.courses.length} 門` : "・無可行課表"}
        </span>
        {plan && onOpen ? (
          <button type="button" className="chg-btn primary" onClick={onOpen}>
            看這一版
          </button>
        ) : null}
        {/* 改壞了可以直接跳回任何一版（TODO G12）；說「改回去」是退一步 */}
        {isCurrent ? (
          <span className="chg-now">目前的課表</span>
        ) : (
          <button type="button" className="chg-btn" disabled={busy} onClick={onRestore}>
            回到這一版
          </button>
        )}
      </div>
    </div>
  );
}
