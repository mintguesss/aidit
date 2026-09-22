"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Citation, ExclusionReason, Infeasibility, Plan, WhatIfResult } from "@/lib/types";
import { LIMITS, type ConstraintSet, type Reply, type ReplyKind } from "@/lib/chat/types";
import { CitationToggle } from "../sources/CitationToggle";

/**
 * 對話框（CONVERSATION.md §3）。
 *
 * 三種回答各有固定的視覺：
 *   決定     藍色左帶，附依據
 *   不確定   琥珀色左帶，列出查過什麼、建議洽詢誰
 *   超出範圍 灰色左帶，一句話指向正確管道
 *
 * 需要重新推算的結果（課表、試算、排除原因）以卡片夾在該則回覆下方，
 * 讓「問了什麼 → 系統算了什麼 → 依據是什麼」在同一個位置看得完。
 */

export type PlanUpdate = {
  plans: Plan[];
  conflicts?: Infeasibility[];
  constraints: ConstraintSet;
  constraintLabels: string[];
  changed: string[];
  diff: { added: string[]; removed: string[]; unchanged: boolean };
  costs: string[];
  relaxOptions: string[];
};

type Turn = {
  id: number;
  role: "user" | "assistant";
  text?: string;
  at: string;
  reply?: Reply;
  plan?: PlanUpdate;
  whatif?: WhatIfResult;
  explanation?: ExclusionReason;
  redirect?: "plan";
  traceId?: string;
  pending?: boolean;
};

const KIND_CLASS: Record<ReplyKind, string> = {
  決定: "decided",
  不確定: "uncertain",
  超出範圍: "outside",
};

export function ChatPanel({
  title,
  hint,
  scope,
  fixture,
  term,
  placeholder,
  tips,
  guide,
  intro,
  constraints,
  onPlanUpdate,
  planHref,
  rulepackHref,
  stamp,
}: {
  title: string;
  hint: string;
  scope: "plan" | "ask";
  fixture: string;
  term: string;
  placeholder: string;
  tips: string[];
  guide: ReactNode;
  /** 空白狀態的一句話；完整規則收在上方的可展開區塊 */
  intro: string;
  constraints?: ConstraintSet;
  onPlanUpdate?: (u: PlanUpdate) => void;
  planHref?: string;
  /** 附加檔案的去向：規劃表上傳頁 */
  rulepackHref?: string;
  /** 這一頁只有對話時，頁首的判定戳記直接掛在對話標題列上 */
  stamp?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const consRef = useRef<ConstraintSet | undefined>(constraints);

  useEffect(() => {
    consRef.current = constraints;
  }, [constraints]);

  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");

    const user: Turn = { id: ++seq.current, role: "user", text: q, at: now() };
    const pending: Turn = { id: ++seq.current, role: "assistant", at: now(), pending: true };
    const history = [...turns, user];
    setTurns([...history, pending]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fixture,
          term,
          scope,
          constraints: consRef.current,
          messages: history
            .filter((t) => t.role === "user" || t.reply)
            .map((t) => ({
              role: t.role,
              content: t.role === "user" ? t.text! : (t.reply?.headline ?? ""),
              meta: t.reply ? { kind: t.reply.kind, clarifying: t.reply.kind === "不確定" } : undefined,
            })),
        }),
      });
      const data = (await res.json()) as {
        reply?: Reply;
        plan?: PlanUpdate;
        whatif?: WhatIfResult;
        explanation?: ExclusionReason;
        redirect?: "plan";
        traceId?: string;
        error?: string;
      };

      if (data.plan) {
        consRef.current = data.plan.constraints;
        onPlanUpdate?.(data.plan);
      }

      setTurns((prev) =>
        prev.map((t) =>
          t.id === pending.id
            ? {
                ...t,
                pending: false,
                reply: data.reply ?? {
                  kind: "不確定",
                  headline: data.error ?? "這次沒能處理你的問題。",
                  citations: [],
                },
                plan: data.plan,
                whatif: data.whatif,
                explanation: data.explanation,
                redirect: data.redirect,
                traceId: data.traceId,
              }
            : t,
        ),
      );
    } catch (e) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pending.id
            ? { ...t, pending: false, reply: { kind: "不確定", headline: `連線失敗：${String(e)}`, citations: [] } }
            : t,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * 附加檔案。
   *
   * 對話本身讀不了任意檔案，所以這裡不假裝可以 —— 送出的檔案交給既有的
   * 規劃表結構檢查（/api/rulepack），把「這份檔案能不能用、下一步是什麼」
   * 如實回報。這是學生說「我的規劃表版本不對」之後真正需要的下一步。
   */
  const NL = String.fromCharCode(10);
  const attach = async (file: File) => {
    if (busy) return;
    setBusy(true);
    const user: Turn = { id: ++seq.current, role: "user", text: `附加檔案：${file.name}`, at: now() };
    const pending: Turn = { id: ++seq.current, role: "assistant", at: now(), pending: true };
    setTurns((prev) => [...prev, user, pending]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/rulepack", { method: "POST", body: fd });
      const d = (await res.json()) as {
        kind?: "json" | "pdf";
        ok?: boolean;
        error?: string;
        issues?: { level: string; message: string }[];
        steps?: string[];
        receipt?: string;
      };
      const reply: Reply = d.error
        ? { kind: "超出範圍", headline: d.error, citations: [] }
        : d.kind === "pdf"
          ? {
              kind: "決定",
              headline: `已收件（${d.receipt}）。這份規劃表還不會生效。`,
              detail: (d.steps ?? []).join(NL),
              contact: "抽取需要人工校對鎖版才會用於判定",
              citations: [],
            }
          : d.ok
            ? {
                kind: "決定",
                headline: "結構檢查通過，可送人工校對。",
                detail: (d.issues ?? []).map((i) => i.message).join(NL) || undefined,
                citations: [],
              }
            : {
                kind: "不確定",
                headline: "這份檔案沒有通過結構檢查，不能用來判定。",
                detail: (d.issues ?? []).map((i) => i.message).join(NL),
                searched: ["規則包 schema 與逐條引用檢查"],
                contact: "修正後可再試一次，或洽系辦公室",
                citations: [],
              };
      setTurns((prev) =>
        prev.map((t) => (t.id === pending.id ? { ...t, pending: false, reply } : t)),
      );
    } catch (e) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pending.id
            ? { ...t, pending: false, reply: { kind: "不確定", headline: `上傳失敗：${String(e)}`, citations: [] } }
            : t,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const userTurns = turns.filter((t) => t.role === "user").length;

  return (
    <section className="panel chat">
      <div className="chat-hd">
        <h2>{title}</h2>
        {stamp ? <span className="stamp">{stamp}</span> : null}
        <span className="chat-hint">{hint}</span>
        <span className="chat-tools">
          {/* §0.7 單一 session 的輪次上限是規則，就該讓使用者看得到還剩幾輪 */}
          {userTurns > 0 ? (
            <span className="chat-turns">
              第 {userTurns} / {LIMITS.turnsPerSession} 輪
            </span>
          ) : null}
          {turns.length > 0 ? (
            <button type="button" className="chat-clear" disabled={busy} onClick={() => setTurns([])}>
              清除
            </button>
          ) : null}
        </span>
      </div>

      {/* 規則說明收起來。它只有第一次需要讀，卻會永遠佔掉半個畫面 */}
      <details className="chat-guide">
        <summary>這個對話怎麼運作</summary>
        <div className="bd">{guide}</div>
      </details>

      <div className="chat-log">
        {turns.length === 0 ? <p className="chat-empty">{intro}</p> : null}
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} planHref={planHref} onPick={(s) => void send(s)} busy={busy} />
        ))}
        <div ref={endRef} />
      </div>

      {/* 輸入區是這個畫面的主要動作，不是一個順便放在底部的填空格：
          常用問法在上、可換行的輸入框在下、送出鍵與鍵盤提示同一列。 */}
      <div className="chat-composer">
        <div className="chat-tips">
          <span className="tips-lb">可以這樣問</span>
          {tips.map((t) => (
            <button key={t} type="button" disabled={busy} onClick={() => void send(t)}>
              {t}
            </button>
          ))}
        </div>

        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            rows={2}
            placeholder={placeholder}
            aria-label={title}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 中文輸入法選字時的 Enter 不能當成送出
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            disabled={busy}
          />
          <div className="chat-send">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.json,application/pdf,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void attach(f);
              }}
            />
            <button
              type="button"
              className="attach"
              disabled={busy}
              title="課程規劃表（.pdf／.json）"
              onClick={() => fileRef.current?.click()}
            >
              ＋ 附加檔案
            </button>
            {rulepackHref ? (
              <Link className="attach-more" href={rulepackHref}>
                規劃表版本不對？
              </Link>
            ) : null}
            <button className="btn btn-primary" type="submit" disabled={busy || input.trim() === ""}>
              {busy ? "處理中" : "送出"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function TurnView({
  turn,
  planHref,
  onPick,
  busy,
}: {
  turn: Turn;
  planHref?: string;
  onPick: (s: string) => void;
  busy: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="turn user">
        <div className="turn-bubble">{turn.text}</div>
        <div className="turn-meta">{turn.at}</div>
      </div>
    );
  }

  if (turn.pending) {
    return (
      <div className="turn assistant">
        <div className="turn-who">Aidit</div>
        <div className="turn-body pending">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          推算中
        </div>
      </div>
    );
  }

  const r = turn.reply!;
  return (
    <div className="turn assistant">
      <div className="turn-who">
        Aidit
        <span className={`kind ${KIND_CLASS[r.kind]}`}>{r.kind}</span>
      </div>

      <div className={`turn-body ${KIND_CLASS[r.kind]}`}>
        <p className="turn-headline">{r.headline}</p>
        {r.detail
          ? r.detail.split("\n").map((line, i) => (
              <p className="turn-detail" key={i}>
                {line}
              </p>
            ))
          : null}

        {r.kind === "不確定" && r.searched && r.searched.length > 0 ? (
          <p className="turn-searched">已查詢：{r.searched.join("、")}</p>
        ) : null}
        {r.contact ? <p className="turn-contact">{r.contact}</p> : null}
        {r.uncountedHolds ? (
          <p className="turn-hold">本結果未計入 {r.uncountedHolds} 項待確認事項。</p>
        ) : null}

        {r.citations.length > 0 ? <CitationToggle citations={r.citations as Citation[]} label="依據" /> : null}
      </div>

      {turn.plan ? <PlanCard p={turn.plan} onPick={onPick} busy={busy} /> : null}
      {turn.whatif ? <WhatIfCard r={turn.whatif} /> : null}
      {turn.redirect === "plan" && planHref ? (
        <div className="turn-card">
          <Link href={planHref}>前往選課建議 →</Link>
        </div>
      ) : null}
      {/* 時間一律在訊息下方：一則在上一則在下，讀起來會一直跳 */}
      <div className="turn-foot">
        <span className="turn-meta">{turn.at}</span>
        {turn.traceId ? (
          <a className="turn-trace" href={`/api/trace/${turn.traceId}`} target="_blank" rel="noreferrer">
            本輪執行紀錄
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** §1.3 每輪回報三件事：改了什麼條件、課表差異、代價 */
function PlanCard({ p, onPick, busy }: { p: PlanUpdate; onPick: (s: string) => void; busy: boolean }) {
  const plan = p.plans[0];
  return (
    <div className="turn-card">
      <ol className="three">
        <li>
          <span className="k">改了什麼</span>
          <span className="v">{p.changed.join("、")}</span>
        </li>
        <li>
          <span className="k">課表差異</span>
          <span className="v">
            {p.diff.unchanged ? (
              "沒有變動"
            ) : (
              <>
                {p.diff.removed.length > 0 ? (
                  <span className="del">移除 {p.diff.removed.join("、")}</span>
                ) : null}
                {p.diff.added.length > 0 ? <span className="add">加入 {p.diff.added.join("、")}</span> : null}
              </>
            )}
          </span>
        </li>
        <li className={p.costs.length > 0 ? "cost" : undefined}>
          <span className="k">代價</span>
          <span className="v">{p.costs.length > 0 ? p.costs.join(" ") : "沒有明顯的代價。"}</span>
        </li>
      </ol>

      {plan ? (
        <ul className="turn-courses">
          {plan.courses.map((c) => (
            <li key={c.code}>
              <span className="code">{c.code}</span>
              {c.name}
              <span className="meta">
                {c.credits} 學分・{c.slotText}・{c.categoryLabel}・餘額 {c.remaining}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {p.relaxOptions.length > 0 ? (
        <div className="relax">
          <div className="relax-lb">要放寬哪一項由你決定</div>
          <div className="relax-opts">
            {p.relaxOptions.map((o) => (
              <button key={o} type="button" disabled={busy} onClick={() => onPick(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="turn-cons">
        目前條件：{p.constraintLabels.join("・")}
      </div>
    </div>
  );
}

function WhatIfCard({ r }: { r: WhatIfResult }) {
  // 沒有衝突也沒有替代路徑時，這張卡片是空的 —— 空卡片比沒有卡片更糟
  if (!r.conflict && r.alternatives.length === 0) return null;
  return (
    <div className="turn-card">
      <div className="turn-card-hd">試算結果</div>
      {r.conflict ? (
        <p className="turn-detail">
          <b>條件衝突</b>　「{r.conflict.a}」對「{r.conflict.b}」：{r.conflict.explanation}
        </p>
      ) : null}
      {r.alternatives.length > 0 ? (
        <p className="turn-detail">
          <b>替代路徑</b>　{r.alternatives.join("／")}
        </p>
      ) : null}
    </div>
  );
}

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
