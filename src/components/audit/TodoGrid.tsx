"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useDismiss } from "@/lib/ui/useDismiss";

export type TodoCard = {
  k: string;
  t: string;
  tone: "unmet" | "hold" | "ok";
  d: string;
  href: string;
  go: string;
};

/**
 * 首頁「接下來」。一格一件事：類別、對象、去哪裡。
 * 說明點格子才展開；再點一次、點旁邊、按 Esc 收起。連結本身一直在，不必先展開。
 */
export function TodoGrid({ cards }: { cards: TodoCard[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLUListElement>(null);
  useDismiss(ref, open !== null, () => setOpen(null));

  return (
    <ul className="todo" ref={ref}>
      {cards.map((c, i) => (
        <li className={`todo-item ${c.tone}${open === i ? " open" : ""}`} key={c.k + c.t}>
          <button
            type="button"
            className="todo-row"
            aria-expanded={open === i}
            onClick={() => setOpen((o) => (o === i ? null : i))}
          >
            <span className="todo-k">{c.k}</span>
            <span className="todo-t">{c.t}</span>
          </button>
          <Link className="todo-go" href={c.href}>
            {c.go} →
          </Link>
          {open === i ? <div className="todo-d">{c.d}</div> : null}
        </li>
      ))}
    </ul>
  );
}
