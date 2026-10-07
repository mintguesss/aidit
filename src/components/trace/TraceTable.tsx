import type { Trace, StepStatus } from "@/lib/types";

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
 */
export function TraceTable({ trace }: { trace: Trace }) {
  const toolCalls = trace.steps.reduce((a, s) => a + s.toolCalls.length, 0);
  const toolFails = trace.steps.reduce(
    (a, s) => a + s.toolCalls.filter((c) => c.status === "failed").length,
    0,
  );
  const retries = trace.steps.reduce((a, s) => a + s.retries, 0);

  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>處理歷程</h2>
        <span className="hint">
          總耗時 {(trace.totalMs / 1000).toFixed(1)}s・工具調用 {toolCalls} 次・重試 {retries} 次
        </span>
      </div>

      <div className="trace">
        <div className="trow th">
          <div className="tstep">#</div>
          <div>步驟</div>
          <div className="ttool">工具</div>
          <div className="tms">耗時</div>
          <div>結果</div>
        </div>
        {trace.steps.map((s) => {
          const tag = STATUS_TAG[s.status];
          return (
            <div className="trow" key={s.idx}>
              <div className="tstep">{s.idx}</div>
              <div className="tname">
                {s.label}
                <small>{s.summary}</small>
              </div>
              <div className="ttool">
                {s.toolCalls.length === 0
                  ? "—"
                  : [...new Set(s.toolCalls.map((c) => c.name))].join(" ")}
                {s.retries > 0 ? ` ×${s.toolCalls.length}` : ""}
              </div>
              <div className="tms">{(s.ms / 1000).toFixed(1)}s</div>
              <div>
                <span className={`tag ${tag.kind}`}>{tag.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="note">
        <b>統計</b>　工具調用 {toolCalls} 次，失敗 {toolFails} 次；重試 {retries} 次；
        LLM 呼叫 {trace.llm.calls} 次
        {trace.llm.calls > 0
          ? `（成本 US$${trace.llm.costUsd.toFixed(5)}）`
          : "（未設定金鑰，規則解消以離線確定性替身執行）"}
        。
        <br />
        <b>去識別</b>　學生代號以 HMAC 雜湊儲存，輸入輸出經 scrubber 移除姓名、學號、Email 與電話；
        課程名稱與成績保留，因為那是判定依據且無法單獨識別個人。紀錄保留 90 天。
        <br />
        <b>完整紀錄</b>　
        <a href={`/api/trace/${trace.id}`} target="_blank" rel="noreferrer">
          /api/trace/{trace.id}
        </a>
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
