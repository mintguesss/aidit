"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 畢業條件的「我已通過」勾選框。
 *
 * 只出現在學校資料看不出來的條件上（審查結果的 declarable）。勾了會存起來、重算審查，
 * 那一項顯示「自行勾選」—— 系統沒有查核，畢業審查以學校紀錄為準。
 */
export function DeclareToggle({
  checkId,
  checked,
  fixture,
  term,
}: {
  checkId: string;
  checked: boolean;
  /** 由頁面傳入，不用 useSearchParams —— 那會讓這個元件只在瀏覽器端才畫出來 */
  fixture: string;
  term: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 點了立刻打勾，不等伺服器重算完；失敗再恢復
  const [on, setOn] = useState(checked);
  useEffect(() => setOn(checked), [checked]);

  const toggle = async (passed: boolean) => {
    setOn(passed);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/declarations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fixture,
          term,
          checkId,
          passed,
        }),
      });
      if (!res.ok) {
        setOn(!passed);
        setError(((await res.json()) as { error?: string }).error ?? "儲存失敗。");
      } else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="declare" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
      我已通過
      {error ? <span style={{ color: "var(--unmet)" }}>{error}</span> : null}
    </label>
  );
}
