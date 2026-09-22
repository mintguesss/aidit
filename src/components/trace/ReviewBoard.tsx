"use client";

import { useMemo, useState } from "react";
import type { DraftView, ReviewDecision } from "@/lib/review/store";

/**
 * 逐條校對：左邊原文（高亮 quote），右邊抽取結果。
 * 全數通過後才允許鎖版；鎖版會寫入 provenance=approved 與 content hash。
 */
export function ReviewBoard({ view }: { view: DraftView }) {
  const [reviewer, setReviewer] = useState("");
  const [decisions, setDecisions] = useState<ReviewDecision[]>(view.record.decisions);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byItem = useMemo(() => new Map(decisions.map((d) => [d.itemId, d])), [decisions]);
  const approved = view.items.filter((i) => byItem.get(i.id)?.status === "approved" || byItem.get(i.id)?.status === "corrected");
  const locked = Boolean(view.record.lockedAt);

  const decide = async (itemId: string, status: ReviewDecision["status"], note?: string) => {
    if (!reviewer.trim()) {
      setMessage("請先填寫校對人姓名或代號 —— 校對紀錄必須可追溯。");
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
      setMessage(res.ok ? `已鎖版並寫入 ${data.path}` : (data.error ?? "鎖版失敗。"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="abort" style={{ maxWidth: 1180 }}>
      <div className="panel">
        <div className="panel-hd">
          <h2>
            {view.packId}　校對進度 {approved.length}/{view.items.length}
            {locked ? `　已於 ${view.record.lockedAt!.slice(0, 10)} 由 ${view.record.lockedBy} 鎖版` : ""}
          </h2>
        </div>
        <div className="panel-bd">
          <div className="askform" style={{ maxWidth: 520 }}>
            <input
              type="text"
              placeholder="校對人姓名或代號"
              aria-label="校對人"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={busy || locked || approved.length !== view.items.length}
              onClick={() => void lock()}
              title={
                approved.length !== view.items.length ? "尚有項目未通過校對，不得鎖版" : "寫入規則包並標記為已核定"
              }
            >
              鎖版
            </button>
          </div>
          {message ? (
            <div className="note warn" style={{ marginTop: 12 }}>
              {message}
            </div>
          ) : null}
          <div className="note" style={{ marginTop: 12 }}>
            <b>草稿 hash</b>　<span style={{ fontFamily: "var(--mono)" }}>{view.draftHash}</span>
            <br />
            草稿一旦重新抽取，hash 會改變，既有的校對紀錄即自動失效，必須重新校對。
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
        {view.items.map((item) => {
          const d = byItem.get(item.id);
          const state = d?.status;
          return (
            <div
              key={item.id}
              className="hold"
              style={{
                borderLeftColor:
                  state === "approved" || state === "corrected"
                    ? "var(--ok)"
                    : state === "rejected"
                      ? "var(--unmet)"
                      : "var(--hold)",
              }}
            >
              <h4>{item.label}</h4>
              <div className="bd">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="rev-grid">
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
                      原文（{item.docId || "—"}　{item.locator || "—"}）
                    </div>
                    <div className="srcbox" style={{ marginTop: 0 }}>
                      {item.context ? (
                        <>
                          {item.context.before}
                          <mark style={{ background: "var(--hold-bg)", padding: "0 2px" }}>
                            {item.context.match}
                          </mark>
                          {item.context.after}
                        </>
                      ) : item.quote ? (
                        <span style={{ color: "var(--unmet)" }}>
                          原文中查無此引用（「{item.quote}」）—— 抽取結果不可信，請直接退回。
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-3)" }}>本項無引用。</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>抽取結果</div>
                    <div className="srcbox" style={{ marginTop: 0, borderLeftColor: "var(--ink-2)" }}>
                      {item.extracted}
                    </div>
                  </div>
                </div>
                {d ? (
                  <div className="meta">
                    <div>
                      <b>狀態</b>
                      {{ approved: "通過", corrected: "已修正", rejected: "退回" }[d.status]}
                    </div>
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
                <button className="btn btn-primary" disabled={busy || locked} onClick={() => void decide(item.id, "approved")}>
                  通過
                </button>
                <button
                  className="btn"
                  disabled={busy || locked}
                  onClick={() => {
                    const note = window.prompt("請說明修正內容（會記入校對紀錄）");
                    if (note) void decide(item.id, "corrected", note);
                  }}
                >
                  已於 JSON 修正
                </button>
                <button
                  className="btn"
                  disabled={busy || locked}
                  onClick={() => {
                    const note = window.prompt("請說明退回原因（會記入校對紀錄）");
                    if (note) void decide(item.id, "rejected", note);
                  }}
                >
                  退回
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
