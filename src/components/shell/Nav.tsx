"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * 主導覽。
 *
 * 桌機：直接長在頂條裡，不另外佔一條橫列；次要入口收在「更多」選單。
 * 窄螢幕：改為側邊抽屜。把五個功能橫著塞進 390px 會變成一條要左右滑的細帶，
 *         使用者看不到全部選項，也不知道自己漏了什麼；抽屜一次看得完。
 *
 * **兩邊的項目必須一致**：次要入口在桌機收在「更多」、在手機收在抽屜的「其他」，
 * 但內容是同一個 `more` 陣列。先前手機看得到情境試算與適用規劃表、桌機看不到，
 * 那是兩套導覽，不是同一套導覽的兩種呈現。
 *
 * 校務系統的分頁不是「同一頁裡的 tab」，而是各自有網址的功能頁 ——
 * 承辦人要能把「待確認事項」那一頁的連結直接貼給學生。
 * 因此 fixture / term 這類查詢參數必須跟著導覽走。
 */

export type NavItem = { href: string; label: string; count?: number; tone?: "hold" | "unmet" };

export function Nav({ items, more = [] }: { items: NavItem[]; more?: NavItem[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // 抽屜打開時鎖住背景捲動，並支援 Esc 關閉
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 換頁後關閉
  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // 「更多」選單：點別處或按 Esc 關閉
  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setMoreOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const link = (it: NavItem) => (
    <Link
      key={it.href}
      href={qs ? `${it.href}?${qs}` : it.href}
      className="navlink"
      aria-current={pathname === it.href ? "page" : undefined}
      onClick={() => setOpen(false)}
    >
      {it.label}
      {it.count ? <span className={`navcount ${it.tone ?? ""}`.trim()}>{it.count}</span> : null}
    </Link>
  );

  return (
    <>
      <button
        type="button"
        className="navtoggle"
        aria-expanded={open}
        aria-controls="mainnav"
        aria-label="開啟選單"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="navtoggle-bars" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </button>

      <nav className="topnav" id="mainnav" aria-label="主導覽" data-open={open ? "true" : undefined}>
        <div className="drawer-hd">
          <span>功能</span>
          <button type="button" className="drawer-x" onClick={() => setOpen(false)} aria-label="關閉選單">
            ✕
          </button>
        </div>
        {items.map(link)}

        {/* 桌機：收在「更多」選單。手機：同一批項目直接列在抽屜的「其他」 */}
        {more.length > 0 ? (
          <>
            <div className="navmore" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="navlink navmore-btn"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              >
                更多
                <span className="navmore-caret" aria-hidden />
              </button>
              {moreOpen ? <div className="navmore-panel">{more.map(link)}</div> : null}
            </div>
            <div className="drawer-more">
              <div className="drawer-sep">其他</div>
              {more.map(link)}
            </div>
          </>
        ) : null}
      </nav>

      {open ? <button type="button" className="navscrim" aria-label="關閉選單" onClick={() => setOpen(false)} /> : null}
    </>
  );
}
