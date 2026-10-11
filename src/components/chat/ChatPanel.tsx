"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExclusionReason, WhatIfResult } from "@/lib/types";
import { LIMITS, type ConstraintSet, type Reply } from "@/lib/chat/types";
import { Messenger } from "./Messenger";
import { Thread } from "./Thread";
import type { PlanUpdate, Tip, Turn } from "./shared";

export type { PlanUpdate } from "./shared";

/**
 * 對話框（docs/CONVERSATION.md §3）：送訊息、改回去、附加檔案的邏輯都在這裡，
 * 畫面交給兩種完全不同的版面 ——
 *   調整課表（scope=plan）  Messenger：訊息泡泡，短句來回，課表變動是泡泡裡的標籤
 *   修業問答（scope=ask）   Thread：一問一答的問答串，答案攤開成段落，依據接在後面
 *
 * 三種回答（決定／不確定／超出範圍）兩邊都看得出來，只是呈現方式不同。
 */

/** 「改回去」「回上一版」：退一步，在畫面上用之前那一輪的課表與條件，不必問後端（TODO G12） */
const UNDO =
  /^(?:改回去|改回來|回上一版|回到上一版|上一版|回上一步|回到上一步|上一步|復原|還原|退回上一步|撤銷|撤回|取消剛剛(?:的|那個)?(?:調整|修改|改動|變更)?|剛剛的不要了?)[。！!～~]?$/;

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
  shownCourses,
  onOpenPlan,
}: {
  title: string;
  hint: string;
  scope: "plan" | "ask";
  fixture: string;
  term: string;
  placeholder: string;
  /** 常用問法；修業問答可以附上分類（{ q, k }），起始畫面的卡片會顯示 */
  tips: Tip[];
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
  /**
   * 畫面上目前顯示的課表（課號）。每輪隨條件一起送上去：後端拿它當「之前」算課表差異、
   * 當「多一堂／少一堂」的基準，並在條件平手時優先保留這些課。
   * 後端沒有 session，不送的話它只能用條件重算，而那不一定是使用者眼前的這一份。
   */
  shownCourses?: ShownCourse[];
  /** 在彈出視窗裡看某一版的課表（調整課表用） */
  onOpenPlan?: (p: PlanUpdate, label: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const consRef = useRef<ConstraintSet | undefined>(constraints);
  /** 現在畫面上是哪一輪的課表（null＝還沒調整過的那一份） */
  const [current, setCurrent] = useState<number | null>(null);
  const shownRef = useRef<ShownCourse[] | undefined>(shownCourses);

  useEffect(() => {
    consRef.current = constraints;
  }, [constraints]);
  useEffect(() => {
    shownRef.current = shownCourses;
  }, [shownCourses]);

  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns]);

  /** 回到某一輪的課表：條件、畫面上的課表、之後調整的基準都換回那一輪 */
  const restore = (turnId: number, said?: string) => {
    const at = turns.find((t) => t.id === turnId);
    if (!at?.plan) return;
    consRef.current = at.plan.constraints;
    shownRef.current = shownOf(at.plan.plans[0]);
    onPlanUpdate?.(at.plan);
    setCurrent(turnId);
    const n = turns.filter((t) => t.plan && t.id <= turnId).length;
    const note: Turn = {
      id: ++seq.current,
      role: "assistant",
      at: now(),
      reply: { kind: "決定", headline: `已回到第 ${n} 次調整後的課表。`, detail: "條件與課表都回到那一次；之後的調整可以再說一次。", citations: [] },
    };
    setTurns((prev) => [...prev, ...(said ? [{ id: ++seq.current, role: "user" as const, text: said, at: now() }] : []), note]);
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;

    // 「改回去」：退回上一次調整的課表；已經是第一次調整，就回到最一開始（等於重來）
    if (scope === "plan" && UNDO.test(q.replace(/\s/g, ""))) {
      const planTurns = turns.filter((t) => t.plan).map((t) => t.id);
      const idx = current === null ? -1 : planTurns.indexOf(current);
      setInput("");
      if (idx > 0) return restore(planTurns[idx - 1]!, q);
      if (idx === -1) {
        setTurns((prev) => [
          ...prev,
          { id: ++seq.current, role: "user", text: q, at: now() },
          { id: ++seq.current, role: "assistant", at: now(), reply: { kind: "決定", headline: "現在就是還沒調整過的課表。", detail: "沒有上一版可以回去。", citations: [] } },
        ]);
        return;
      }
      return void send("重來");
    }

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
          shown: shownRef.current?.map((c) => c.code),
          // 連時段一起送：只送課號的話，後端重建時可能挑到同一門課的另一班，「換班」就比不出來
          shownSlots: shownRef.current ? Object.fromEntries(shownRef.current.map((c) => [c.code, c.slotText])) : undefined,
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
        redirect?: "plan" | "scenario";
        traceId?: string;
        error?: string;
      };

      if (data.plan) {
        consRef.current = data.plan.constraints;
        // 跟著畫面走：無解時 PlanPanel 會清空課表，基準也就是「沒有課表」
        shownRef.current = shownOf(data.plan.plans[0]);
        onPlanUpdate?.(data.plan);
        setCurrent(pending.id);
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

  const view = {
    title,
    hint,
    stamp,
    intro,
    guide,
    placeholder,
    tips,
    turns,
    busy,
    input,
    setInput,
    send: (q: string) => void send(q),
    clear: () => {
      setTurns([]);
      setCurrent(null);
    },
    pickFile: () => fileRef.current?.click(),
    userTurns,
    maxTurns: LIMITS.turnsPerSession,
    rulepackHref,
    planHref,
    current,
    restore: (id: number) => restore(id),
    onOpenPlan,
    endRef,
  };

  return (
    <>
      {scope === "plan" ? <Messenger {...view} /> : <Thread {...view} />}
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
    </>
  );
}

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 畫面上的一門課：課號＋時段（同一門課有好幾班，時段才分得出是哪一班） */
export type ShownCourse = { code: string; slotText: string };

export function shownOf(plan: { courses: { code: string; slotText: string }[] } | undefined): ShownCourse[] | undefined {
  return plan?.courses.map((c) => ({ code: c.code, slotText: c.slotText }));
}
