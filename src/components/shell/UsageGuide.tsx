"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** 看完或跳過後記在這台裝置；學生試用換人時會清掉（lib/trial/channel.ts），下一位一樣會先看到 */
export const GUIDE_KEY = "aidit.guide.dismissed";

/** menu：手機上收在左上角選單裡的功能（看不到本身時改框選單按鈕）；不是的話看不到就略過這一步 */
type Step = { title: string; text: string; find: () => Element | null; menu?: boolean };

/** 導覽列裡指到某一頁的連結（網址後面帶著 ?fixture=…，比對路徑就好） */
const navLink = (path: string) => () =>
  [...document.querySelectorAll<HTMLAnchorElement>("#mainnav a.navlink")].find((a) => {
    try {
      return new URL(a.href).pathname === path;
    } catch {
      return false;
    }
  }) ?? null;

const STEPS: Step[] = [
  { title: "首頁", text: "畢業還差幾學分、缺哪幾類，一眼看完。", find: navLink("/"), menu: true },
  { title: "修業明細", text: "每一類應修、已修、還差多少，每門課算在哪一類、依據哪一條規定。", find: navLink("/audit"), menu: true },
  { title: "待確認", text: "系統從修課紀錄判斷不了的事（例如英文檢定有沒有過），會寫出原因和該問誰。旁邊的數字是還有幾項。", find: navLink("/holds"), menu: true },
  { title: "選課建議", text: "排好下學期的課表。下方的對話框可以直接打字調整（例如「星期五不要排課」「不要早八」），也可以問規定、問課。", find: navLink("/plan"), menu: true },
  { title: "更多", text: "修業問答（只問規定和課，例如「雙主修要怎麼申請」）、情境試算（提前畢業、加修輔系會怎樣）、規劃表與原文、資料與隱私都在這裡。", find: () => document.querySelector(".navmore-btn"), menu: true },
  { title: "個人資料", text: "點名字可以設定選課傾向（例如想輕鬆一點、不要早八），課表會照著排。", find: () => document.querySelector(".topbar-right .who") },
  { title: "執行紀錄", text: "每一個結果是怎麼判定的、查了哪些資料，都記在這裡，可以逐步核對。", find: () => document.querySelector('.topbar-right a[href^="/trace"]') },
];

/** 真的在畫面上：有大小、而且在視窗內（手機選單收起時，連結還在、只是推到畫面外） */
const visible = (el: Element | null): el is Element => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
};
const menuButton = () => document.querySelector(".navtoggle");
/** 這台裝置上看得到（或在選單裡找得到）的步驟 */
const availableSteps = () => STEPS.filter((s) => visible(s.find()) || (s.menu && visible(menuButton())));

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const GAP = 12;

/**
 * 第一次使用的導覽（2026-11-10 學生試用回饋：第一次用不知道導覽列每一項在做什麼）。
 * 畫面變暗、框出一個功能、旁邊跳出一句說明，一步一步看。看完只留「使用說明」按鈕，隨時可以再看一次。
 * 手機上功能收在選單裡，框選單按鈕，並說明這一項在選單裡。
 */
export function UsageGuide() {
  const [steps, setSteps] = useState<Step[]>(STEPS);
  const [index, setIndex] = useState<number | null>(null);
  const start = useCallback(() => {
    setSteps(availableSteps());
    setIndex(0);
  }, []);
  const [box, setBox] = useState<Box | null>(null);
  const [inMenu, setInMenu] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(GUIDE_KEY) !== "1") start();
    } catch {
      start();
    }
  }, [start]);

  const close = useCallback(() => {
    setIndex(null);
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      // 存不了就下次再顯示一次，沒有影響
    }
  }, []);

  // 量出要框的位置。視窗大小改變或捲動時重量
  const measure = useCallback(() => {
    if (index === null) return;
    const step = steps[index];
    if (!step) return;
    const el = step.find();
    const target = visible(el) ? el : menuButton();
    setInMenu(!visible(el));
    if (!visible(target)) {
      setBox(null);
      return;
    }
    const r = target.getBoundingClientRect();
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [index, steps]);

  useLayoutEffect(() => {
    measure();
    if (index === null) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, measure]);

  // 說明框放在框線下方，左右不超出畫面；框線靠近底部時改放上方
  useLayoutEffect(() => {
    if (index === null || !pop.current) return;
    const w = pop.current.offsetWidth;
    const h = pop.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!box) {
      setPopPos({ top: Math.max(16, (vh - h) / 2), left: Math.max(16, (vw - w) / 2) });
      return;
    }
    const below = box.top + box.height + GAP;
    const top = below + h > vh - 16 ? Math.max(16, box.top - GAP - h) : below;
    const left = Math.min(Math.max(16, box.left + box.width / 2 - w / 2), vw - w - 16);
    setPopPos({ top, left });
  }, [box, index, inMenu]);

  useEffect(() => {
    if (index === null) return;
    next.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : Math.min(steps.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, close, steps.length]);

  if (index === null) {
    return (
      <div className="guide-reopen">
        <button type="button" className="linkish" onClick={start}>
          使用說明
        </button>
      </div>
    );
  }

  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? (
        <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        ref={pop}
        className="tour-pop"
        style={popPos ? { top: popPos.top, left: popPos.left } : { visibility: "hidden" }}
      >
        <div className="tour-hd">
          <b id="tour-title">{step.title}</b>
          <span className="tour-count">
            {index + 1}／{steps.length}
          </span>
        </div>
        <p>
          {inMenu ? "在左上角的選單裡。" : ""}
          {step.text}
        </p>
        <div className="tour-actions">
          <button type="button" className="linkish" onClick={close}>
            跳過
          </button>
          <span className="tour-nav">
            {index > 0 ? (
              <button type="button" className="tr-btn small" onClick={() => setIndex(index - 1)}>
                上一步
              </button>
            ) : null}
            <button ref={next} type="button" className="tr-btn small primary" onClick={() => (last ? close() : setIndex(index + 1))}>
              {last ? "開始使用" : "下一步"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
