"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** 收起後記在這台裝置；學生試用換人時會清掉（lib/trial/channel.ts），下一位一樣看得到 */
export const GUIDE_KEY = "aidit.guide.dismissed";

const ITEMS: { href: string; label: string; text: string }[] = [
  { href: "/", label: "首頁", text: "畢業還差幾學分、缺哪幾類，一眼看完。" },
  { href: "/audit", label: "修業明細", text: "每一類應修、已修、還差多少，以及每門課算在哪一類、依據哪一條規定。" },
  { href: "/holds", label: "待確認", text: "系統從修課紀錄判斷不了的事（例如英文檢定有沒有過），寫出原因和該問誰。" },
  { href: "/plan", label: "選課建議", text: "排好下學期的課表；用打字的方式調整，例如「星期五不要排課」「不要早八」。" },
  { href: "/assistant", label: "修業問答", text: "問規定、問課，例如「雙主修要怎麼申請」「人生哲學是哪個老師開的」。" },
];

/**
 * 第一次使用的說明（2026-11-10 學生試用回饋：第一次用不知道導覽列每一項在做什麼）。
 * 收起後只留一個「使用說明」按鈕，隨時可以再打開。
 */
export function UsageGuide({ search }: { search: string }) {
  // 先當作收起，讀到這台裝置沒收過才展開：伺服器畫的版本和瀏覽器一致，不會閃一下
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(GUIDE_KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      // 存不了就下次再顯示一次，沒有影響
    }
  };

  if (!open) {
    return (
      <div className="guide-reopen">
        <button type="button" className="linkish" onClick={() => setOpen(true)}>
          使用說明
        </button>
      </div>
    );
  }
  return (
    <section className="panel guide" aria-labelledby="guide-title">
      <div className="guide-hd">
        <h2 id="guide-title">第一次使用？上方五個功能分別做這些事</h2>
        <button type="button" className="tr-btn small" onClick={close}>
          我知道了
        </button>
      </div>
      <ol className="guide-list">
        {ITEMS.map((x) => (
          <li key={x.href}>
            <Link href={`${x.href}${search}`}>{x.label}</Link>
            <span>{x.text}</span>
          </li>
        ))}
      </ol>
      <p className="hint">
        「更多」裡還有情境試算（例如提前畢業、加修輔系會怎樣）與規劃表原文。所有結果僅供規劃參考，以學校審核為準。
      </p>
    </section>
  );
}
