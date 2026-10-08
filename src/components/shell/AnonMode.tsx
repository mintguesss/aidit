"use client";

import { useEffect } from "react";
import { ANON_BLOCKED_HREF, anonUrl, makeAnonymizer } from "@/lib/anon";

/**
 * 匿名展示模式的顯示層（見 lib/anon.ts）。
 *
 * 前置腳本已在第一次繪製前標上 html[data-anon] 並把畫面藏起來；這裡取得教師名單、
 * 把現有文字換掉、之後的變動也一併換，換完才顯示。React 之後更新的文字由 MutationObserver 接手。
 */

const ATTRS = ["title", "placeholder", "aria-label", "alt"];

export function AnonMode() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-anon")) return;

    let observer: MutationObserver | null = null;
    let cancelled = false;

    const run = (teachers: string[]) => {
      if (cancelled) return;
      const anon = makeAnonymizer(teachers);
      const fixText = (n: Node) => {
        const v = n.nodeValue;
        if (v && v.trim()) {
          const w = anon(v);
          if (w !== v) n.nodeValue = w;
        }
      };
      const fixAttrs = (el: Element) => {
        if (el instanceof HTMLAnchorElement) {
          const href = el.getAttribute("href");
          if (href && anonUrl(href) !== href) el.setAttribute("href", anonUrl(href));
          if (href && ANON_BLOCKED_HREF.test(href)) {
            el.removeAttribute("href");
            el.removeAttribute("download");
            el.setAttribute("aria-disabled", "true");
            el.setAttribute("title", "匿名展示模式下不提供此連結");
          }
        }
        for (const a of ATTRS) {
          const v = el.getAttribute(a);
          if (v) {
            const w = anon(v);
            if (w !== v) el.setAttribute(a, w);
          }
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          // 使用者正在輸入的不動；只換程式填進去的預設值
          if (document.activeElement !== el && el.value) {
            const w = anon(el.value);
            if (w !== el.value) el.value = w;
          }
        }
      };
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) return fixText(node);
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
        fixAttrs(el);
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (n.nodeType === Node.TEXT_NODE) fixText(n);
          else fixAttrs(n as Element);
        }
      };

      // 網址列也換成別名（不重新載入）
      const here = location.pathname + location.search + location.hash;
      if (anonUrl(here) !== here) history.replaceState(history.state, "", anonUrl(here));
      walk(document.body);
      document.title = anon(document.title);
      root.setAttribute("data-anon-ready", "");

      observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "characterData") fixText(r.target);
          else if (r.type === "attributes") fixAttrs(r.target as Element);
          else r.addedNodes.forEach(walk);
        }
        const t = anon(document.title);
        if (t !== document.title) document.title = t;
        // 客戶端換頁（切換示範學生）後網址可能又帶回真名
        const url = location.pathname + location.search + location.hash;
        if (anonUrl(url) !== url) history.replaceState(history.state, "", anonUrl(url));
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, "href"] });
    };

    fetch("/api/anon-terms")
      .then((r) => (r.ok ? r.json() : { teachers: [] }))
      .then((d: { teachers?: string[] }) => run(d.teachers ?? []))
      .catch(() => run([]));

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  return null;
}
