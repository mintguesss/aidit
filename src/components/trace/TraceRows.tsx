"use client";

import { useState } from "react";

export type TraceRow = {
  idx: number;
  label: string;
  summary: string;
  ms: number;
  retries: number;
  status: { label: string; kind: "ok" | "unmet" | "hold" | "plain" };
  tools: string[];
  calls: { name: string; ms: number; status: string; error?: string }[];
};

/**
 * 處理歷程表。
 *
 * 仍是一張表（步驟／工具／耗時／結果四欄對齊，方便逐列查核），但：
 *   - 第一欄是一條串起所有步驟的線，節點顏色＝該步結果，看得出整條流程走到哪裡出狀況
 *   - 耗時附一條長度比例條，一眼看出哪一步最慢
 *   - 點一列展開該步驟的每一次工具調用（名稱、耗時、狀態、錯誤）；再點一次收起
 * 列依序滑入，比例條從零長出來。
 */
export function TraceRows({ rows }: { rows: TraceRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const maxMs = Math.max(1, ...rows.map((r) => r.ms));

  return (
    <div className="ttable">
      <div className="ttr ttr-hd">
        <span className="tc-n">#</span>
        <span>步驟</span>
        <span className="tc-tool">工具</span>
        <span className="tc-ms">耗時</span>
        <span className="tc-st">結果</span>
      </div>

      {rows.map((r, i) => {
        const isOpen = open === r.idx;
        return (
          <div
            className={`ttr-wrap k-${r.status.kind}${isOpen ? " open" : ""}`}
            key={r.idx}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <button
              type="button"
              className="ttr"
             
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => (o === r.idx ? null : r.idx))}
            >
              <span className="tc-n">
                <span className="tnode">{r.idx}</span>
              </span>
              <span className="tc-step">
                <b>{r.label}</b>
                <small>{r.summary}</small>
              </span>
              <span className="tc-tool">
                {r.tools.length === 0 ? (
                  <span className="tnone">—</span>
                ) : (
                  r.tools.map((t) => (
                    <code className="tchip" key={t}>
                      {t}
                    </code>
                  ))
                )}
                {r.retries > 0 ? <span className="tretry">×{r.calls.length}</span> : null}
              </span>
              <span className="tc-ms">
                <span className="tms-n">{(r.ms / 1000).toFixed(1)}s</span>
                <span className="tms-bar">
                  <i style={{ width: `${Math.max(4, (r.ms / maxMs) * 100)}%`, animationDelay: `${200 + i * 60}ms` }} />
                </span>
              </span>
              <span className="tc-st">
                <span className={`tpill ${r.status.kind}`}>{r.status.label}</span>
                <span className="tchev" aria-hidden />
              </span>
            </button>

            {isOpen ? (
              <div className="tcalls">
                {r.calls.length === 0 ? (
                  <p className="tcalls-none">這一步沒有呼叫工具。</p>
                ) : (
                  <ol>
                    {r.calls.map((c, k) => (
                      <li key={k} className={`tcall ${c.status}`} style={{ animationDelay: `${k * 50}ms` }}>
                        <span className="tcall-n">{k + 1}</span>
                        <code>{c.name}</code>
                        <span className="tcall-ms">{c.ms} ms</span>
                        <span className={`tcall-st ${c.status}`}>{c.status}</span>
                        {c.error ? <span className="tcall-err">{c.error}</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
