"use client";

import { useEffect } from "react";

/** 由各頁的「依據」連結跳進來時，把目標段落標起來並捲到畫面中央 */
export function SourceHighlight() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll(".src-list li.hit").forEach((el) => el.classList.remove("hit"));
      // hash 會被瀏覽器百分比編碼，但元素 id 是原始中文 —— 不解碼就永遠對不上
      const raw = window.location.hash.slice(1);
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch {
        /* 解不開就用原字串試 */
      }
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add("hit");
      requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  return null;
}
