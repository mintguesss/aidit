"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Citation } from "@/lib/types";
import { anchorOf, shortTitleOf } from "@/lib/rules/anchor";

/**
 * 依據連結。
 *
 * 只放一行短連結，指到「原文出處」頁的對應段落 ——
 * 把整段引文印在每一個結論旁邊，會讓每一格都變得很擠，
 * 結果是那段原文誰也不會讀。集中一頁反而看得到前後文。
 */
export function SourceLinks({
  citations,
  label = "依據",
}: {
  citations: Citation[];
  label?: string;
}) {
  const params = useSearchParams();
  const qs = params.toString();
  if (citations.length === 0) return null;

  const seen = new Set<string>();
  const items = citations.filter((c) => {
    const k = anchorOf(c.docId, c.locator);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <div className="srclinks">
      <span className="lb">{label}</span>
      {items.map((c) => (
        <Link
          key={anchorOf(c.docId, c.locator)}
          href={`/sources${qs ? `?${qs}` : ""}#${anchorOf(c.docId, c.locator)}`}
        >
          {shortTitleOf(c.docTitle)} {c.locator}
        </Link>
      ))}
    </div>
  );
}
