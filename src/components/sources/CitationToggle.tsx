"use client";

import { useId, useState, type ReactNode } from "react";
import type { Citation } from "@/lib/types";
import { SourceLinks } from "./SourceLinks";

/**
 * 依據。
 *
 * 原文本身集中在「原文出處」頁，這裡只放短連結指過去 ——
 * 每一個結論旁邊都印一整段引文，會讓每一格都很擠，那段原文反而沒人讀。
 * 有附帶內容（採計科目、重複採計規定…）時才展開成區塊。
 */
export function CitationToggle({
  citations,
  children,
  label = "依據",
}: {
  citations: Citation[];
  children?: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (citations.length === 0 && !children) return null;

  return (
    <>
      <SourceLinks citations={citations} label={label} />
      {children ? (
        <>
          <button className="src" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            {open ? "收合" : "更多"}
          </button>
          <div className="srcbox" id={id} hidden={!open}>
            {children}
          </div>
        </>
      ) : null}
    </>
  );
}
