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
          // 換案例時學期跟著換成那個案例的「目前學期」，不沿用上一個案例的
          const f = FIXTURES.find((x) => x.id === e.target.value);
          if (f?.term) next.set("term", f.term);
          else next.delete("term");
          router.push(`?${next.toString()}`);
        }}
      >
        {/* 以真實資料為主：合成的評測案例不列出（仍可用網址 ?fixture= 打開，正在看的那個照樣顯示） */}
        {FIXTURES.filter((f) => (f.record.student.school ?? "demo") !== "demo" || f.id === current).map((f) => (
          <option key={f.id} value={f.id} title={f.tests}>
            {f.title}
          </option>
        ))}
      </select>
    </label>
  );
}
