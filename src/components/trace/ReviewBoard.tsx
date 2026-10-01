"use client";

import { useMemo, useState } from "react";
import type { DraftView, ReviewDecision, ReviewItem } from "@/lib/review/store";

/**
 * 逐條校對：系統的理解 vs. 原文。
 *
 * 校對的人多半不是工程師，所以頁面上不出現欄位名或 JSON：
 * 每一項寫成白話、附上「請確認什麼」，原文出處附原始文件的連結與頁碼。
 * 全數通過後才允許鎖版；鎖版會寫入 provenance=approved 與 content hash。
 */

type Doc = { id: string; title: string; url?: string };

const docHref = (url: string, page?: number) => `${encodeURI(url)}${page ? `#page=${page}` : ""}`;

/** 版面模式抽出的語料有大段補齊空白，顯示時壓成兩格，比較好讀（高亮的範圍不變） */
const squash = (s: string) => s.replace(/[ 	]{3,}/g, "  ");

const STATE_STYLE: Record<ReviewDecision["status"], { bg: string; line: string; fg: string; badge: string }> = {
  approved: { bg: "var(--ok-bg)", line: "var(--ok)", fg: "var(--ok)", badge: "✓ 已通過" },
  corrected: { bg: "var(--hold-bg)", line: "var(--hold)", fg: "var(--hold)", badge: "需要修正" },
  rejected: { bg: "var(--unmet-bg)", line: "var(--unmet)", fg: "var(--unmet)", badge: "已退回" },
};

export function ReviewBoard({ view }: { view: DraftView }) {
  const [reviewer, setReviewer] = useState("");
  const [decisions, setDecisions] = useState<ReviewDecision[]>(view.record.decisions);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const byItem = useMemo(() => new Map(decisions.map((d) => [d.itemId, d])), [decisions]);
  // 只有「通過」算數。「需要修正」不會改到草稿，鎖版時發布的仍是原內容 ——
  // 它表示這一項要回草稿改，改完重新上傳、重新校對（見 lib/review/store.ts 的 lockPack）
  const count = (s?: ReviewDecision["status"]) => view.items.filter((i) => byItem.get(i.id)?.status === s).length;
  const approved = count("approved");
  const needsFix = count("corrected");
  const rejected = count("rejected");
  const untouched = count(undefined);
  const total = view.items.length;
  const locked = Boolean(view.record.lockedAt);
  const docs = ((view.draft.documents as Doc[] | undefined) ?? []).filter((d) => d.url);
  const shown = onlyOpen ? view.items.filter((i) => byItem.get(i.id)?.status !== "approved") : view.items;

  const decide = async (itemId: string, status: ReviewDecision["status"], note?: string) => {
    if (!reviewer.trim()) {
      setMessage("請先在上方填寫你的姓名或代號 —— 每一筆校對都要記下是誰做的。");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          packId: view.packId,
          decision: { itemId, status, note, reviewer: reviewer.trim() },
        }),
      });
      const data = (await res.json()) as { record?: { decisions: ReviewDecision[] }; error?: string };
      if (!res.ok) setMessage(data.error ?? "寫入失敗。");
      else {
        setDecisions(data.record!.decisions);
        setMessage(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    if (!reviewer.trim()) {
      setMessage("鎖版必須記錄校對人。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "lock", packId: view.packId, reviewer: reviewer.trim() }),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      setMessage(res.ok ? `已鎖版，系統從現在起會使用這份規則（${data.path}）。` : (data.error ?? "鎖版失敗。"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="abort" style={{ maxWidth: 1180 }}>
      <div className="panel">
        <div className="panel-hd">
          <h2>
            校對進度　已通過 {approved} / {total} 項
            {locked ? `　已於 ${view.record.lockedAt!.slice(0, 10)} 由 ${view.record.lockedBy} 鎖版` : ""}
          </h2>
        </div>
        <div className="panel-bd">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={approved}
            style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}
          >
            <div style={{ width: `${(approved / total) * 100}%`, height: "100%", background: "var(--ok)" }} />
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--text-2)" }}>
            <span style={{ color: "var(--ok)", fontWeight: 600 }}>已通過 {approved}</span>　還沒看 {untouched} 項　需要修正{" "}
            {needsFix} 項　退回 {rejected} 項
          </p>

          <div className="note" style={{ marginBottom: 12, lineHeight: 1.8 }}>
            <b>怎麼校對</b>
            <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>
              <li>
                每一項左邊是<b>系統的理解</b>，右邊是<b>原文</b>（黃色底的是依據的那句話）。
              </li>
              <li>
                兩邊意思一樣 → 按「<b>通過</b>」。數字或內容不對 → 按「<b>需要修正</b>」，寫下正確的內容。
                這一項根本不該存在 → 按「<b>退回</b>」。
              </li>
              <li>原文看不懂前後脈絡時，點「開啟原始文件」看整份 PDF，會直接跳到那一頁。</li>
              <li>
                <b>全部 {total} 項都按「通過」才能鎖版</b>，鎖版後系統才會用這份規則審查。
                有「需要修正」的話，我改好草稿後你只要重看改到的那幾項，其他已通過的會保留。
              </li>
            </ol>
          </div>

          {docs.length > 0 ? (
            <div className="note" style={{ marginBottom: 12 }}>
              <b>原始文件</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {docs.map((d) => (
                  <li key={d.id}>
                    <a href={docHref(d.url!)} target="_blank" rel="noreferrer">
                      {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="askform" style={{ maxWidth: 560 }}>
            <input
              type="text"
              placeholder="你的姓名或代號（必填）"
              aria-label="校對人"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={busy || locked || approved !== total}
              onClick={() => void lock()}
              title={approved !== total ? `還有 ${total - approved} 項沒通過，不能鎖版` : "發布這份規則，系統開始使用"}
            >
              鎖版
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>
            {locked
              ? "已鎖版。"
              : approved === total
                ? "全部通過，可以鎖版。"
                : `還有 ${total - approved} 項沒通過，鎖版按鈕會一直是灰的。`}
          </p>

          {needsFix > 0 ? (
            <div className="note warn" style={{ marginTop: 12 }}>
              有 {needsFix} 項標為「需要修正」。修正內容不會自動寫進規則，要由我依你的備註改草稿、重新上傳；
              之後只有改到的項目需要再看一次。
            </div>
          ) : null}
          {message ? (
            <div className="note warn" style={{ marginTop: 12 }}>
              {message}
            </div>
          ) : null}

          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 12, fontSize: 13.5 }}>
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            只顯示還沒通過的項目
          </label>

          <details style={{ marginTop: 10, fontSize: 12, color: "var(--text-3)" }}>
            <summary>技術資訊</summary>
            草稿編號 {view.packId}　草稿 hash <span style={{ fontFamily: "var(--mono)" }}>{view.draftHash}</span>
          </details>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
        {shown.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            index={view.items.indexOf(item) + 1}
            decision={byItem.get(item.id)}
            disabled={busy || locked}
            onDecide={decide}
          />
        ))}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  index,
  decision: d,
  disabled,
  onDecide,
}: {
  item: ReviewItem;
  index: number;
  decision?: ReviewDecision;
  disabled: boolean;
  onDecide: (itemId: string, status: ReviewDecision["status"], note?: string) => Promise<void>;
}) {
  const state = d?.status;
  const look = state ? STATE_STYLE[state] : null;
  return (
    <div
      className="hold"
      style={{
        borderLeftColor: look?.line ?? "var(--line)",
        borderLeftWidth: 5,
        background: look?.bg,
      }}
    >
      <h4 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>
          {index}.　{item.label}
        </span>
        {look ? (
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              background: look.fg,
              borderRadius: 999,
              padding: "2px 10px",
            }}
          >
            {look.badge}
          </span>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-3)" }}>還沒看</span>
        )}
      </h4>
      <div className="bd">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="rev-grid">
          <div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>系統的理解</div>
            <div className="srcbox" style={{ marginTop: 0, borderLeftColor: "var(--ink-2)", whiteSpace: "normal" }}>
              {item.extracted}
              {item.details?.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  {item.details.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              <b>請確認：</b>
              {item.question}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
              原文{item.docTitle ? `：${item.docTitle}` : ""}
              {item.locator ? `　${item.locator}` : ""}
            </div>
            <div className="srcbox" style={{ marginTop: 0 }}>
              {item.context ? (
                <>
                  {squash(item.context.before)}
                  <mark style={{ background: "#FCE9A6", padding: "0 2px" }}>{squash(item.context.match)}</mark>
                  {squash(item.context.after)}
                </>
              ) : item.quote ? (
                <span style={{ color: "var(--unmet)" }}>
                  原文裡找不到這句話（「{item.quote}」）—— 系統的理解沒有依據，請按「退回」。
                </span>
              ) : (
                <span style={{ color: "var(--text-3)" }}>
                  這一項沒有附原文。請依你對規定的了解判斷；不確定就按「需要修正」寫下疑問。
                </span>
              )}
            </div>
            {item.docUrl ? (
              <div style={{ fontSize: 13, marginTop: 8 }}>
                <a href={docHref(item.docUrl, item.page)} target="_blank" rel="noreferrer">
                  開啟原始文件{item.page ? `（第 ${item.page} 頁）` : ""}
                </a>
              </div>
            ) : null}
          </div>
        </div>
        {item.note ? (
          <div className="note" style={{ marginTop: 12, borderLeft: "4px solid var(--ink-2)" }}>
            <b>補充說明</b>　{item.note}
          </div>
        ) : null}
        {d ? (
          <div className="meta">
            <div>
              <b>校對人</b>　{d.reviewer}
            </div>
            <div>
              <b>時間</b>　{d.decidedAt.replace("T", " ").slice(0, 16)}
            </div>
            {d.note ? (
              <div>
                <b>備註</b>　{d.note}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="act">
        <button
          className="btn btn-primary"
          disabled={disabled || state === "approved"}
          onClick={() => void onDecide(item.id, "approved")}
          style={state === "approved" ? { background: "var(--ok)", borderColor: "var(--ok)", opacity: 1 } : undefined}
        >
          {state === "approved" ? "✓ 已通過" : "通過"}
        </button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => {
            const note = window.prompt("哪裡不對？正確的應該是什麼？");
            if (note) void onDecide(item.id, "corrected", note);
          }}
        >
          需要修正
        </button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => {
            const note = window.prompt("為什麼這一項不該存在？");
            if (note) void onDecide(item.id, "rejected", note);
          }}
        >
          退回
        </button>
      </div>
    </div>
  );
}
