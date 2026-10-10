"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FIXTURES, type FixtureId } from "@/lib/providers/fixtures";

/**
 * 評測難例切換。
 *
 * 這是 Demo 用的資料來源選擇器，不是產品功能，因此外觀刻意做成
 * 校務系統常見的「資料區間」下拉，而不是一排看起來像正式功能的按鈕。
 */
const GROUPS = [
  { label: "真實資料", synthetic: false },
  { label: "評測案例（合成資料）", synthetic: true },
];

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
        {/* 所有案例都列出，分成真實資料與合成的評測案例兩組 */}
        {GROUPS.map((g) => {
          const list = FIXTURES.filter((f) => ((f.record.student.school ?? "demo") === "demo") === g.synthetic);
          return list.length > 0 ? (
            <optgroup key={g.label} label={g.label}>
              {list.map((f) => (
                <option key={f.id} value={f.id} title={f.tests}>
                  {f.title}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
    </label>
  );
}
