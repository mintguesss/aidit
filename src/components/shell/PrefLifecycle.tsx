"use client";

import { useEffect } from "react";
import { purgeIfLeft } from "@/lib/ui/prefs";

/**
 * 偏好的自動刪除。
 *
 * 兩條規則：12 個月未使用（在 loadStored 內判定，讀取時即生效）、
 * 學籍狀態變更為畢業或離校（這裡判定）。
 * 放在 Shell 裡是因為它必須在每一頁都生效 ——
 * 只在個人資料頁檢查的話，畢業生只要不點進那一頁就永遠不會被清掉。
 */
export function PrefLifecycle({ status }: { status?: string }) {
  useEffect(() => {
    if (purgeIfLeft(status)) {
      // 不記錄任何個人識別資訊，只留一行供除錯
      console.info("[aidit] 學籍狀態為畢業或離校，已刪除本機偏好");
    }
  }, [status]);
  return null;
}
