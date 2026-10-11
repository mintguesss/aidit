"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SourceDoc, SourcePassage } from "@/lib/rules/sources";
import { Modal } from "../shell/Modal";

const KIND_LABEL: Record<SourceDoc["kind"], string> = {
  plan: "課程規劃表",
  regulation: "學則",
  extra: "加修規定",
  announcement: "公告",
};
const KIND_ORDER: SourceDoc["kind"][] = ["plan", "regulation", "extra", "announcement"];

/**
 * 原文出處：卡片牆。
 *
 *   上方  搜尋＋種類篩選
 *   卡片  一份文件一張：種類圖示、全名、版本、引用段數、第一段原文的摘錄
 *         —— 一眼看到所有文件，不必先點開
 *   彈窗  點卡片在彈出視窗看全部條文：依「原文的哪一頁」分成一張張紙，頁碼大字在左邊界
 *   搜尋  只留有符合條文的卡片，摘錄換成符合的那一段並標出關鍵字
 *
 * 各頁的「依據」連結帶段落錨點進來（/sources#錨點）：打開那份文件的彈窗、捲到那一段標起來。
 */
export function SourcesBrowser({ docs }: { docs: SourceDoc[] }) {
  const [kind, setKind] = useState<SourceDoc["kind"] | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [hit, setHit] = useState<string | null>(null);
  const needle = q.trim();

  // 由錨點帶進來：打開對應文件 → 等展開 → 捲過去並標記
  useEffect(() => {
    const apply = () => {
      let id = window.location.hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* 解不開就用原字串 */
      }
      if (!id) return;
      const doc = docs.find((d) => d.passages.some((p) => p.anchor === id) || `doc-${d.id}` === id);
      if (!doc) return;
      setQ("");
      setKind("all");
      setOpen(doc.id);
      setHit(id);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [docs]);

  const kinds = KIND_ORDER.filter((k) => docs.some((d) => d.kind === k));

  const view = useMemo(
    () =>
      docs
        .filter((d) => kind === "all" || d.kind === kind)
        .map((d) => ({
          d,
          passages: needle
            ? d.passages.filter((p) => [p.quote, p.locator, ...p.usedBy].some((t) => t.includes(needle)))
            : d.passages,
        }))
        .filter((x) => !needle || x.passages.length > 0),
    [docs, kind, needle],
  );
  const hits = view.reduce((a, x) => a + x.passages.length, 0);
  const current = open ? (view.find((x) => x.d.id === open) ?? (() => {
    const d = docs.find((x) => x.id === open);
    return d ? { d, passages: d.passages } : null;
  })()) : null;

  return (
    <div className="sx">
      <div className="sx-tools">
        <label className="sx-search">
          <span className="sx-search-ic" aria-hidden />
          <input
            type="search"
            placeholder="搜尋原文，例如：超修、流用、英文能力"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜尋原文"
          />
        </label>
        <div className="sx-kinds" role="group" aria-label="文件種類">
          <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>
            全部<em>{docs.length}</em>
          </button>
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
              <em>{docs.filter((d) => d.kind === k).length}</em>
            </button>
          ))}
        </div>
      </div>

      {needle ? (
        <p className="sx-found">
          「<b>{needle}</b>」在 {view.length} 份文件中找到 <b>{hits}</b> 段
        </p>
      ) : null}
      {view.length === 0 ? <p className="sx-empty">沒有符合的條文，換個關鍵字試試。</p> : null}

      <div className="dwall">
        {view.map(({ d, passages }) => {
          const empty = d.passages.length === 0;
          const peek = passages[0];
          return (
            <button
              key={d.id}
              type="button"
              id={`doc-${d.id}`}
              className={`dwall-card k-${d.kind}${empty ? " empty" : ""}`}
              disabled={empty}
              onClick={() => {
                setHit(null);
                setOpen(d.id);
              }}
            >
              <span className="sx-ic" aria-hidden>
                <KindIcon kind={d.kind} />
              </span>
              <span className="dwall-main">
                <span className="dwall-line">
                  <b className="dwall-title">{d.title}</b>
                  <span className="dwall-kind">{KIND_LABEL[d.kind]}</span>
                  <span className="dwall-ver">
                    {d.publishedAt ? `${d.publishedAt} 版` : "未標版本"}
                    {d.provenance === "synthetic" ? "・合成資料" : ""}
                  </span>
                </span>
                {peek?.quote ? (
                  <span className="dwall-peek">「{mark(peek.quote, needle)}」</span>
                ) : (
                  <span className="dwall-peek none">{empty ? "本次判定沒有引用這份文件。" : "未留存原文片段。"}</span>
                )}
              </span>
              <span className="dwall-count">{empty ? "未引用" : `${passages.length} 段`}</span>
            </button>
          );
        })}
      </div>

      <Modal
        open={current !== null}
        onClose={() => {
          setOpen(null);
          setHit(null);
        }}
        title={current?.d.title ?? ""}
        sub={
          current
            ? `${KIND_LABEL[current.d.kind]}・${current.d.publishedAt ? `${current.d.publishedAt} 版・` : ""}${current.passages.length} 段`
            : undefined
        }
        actions={
          current?.d.hasCorpus ? (
            <a className="sx-dl" href={`/api/corpus/${current.d.id}`} download>
              下載全文
            </a>
          ) : null
        }
      >
        {current ? (
          <div className={`sx-body k-${current.d.kind}`}>
            {pagesOf(current.passages).map((pg) => (
              <div className="sheet" key={pg.key}>
                <div className="sheet-no" aria-label={pg.label}>
                  {pg.key === "—" ? (
                    <small>未標頁碼</small>
                  ) : (
                    <>
                      <small>第</small>
                      <b>{pg.key}</b>
                      <small>頁</small>
                    </>
                  )}
                </div>
                <div className="sheet-body">
                  {pg.items.map(({ p, sub }) => (
                    <article className={`sheet-entry${hit === p.anchor ? " hit" : ""}`} id={p.anchor} key={p.anchor}>
                      <h3>{sub}</h3>
                      {p.quote ? (
                        <blockquote>{mark(p.quote, needle)}</blockquote>
                      ) : (
                        <blockquote className="none">本欄位未留存原文片段，無法回查原文。</blockquote>
                      )}
                      <div className="sheet-used">
                        <span>用於</span>
                        {p.usedBy.map((u) => (
                          <em key={u}>{u}</em>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

type Page = { key: string; label: string; items: { p: SourcePassage; sub: string }[] };
const PAGE_RE = /第\s*(\d+)\s*頁/;

/** 依原文頁碼分組：出處寫「第 4 頁…」的條文放在同一張紙上 */
function pagesOf(passages: SourcePassage[]): Page[] {
  const map = new Map<string, Page>();
  for (const p of passages) {
    const m = PAGE_RE.exec(p.locator);
    const key = m ? m[1]! : "—";
    const sub = m ? p.locator.replace(PAGE_RE, "").trim() || p.locator : p.locator;
    if (!map.has(key)) map.set(key, { key, label: m ? `第 ${key} 頁` : "未標頁碼", items: [] });
    map.get(key)!.items.push({ p, sub });
  }
  return [...map.values()].sort((a, b) => (a.key === "—" ? 1 : b.key === "—" ? -1 : Number(a.key) - Number(b.key)));
}

/** 把搜尋字標出來 */
function mark(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const parts = text.split(needle);
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<mark key={i}>{needle}</mark>, p]));
}

const ic = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** 種類圖示：規劃表＝表格文件、學則＝天秤、加修規定＝疊層、公告＝擴音 */
function KindIcon({ kind }: { kind: SourceDoc["kind"] }) {
  if (kind === "plan")
    return (
      <svg {...ic}>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v4h4M9 11h7M9 14.5h7M9 18h4" />
      </svg>
    );
  if (kind === "regulation")
    return (
      <svg {...ic}>
        <path d="M12 4v16M7 20h10M5 8h14" />
        <path d="M5 8l-2.5 5a2.5 2.5 0 0 0 5 0zM19 8l-2.5 5a2.5 2.5 0 0 0 5 0z" />
      </svg>
    );
  if (kind === "extra")
    return (
      <svg {...ic}>
        <path d="M12 3l9 5-9 5-9-5z" />
        <path d="M3 13l9 5 9-5" />
      </svg>
    );
  return (
    <svg {...ic}>
      <path d="M4 10v4h3l6 4V6L7 10z" />
      <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}
