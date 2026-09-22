"use client";

import { toCsv, toIcs } from "@/lib/plan/export";
import type { Plan } from "@/lib/types";

/**
 * 課表匯出。
 *
 * 在瀏覽器端產生檔案，不經伺服器 —— 課表本身不落地（docs/DATA.md），
 * 「匯出」正是「不儲存」的那個替代方案：要留存的人自己留一份，
 * 而不是由系統替所有人保存一份。
 */
export function ExportButtons({ plan }: { plan: Plan }) {
  const download = (name: string, mime: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // 不釋放的話這份課表會一直留在記憶體裡
    URL.revokeObjectURL(url);
  };

  return (
    <span className="exportbar">
      <button
        type="button"
        className="linkish"
        onClick={() => download(`aidit-${plan.term}.ics`, "text/calendar;charset=utf-8", toIcs(plan))}
        title="匯入 Google 日曆、Apple 行事曆等"
      >
        匯出行事曆
      </button>
      <button
        type="button"
        className="linkish"
        onClick={() => download(`aidit-${plan.term}.csv`, "text/csv;charset=utf-8", toCsv(plan))}
        title="用試算表開啟"
      >
        匯出 CSV
      </button>
    </span>
  );
}
