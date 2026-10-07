import type { Citation } from "@/lib/types";
import type { RuleAmbiguity } from "./schema";

/**
 * 公告庫（docs/BACKEND.md §2）。
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
  /**
   * 哪一所學校的公告（lib/schools.ts）。公告用類別 id 對應規則包，
   * 不同學校的規則包可能剛好有同名的 id（輔大也有 general、english）—— 不分學校就會套錯人
   */
  school: string;
  /** 本公告所影響的規則包類別或畢業條件 id */
  targets: string[];
  /**
   * 只適用某一系（某一組）的公告。類別 id 各系共用（大家都有 dept-required），
   * 不限定的話物理系的科目表改版會套到資管學生身上。全校公告不填
   */
  dept?: string;
  group?: string;
  contentDocId: string;
  /** 適用對象那一句在原文的位置；同一份公告拆成好幾則判斷時各自不同 */
  locator?: string;
  /**
   * 判定適用本學籍時，對審查的影響：在目標類別加一則規則缺口（命中的課移出指派、轉待確認）。
   * 不適用就沒有影響，仍依入學年度的規劃表判定。
   */
  effect?: { category: string; ambiguity: RuleAmbiguity };
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
    school: "demo",
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
    school: "demo",
    contentDocId: "ann-eng-cert",
  },
  // ---------------------------------------------------------------- 輔大（真實公告）
  // 同一份公告對不同入學年度有不同規定，拆成兩則各自判斷適不適用
  {
    id: "fju-hec-1141-new",
    title: "114 學年度起入學生全人教育課程架構（全人教育課程中心 114-1 選課須知）",
    url: "http://www.hec.fju.edu.tw/bulletinDetail.jsp?id=admin2025/06/03+14:20:48&newsType=2",
    publishedAt: "2025-06-03",
    appliesToRaw:
      "114學年度起入學之日進學士班（不含學士後及二年制學士班）學生，須修讀通識涵養課程：人文與藝術領域(PT)、自然與科技領域(NT)、社會科學領域(ST)、永續素養(DT)領域",
    appliesToYears: yearsFrom(114),
    scope: "university",
    targets: ["general"],
    school: "fju",
    contentDocId: "fju-hec-1141",
    locator: "通識涵養課程第(一)點",
  },
  {
    id: "fju-hec-1141-legacy",
    title: "113 學年度（含）前入學生修讀永續素養領域課程之採計（全人教育課程中心 114-1 選課須知）",
    url: "http://www.hec.fju.edu.tw/bulletinDetail.jsp?id=admin2025/06/03+14:20:48&newsType=2",
    publishedAt: "2025-06-03",
    appliesToRaw:
      "113學年度（含）前入學生如選讀永續多元學群(DTV8)之課程，得抵認為原3領域之通識，抵認對照表請至全人教育課程中心網頁查詢",
    appliesToYears: yearsThrough(113),
    scope: "university",
    targets: ["general"],
    school: "fju",
    contentDocId: "fju-hec-1141",
    locator: "通識涵養課程第(二)點",
    effect: {
      category: "general",
      ambiguity: {
        id: "fju-legacy-sustainability",
        description:
          "永續素養領域的課：永續多元學群（DTV8）可依抵認對照表抵原三領域的通識，永續證照學群（DTD8）不計入畢業學分。" +
          "開課資料分不出是哪一個學群，系統也沒有抵認對照表，無法判定算哪一個領域、算不算畢業學分。",
        trigger: { type: "generalDomain", domain: "永續素養" },
        citation: {
          docId: "fju-hec-1141",
          locator: "通識涵養課程第(二)點",
          quote: "113學年度（含）前入學生如選讀永續多元學群(DTV8)之課程，得抵認為原3領域之通識",
        },
        contact: "全人教育課程中心",
        searchedSources: [
          "全人教育課程中心 114-1 選課須知及全人課程架構加值調整說明",
          "111 學年度課程規劃表",
          "開課資料（只標領域，未標學群）",
        ],
        affects: "undetermined",
      },
    },
  },
  {
    id: "fju-phoe-113-plan",
    title: "113 學年度起入學光電物理組必修科目表（取消普化二、普化實驗二）",
    url: "https://www.phy.fju.edu.tw/wp-content/uploads/2026/06/自113起入學光電物理組必修科目表取消普化二-普化實驗二-113.4.25教務會議通過取消軍訓.pdf",
    publishedAt: "2024-04-25",
    appliesToRaw: "輔仁大學 113學年度 學士班 必修科目表",
    appliesToYears: yearsFrom(113),
    scope: "dept",
    targets: ["dept-required"],
    school: "fju",
    dept: "PH",
    group: "光電物理組",
    contentDocId: "fju-phy-oe-plan-113",
    locator: "第 1 頁 標題",
  },
];

function yearsFrom(y: number): number[] {
  return Array.from({ length: 10 }, (_, i) => y + i);
}
function yearsThrough(y: number): number[] {
  return Array.from({ length: 15 }, (_, i) => y - 14 + i);
}

export function citationOf(a: Announcement, locator: string, quote?: string): Citation {
  return { docId: a.contentDocId, docTitle: a.title, locator, quote, url: a.url, publishedAt: a.publishedAt };
}

/** 只取這所學校的公告 */
export function announcementsFor(school: string): Announcement[] {
  return ANNOUNCEMENTS.filter((a) => a.school === school);
}
