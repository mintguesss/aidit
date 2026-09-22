import type { RunOutcome } from "@/lib/agent/runner";

/**
 * 中止／整案轉人工的說明。
 *
 * 這種情形下不輸出任何學分判定 —— 在畢業審查場域，答錯的代價遠高於不答。
 * 每一頁都會看到同一份說明，避免使用者以為只是「這一頁沒資料」。
 */
export function AbortNotice({ outcome }: { outcome: Extract<RunOutcome, { ok: false }> }) {
  const manual = outcome.error.kind === "all-hold";
  return (
    <div className={`panel`}>
      <div className="panel-hd">
        <h2>{manual ? "本案轉由人工審查" : "審查已中止"}</h2>
      </div>
      <div className="panel-bd">
        <div className={`verdict ${manual ? "blocked" : ""}`.trim()}>
          <div className="h">{manual ? "系統停止判定，未計算任何學分" : "無法完成審查"}</div>
          <p className="p">{outcome.error.reason}</p>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.85, margin: "14px 0 0" }}>
          系統在此種情形下不輸出部分結果。請洽系辦公室或教務處註冊組辦理人工審查；
          下列執行紀錄可作為洽詢時的附件。
        </p>
        <p style={{ fontSize: 13, margin: "8px 0 0" }}>
          執行紀錄：
          <a href={`/api/trace/${outcome.trace.id}`} target="_blank" rel="noreferrer">
            /api/trace/{outcome.trace.id}
          </a>
        </p>
      </div>
    </div>
  );
}
