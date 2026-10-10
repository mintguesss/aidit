"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * 點開的東西（彈出說明、展開的格子）怎麼關：
 * 點範圍外面、按 Esc，都跟「再按一次」一樣收起來。
 *
 * 只在開著的時候掛監聽；close 每次 render 都可能是新的函式，存在 ref 裡避免重掛。
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}
