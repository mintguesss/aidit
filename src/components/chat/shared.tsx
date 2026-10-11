"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { Citation, ExclusionReason, Plan, WhatIfResult, Infeasibility } from "@/lib/types";
import type { ConstraintSet, Reply, ReplyKind } from "@/lib/chat/types";
import { CitationToggle } from "../sources/CitationToggle";

/**
 * 兩個對話（調整課表、修業問答）共用的資料型別與小元件。
 * 版面各自獨立：調整課表是訊息泡泡（Messenger），修業問答是一問一答的問答串（Thread）。
 */

export type PlanUpdate = {
  plans: Plan[];
  conflicts?: Infeasibility[];
  constraints: ConstraintSet;
  constraintLabels: string[];
  changed: string[];
  diff: { added: string[]; removed: string[]; moved?: string[]; unchanged: boolean };
  costs: string[];
  relaxOptions: string[];
};

export type Turn = {
  id: number;
  role: "user" | "assistant";
  text?: string;
  at: string;
  reply?: Reply;
  plan?: PlanUpdate;
  whatif?: WhatIfResult;
  explanation?: ExclusionReason;
  redirect?: "plan" | "scenario";
  traceId?: string;
  pending?: boolean;
};

/**
 * 「這題要去別頁問」的連結。網址沿用選課建議那條的參數（示範學生、學期），只換路徑。
 * scenario 附兩條：試算去情境試算、問規定去修業問答
 */
export function redirectLinks(redirect: Turn["redirect"], planHref?: string): { href: string; label: string }[] {
  if (!redirect || !planHref) return [];
  const to = (path: string) => planHref.replace(/^\/plan/, path);
  if (redirect === "plan") return [{ href: planHref, label: "前往選課建議 →" }];
  return [
    { href: to("/scenario"), label: "前往情境試算 →" },
    { href: to("/assistant"), label: "到修業問答問規定 →" },
  ];
}

export type Tip = string | { q: string; k: string };
export const tipText = (t: Tip) => (typeof t === "string" ? t : t.q);

export const KIND_CLASS: Record<ReplyKind, string> = {
  決定: "decided",
  不確定: "uncertain",
  超出範圍: "outside",
};

/** 兩種版面共用的狀態與動作；由 ChatPanel 提供 */
export type ChatView = {
  title: string;
  hint: string;
  stamp?: string;
  intro: string;
  guide: ReactNode;
  placeholder: string;
  tips: Tip[];
  turns: Turn[];
  busy: boolean;
  input: string;
  setInput: (s: string) => void;
  send: (s: string) => void;
  clear: () => void;
  pickFile: () => void;
  userTurns: number;
  maxTurns: number;
  rulepackHref?: string;
  planHref?: string;
  current: number | null;
  restore: (id: number) => void;
  onOpenPlan?: (p: PlanUpdate, label: string) => void;
  endRef: RefObject<HTMLDivElement | null>;
};

/** 回覆的文字部分：結論、補充、查過什麼、找誰、未計入的待確認、依據 */
export function ReplyText({ r }: { r: Reply }) {
  return (
    <>
      <p className="r-headline">{r.headline}</p>
      {r.detail
        ? r.detail.split("\n").map((line, i) => (
            <p className="r-detail" key={i}>
              {line}
            </p>
          ))
        : null}
      {r.kind === "不確定" && r.searched && r.searched.length > 0 ? (
        <p className="r-searched">已查詢：{r.searched.join("、")}</p>
      ) : null}
      {r.contact ? <p className="r-contact">{r.contact}</p> : null}
      {r.uncountedHolds ? <p className="r-hold">本結果未計入 {r.uncountedHolds} 項待確認事項。</p> : null}
      {r.citations.length > 0 ? <CitationToggle citations={r.citations as Citation[]} label="依據" /> : null}
    </>
  );
}

export function WhatIfCard({ r }: { r: WhatIfResult }) {
  // 沒有衝突也沒有替代路徑時，這張卡片是空的 —— 空卡片比沒有卡片更糟
  if (!r.conflict && r.alternatives.length === 0) return null;
  return (
    <div className="r-card">
      <div className="r-card-hd">試算結果</div>
      {r.conflict ? (
        <p className="r-detail">
          <b>條件衝突</b>　「{r.conflict.a}」對「{r.conflict.b}」：{r.conflict.explanation}
        </p>
      ) : null}
      {r.alternatives.length > 0 ? (
        <p className="r-detail">
          <b>替代路徑</b>　{r.alternatives.join("／")}
        </p>
      ) : null}
    </div>
  );
}

export function Dots() {
  return (
    <span className="dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** 輸入框跟著內容長高（到上限為止），不必手動拉 */
export function useAutosize(value: string, max = 160) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value, max]);
  return ref;
}

/** Enter 送出、Shift+Enter 換行；中文輸入法選字時的 Enter 不能當成送出 */
export function enterToSend(send: () => void) {
  return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
}

/** 送出鍵的箭頭；兩種版面共用 */
export function SendIcon() {
  return (
    <svg className="send-ic" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 16V4M10 4l-5 5M10 4l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
