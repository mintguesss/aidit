"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * 目前生效的條件。
 *
 * 求解器做不到的偏好，先前是在課表下方另開一行黃底字說明。那一行很佔位置，
 * 而且離「是哪一個條件做不到」很遠。改成把警告掛回它所屬的條件上：
 * 條件旁出現紅色驚嘆號，點開才顯示原因。
 *
 * 對不上任何條件的警告不會被吞掉 —— 它們列在下方，只是不再佔一整行黃底。
 */
export function PrefBar({
  labels,
  warnings,
  editHref,
}: {
  labels: string[];
  warnings: string[];
  editHref: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const owner = (w: string): string | undefined => {
    const has = (k: string) => w.includes(k);
    return labels.find((l) => {
      if (l.startsWith("期望") && has("堂課")) return true;
      if (l.startsWith("不排早八") && has("早八")) return true;
      if (l.startsWith("空出星期") && has(l.slice(0, 5))) return true;
      if (l.startsWith("學期學分上限") && has("學分上限")) return true;
      if (l.startsWith("課程盡量集中") && has("集中")) return true;
      return false;
    });
  };

  const byLabel = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const w of warnings) {
    const l = owner(w);
    if (!l) orphans.push(w);
    else byLabel.set(l, [...(byLabel.get(l) ?? []), w]);
  }

  return (
    <div className="prefbar">
      <div className="prefbar-row">
        <b className="prefbar-lb">目前生效的條件</b>
        <div className="tags">
          {labels.map((l) => {
            const ws = byLabel.get(l);
            return (
              <span key={l} className={`tag plain${ws ? " has-warn" : ""}`}>
                {l}
                {ws ? (
                  <button
                    type="button"
                    className="warnmark"
                    aria-expanded={open === l}
                    aria-label={`${l}：為什麼做不到`}
                    onClick={() => setOpen(open === l ? null : l)}
                  >
                    !
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
        <Link className="prefbar-edit" href={editHref}>
          改設定 →
        </Link>
      </div>

      {open && byLabel.get(open) ? (
        <div className="prefbar-why">
          {byLabel.get(open)!.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      ) : null}

      {orphans.length > 0 ? (
        <div className="prefbar-why">
          {orphans.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
