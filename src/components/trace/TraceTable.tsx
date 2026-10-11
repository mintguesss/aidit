import type { Trace, StepStatus } from "@/lib/types";
import { TraceRows, type TraceRow } from "./TraceRows";
import { TraceStats } from "./TraceStats";

const STATUS_TAG: Record<StepStatus, { label: string; kind: "ok" | "unmet" | "hold" | "plain" }> = {
  ok: { label: "成功", kind: "ok" },
  partial: { label: "部分成功", kind: "plain" },
  retried: { label: "重試後成功", kind: "hold" },
  held: { label: "轉人工", kind: "hold" },
  failed: { label: "失敗", kind: "unmet" },
  skipped: { label: "略過", kind: "plain" },
};

/**
 * 執行紀錄。
 * 每一行評審都會看到，summary 寫成工程日誌，不是行銷文案。
 *
 * 表格本身是互動的（點一列展開該步驟的每一次工具調用），放在 TraceRows；
 * 這裡在伺服器端先把 trace 縮成畫面需要的欄位 —— 工具的 input／output 可能很大，
 * 不需要整包送到瀏覽器，完整內容在 /api/trace/:id。
 */
export function TraceTable({ trace }: { trace: Trace }) {
  const retries = trace.steps.reduce((a, s) => a + s.retries, 0);

  const rows: TraceRow[] = trace.steps.map((s) => ({
    idx: s.idx,
    label: s.label,
    summary: s.summary,
    ms: s.ms,
    retries: s.retries,
    status: STATUS_TAG[s.status],
    tools: [...new Set(s.toolCalls.map((c) => c.name))],
    calls: s.toolCalls.map((c) => ({ name: c.name, ms: c.ms, status: c.status, error: c.error })),
  }));

  return (
    <section className="panel trace-panel">
      {/* 先講結論：四個數字，各配一個圖示與小圖 */}
      <TraceStats
        totalMs={trace.totalMs}
        steps={rows.map((r) => ({ idx: r.idx, label: r.label, ms: r.ms, kind: r.status.kind }))}
        calls={trace.steps.flatMap((s) => s.toolCalls.map((c) => ({ name: c.name, status: c.status })))}
        retries={retries}
        llmCalls={trace.llm.calls}
        llmCost={trace.llm.costUsd}
      />

      <TraceRows rows={rows} />

      <div className="tmeta">
        <div>
          <b>去識別</b>
          <span>
            學生代號以 HMAC 雜湊儲存；輸入輸出經 scrubber 移除姓名、學號、Email 與電話。
            課程名稱與成績保留（判定依據，且無法單獨識別個人）。紀錄保留 90 天。
          </span>
        </div>
        <div>
          <b>完整紀錄</b>
          <a href={`/api/trace/${trace.id}`} target="_blank" rel="noreferrer">
            /api/trace/{trace.id}
          </a>
        </div>
      </div>

      <details className="explain" open={trace.blockedContent.length > 0}>
        <summary>
          外部內容處理
          {trace.blockedContent.length > 0
            ? `（本次攔截 ${trace.blockedContent.length} 則）`
            : "（本次未攔截）"}
        </summary>
        <div className="bd">
          公告等外部文件送給模型判斷是否適用前，先檢查是否夾帶指令；命中的不交給模型，改轉人工確認。
          外部文件只作為判斷依據的資料，不參與學分計算，也不能改變系統指令。
          {trace.blockedContent.map((b, i) => (
            <div className="blocked" key={i}>
              <div className="meta">
                {b.patternMatched}
                <br />
                {b.sourceUrl}
              </div>
              <div className="ex">「{b.excerpt}」</div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
