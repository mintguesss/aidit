import type { Citation } from "@/lib/types";

/**
 * 公告庫（BACKEND.md §2）。
 *
 * `rule.conflict` 需要一個可比對的對象。正式環境為 Postgres 的 announcements 表；
 * 離線模式下以本檔的固定資料替身，欄位形狀與 SQL schema 一致。
 *
 * appliesToYears === null 就是衝突訊號 —— 公告沒說適用哪幾屆。
 */
export type Announcement = {
  id: string;
  title: string;
  url?: string;
  publishedAt: string;
  /** 原文中描述適用對象的段落 */
  appliesToRaw: string | null;
  /** 解析後的適用學年；null 表示未載明 */
  appliesToYears: number[] | null;
  scope: "general" | "dept" | "university";
  /** 本公告所影響的規則包類別或畢業條件 id */
  targets: string[];
  contentDocId: string;
};

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "ann-ge-114",
    title: "114 學年度通識涵養課程新制公告",
    publishedAt: "2025-06-30",
    appliesToRaw: "本新制適用於一一四學年度起入學之學生；一一三學年度以前入學之學生，仍依其入學年度之課程規劃表規定辦理。",
    appliesToYears: [114, 115, 116, 117, 118],
    scope: "general",
    targets: ["general"],
    contentDocId: "ann-ge-114",
  },
  {
    id: "ann-eng-cert",
    title: "資訊管理學系英文能力檢定通過標準",
    publishedAt: "2020-09-01",
    // 原文通篇未出現適用對象的描述 —— 這正是待確認事項的來源
    appliesToRaw: null,
    appliesToYears: null,
    scope: "dept",
    targets: ["english"],
    contentDocId: "ann-eng-cert",
  },
];

export function citationOf(a: Announcement, locator: string, quote?: string): Citation {
  return { docId: a.contentDocId, docTitle: a.title, locator, quote, url: a.url, publishedAt: a.publishedAt };
}

export function announcementsFor(targets: string[]): Announcement[] {
  return ANNOUNCEMENTS.filter((a) => a.targets.some((t) => targets.includes(t)));
}
