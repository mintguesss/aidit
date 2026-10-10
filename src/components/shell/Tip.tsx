"use client";

import { useRef, useState, type ReactNode } from "react";
import { useDismiss } from "@/lib/ui/useDismiss";

/**
 * 點一下才出現的補充說明；再點一次、點旁邊、按 Esc 都會收起。
 *
 * 首頁只放結論與下一步；數字怎麼來、每段的明細都收在這裡。
 * 不用滑過觸發：滑過就跳出來的東西，滑走又消失，想對照著看反而留不住。
 */
export function Tip({
  label,
  children,
  align = "left",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  /** 靠右的觸發點用 right，彈出框才不會超出版面 */
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <span ref={ref} className={`tip${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="tip-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open ? (
        <span className={`tip-pop ${align}`} role="dialog">
          {children}
        </span>
      ) : null}
    </span>
  );
}
