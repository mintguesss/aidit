"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FIXTURES, type FixtureId } from "@/lib/providers/fixtures";

/**
 * 評測難例切換。
 *
 * 這是 Demo 用的資料來源選擇器，不是產品功能，因此外觀刻意做成
 * 校務系統常見的「資料區間」下拉，而不是一排看起來像正式功能的按鈕。
 */
export function FixtureSwitch({ current }: { current: FixtureId }) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <label className="fixture">
      <span>檢視案例</span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("fixture", e.target.value);
          router.push(`?${next.toString()}`);
        }}
      >
        {FIXTURES.map((f) => (
          <option key={f.id} value={f.id} title={f.tests}>
            {f.title}
          </option>
        ))}
      </select>
    </label>
  );
}
