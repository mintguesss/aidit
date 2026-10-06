"use client";

import { useEffect, useMemo, useState } from "react";
import type { DraftView, ReviewDecision, ReviewItem } from "@/lib/review/store";
import { ReviewEditForm } from "./ReviewEditForm";
import { Spinner } from "@/components/shell/Spinner";
import { getReviewPassword, getReviewer, reviewHeaders, setReviewPassword, setStoredReviewer } from "./review-password";

/**
 * 逐條校對：系統的理解 vs. 原文。
 *
 * 校對的人多半不是工程師，所以頁面上不出現欄位名或 JSON：
 * 每一項寫成白話、附上「請確認什麼」，原文出處附原始文件的連結與頁碼。
 * 全數通過後才允許鎖版；鎖版會寫入 provenance=approved 與 content hash。
 */

type Doc = { id: string; title: string; url?: string };

/** 紀錄存的是 UTC，顯示一律用台灣時間（伺服器與瀏覽器算出來一樣，不會有 hydration 差異） */
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

const docHref = (url: string, page?: number) => `${encodeURI(url)}${page ? `#page=${page}` : ""}`;

/** 版面模式抽出的語料有大段補齊空白與空行，顯示時壓掉，比較好讀（高亮的範圍不變） */
const squash = (s: string) => s.replace(/[ \t]{3,}/g, "  ").replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");

const BADGE: Record<ReviewDecision["status"], string> = {
  approved: "✓ 已通過",
  corrected: "需要修正",
  rejected: "已退回",
};

export function ReviewBoard({ view }: { view: DraftView }) {
  const [reviewer, setReviewer] = useState("");
  const [password, setPassword] = useState("");
  // 讀 localStorage 要等到瀏覽器端，避免伺服器與瀏覽器畫出來不一樣
  useEffect(() => {
    setPassword(getReviewPassword());
    setReviewer(getReviewer());
  }, []);
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
  const allDocs = (view.draft.documents as Doc[] | undefined) ?? [];
  const docs = allDocs.filter((d) => d.url);
  // 改某一類學分時，可一併調整承接類別（其他選修）維持加總
  type Cat = { id: string; name: string; credits: number; match: { type: string } };
  const cats = (view.draft.categories as Cat[] | undefined) ?? [];
  const free = cats.find((c) => c.match.type === "anyPassed");
  const freeFor = (item: ReviewItem) => {
    if (!free || !item.id.startsWith("category:")) return null;
    const id = item.id.slice("category:".length);
    return {
      name: free.name,
      credits: free.credits,
      minCredits: Number(view.draft.minCredits),
      othersExcludingThis: cats.filter((c) => c.id !== id && c !== free).reduce((a, c) => a + c.credits, 0),
    };
  };
  const shown = onlyOpen ? view.items.filter((i) => byItem.get(i.id)?.status !== "approved") : view.items;

  /** 寫入一筆校對。失敗時回傳原因，由那一項的卡片自己顯示（訊息放在頁首，按的人看不到） */
  const decide = async (itemId: string, status: ReviewDecision["status"], note?: string): Promise<string | null> => {
    if (!reviewer.trim()) return "請先在頁面最上方填寫你的姓名或代號 —— 每一筆校對都要記下是誰做的。";
    setBusy(true);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: reviewHeaders(password),
        body: JSON.stringify({
          action: "decide",
          packId: view.packId,
          decision: { itemId, status, note, reviewer: reviewer.trim() },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { record?: { decisions: ReviewDecision[] }; error?: string };
      if (!res.ok || !data.record) return data.error ?? `寫入失敗（${res.status}），請稍後再試。`;
      setDecisions(data.record.decisions);
      return null;
    } catch {
      return "連不上伺服器，請檢查網路後再試。";
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
        headers: reviewHeaders(password),
        body: JSON.stringify({ action: "lock", packId: view.packId, reviewer: reviewer.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      setMessage(res.ok ? `已鎖版，系統從現在起會使用這份規則（${data.path}）。` : (data.error ?? `鎖版失敗（${res.status}）。`));
    } catch {
      setMessage("連不上伺服器，請檢查網路後再試。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="abort" style={{ maxWidth: 1180 }}>
      {busy ? (
        <div className="busy-toast">
          <Spinner label="儲存中…" />
        </div>
      ) : null}
      <div className="panel">
        <div className="panel-hd">
          <h2>
            校對進度　已通過 {approved} / {total} 項
            {locked ? `　已於 ${fmtTime(view.record.lockedAt!)} 由 ${view.record.lockedBy} 鎖版` : ""}
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
                兩邊意思一樣 → 按「<b>通過</b>」。數字或內容不對 → 按「<b>需要修正</b>」，
                直接在表單上改成正確的內容、貼上依據的原文句子，存檔。這一項根本不該存在 → 按「<b>退回</b>」。
              </li>
              <li>原文看不懂前後脈絡時，點「開啟原始文件」看整份 PDF，會直接跳到那一頁。</li>
              <li>
                <b>全部 {total} 項都按「通過」才能鎖版</b>，鎖版後系統才會用這份規則審查。
                改過的項目會回到「還沒看」，再看一次按通過即可；其他已通過的會保留。
                表單改不了的（例如需要新的判斷方式），按「留言給維護者」，等維護的人處理。
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

          <div className="rv-who">
            <input
              type="text"
              placeholder="你的姓名或代號（必填）"
              aria-label="校對人"
              value={reviewer}
              onChange={(e) => {
                setReviewer(e.target.value);
                setStoredReviewer(e.target.value);
              }}
            />
            <input
              type="password"
              placeholder="校對密碼"
              aria-label="校對密碼"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setReviewPassword(e.target.value);
              }}
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
              有 {needsFix} 項留言給維護者、還沒改。留言不會改到規則，要等維護的人改好草稿，
              改到的項目回到「還沒看」之後才能通過、鎖版。
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

      <div className="rv-list">
        {shown.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            index={view.items.indexOf(item) + 1}
            decision={byItem.get(item.id)}
            disabled={busy || locked}
            onDecide={decide}
            edit={{ docs: allDocs, packId: view.packId, draftHash: view.draftHash, reviewer, password, free: freeFor(item) }}
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
  edit,
}: {
  item: ReviewItem;
  index: number;
  decision?: ReviewDecision;
  disabled: boolean;
  onDecide: (itemId: string, status: ReviewDecision["status"], note?: string) => Promise<string | null>;
  edit: {
    docs: Doc[];
    packId: string;
    draftHash: string;
    reviewer: string;
    password: string;
    free: { name: string; credits: number; othersExcludingThis: number; minCredits: number } | null;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = d?.status;
  const act = async (status: ReviewDecision["status"], note?: string) => {
    setError(null);
    setError(await onDecide(item.id, status, note));
  };
  const noteOnly = () => {
    const note = window.prompt("哪裡不對？正確的應該是什麼？（會留言給維護的人）");
    if (note) {
      setEditing(false);
      void act("corrected", note);
    }
  };
  const lastEdit = item.edits.at(-1);
  return (
    <article className={`rv-card${state ? ` is-${state}` : ""}`}>
      <header className="rv-hd">
        <span className="rv-n">{index}</span>
        <h3>{item.label}</h3>
        {state ? <span className="rv-badge">{BADGE[state]}</span> : <span className="rv-badge is-open">還沒看</span>}
      </header>
      <div className="rv-bd">
        <div className="rv-grid">
          <div>
            <div className="rv-lb">系統的理解</div>
            <div className="rv-box">
              {item.extracted}
              {item.details?.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  {item.details.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="rv-ask">
              <b>請確認</b>　{item.question}
            </div>
          </div>
          <div>
            <div className="rv-lb">
              原文{item.docTitle ? `：${item.docTitle}` : ""}
              {item.locator ? `　${item.locator}` : ""}
            </div>
            <div className="rv-box is-src">
              {item.context ? (
                <>
                  {squash(item.context.before)}
                  <mark className="rv-mark">{squash(item.context.match)}</mark>
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
              <div className="rv-link">
                <a href={docHref(item.docUrl, item.page)} target="_blank" rel="noreferrer">
                  開啟原始文件{item.page ? `（第 ${item.page} 頁）` : ""}
                </a>
              </div>
            ) : null}
          </div>
        </div>
        {item.note ? (
          <div className="rv-extra">
            <b>補充說明</b>　{item.note}
          </div>
        ) : null}
        {item.edits.length ? (
          <div className="rv-extra">
            <b>修改紀錄</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
              {item.edits.map((e) => (
                <li key={e.at}>
                  {fmtTime(e.at)}　{e.by}：{e.changes.join("；")}
                  <span style={{ color: "var(--text-3)" }}>（原因：{e.reason}）</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {editing && item.editable ? (
          <ReviewEditForm
            item={item}
            docs={edit.docs}
            packId={edit.packId}
            draftHash={edit.draftHash}
            reviewer={edit.reviewer}
            password={edit.password}
            freeCategory={edit.free}
            onCancel={() => setEditing(false)}
            onNoteOnly={noteOnly}
          />
        ) : null}
        {d ? (
          <div className="rv-meta">
            <div>
              校對人　{d.reviewer}
              {state === "approved" && lastEdit && lastEdit.by === d.reviewer ? (
                <span style={{ color: "var(--text-3)", marginLeft: 8 }}>（改的人和按通過的人是同一位）</span>
              ) : null}
            </div>
            <div>
              {fmtTime(d.decidedAt)}
            </div>
            {d.note ? (
              <div>
                備註　{d.note}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="rv-act">
        <button
          className="btn btn-primary"
          disabled={disabled || state === "approved"}
          onClick={() => void act("approved")}
          style={state === "approved" ? { background: "var(--ok)", borderColor: "var(--ok)", opacity: 1 } : undefined}
        >
          {state === "approved" ? "✓ 已通過" : "通過"}
        </button>
        <button
          className="btn"
          disabled={disabled || editing}
          onClick={() => (item.editable ? setEditing(true) : noteOnly())}
        >
          需要修正
        </button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => {
            const note = window.prompt("為什麼這一項不該存在？");
            if (note) void act("rejected", note);
          }}
        >
          退回
        </button>
        {error ? (
          <span className="rv-err" role="alert">
            {error}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
