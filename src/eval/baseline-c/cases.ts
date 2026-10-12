import type { FixtureId } from "@/lib/providers/fixtures";

/**
 * 基準 C（單次 LLM）的真實案例與標準答案。
 *
 * 案例是兩份真實成績單（輔大資管 111 的兩位同學，經本人同意）各在五個時間點的截斷，
 * 規則是 Supabase 上人工校對鎖版的 fju-im-111。是兩位學生、十個時間點，不是十位獨立的學生，報告要照實寫。
 *
 * 標準答案是 2026-10-09 系統的審查結果，經成績單本人逐項核對過。
 * **凍結在這裡，不在執行時由引擎產生** —— 否則引擎改壞了，標準答案也跟著壞，
 * 比較就沒有意義。引擎的結果若跟這裡不同，評測會把我們自己也判錯。
 */

export type ExpectedCategory = {
  name: string;
  required: number;
  earned: number;
  unmet: number;
};

/**
 * 能不能畢業：
 *   no            學分還沒修滿
 *   needs-review  學分已滿，但有成績單看不出來的條件（英檢、機測、資訊能力檢測…）要人工確認
 *   yes           全部確定滿足（真實案例裡沒有，因為非學分條件都無法從成績單確認）
 */
export type GraduationVerdict = "yes" | "no" | "needs-review";

export type RealCase = {
  fixture: FixtureId;
  /** 成績單截至哪一學期（含） */
  through: string;
  label: string;
  expect: {
    categories: ExpectedCategory[];
    totalUnmet: number;
    /** 通識三大領域裡還沒修到 4 學分的 */
    missingGenEdDomains: string[];
    canGraduate: GraduationVerdict;
  };
};

const cat = (name: string, required: number, earned: number, unmet: number): ExpectedCategory => ({
  name,
  required,
  earned,
  unmet,
});

export const GEN_ED_DOMAINS = ["人文與藝術", "自然與科技", "社會科學"];

export const REAL_CASES: RealCase[] = [
  {
    fixture: "fju-im-111-year1-fall",
    through: "111-1",
    label: "大一上結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 2, 6),
        cat("基本能力課程", 12, 4, 8),
        cat("通識涵養課程", 12, 4, 8),
        cat("院系必修課程", 64, 12, 52),
        cat("選修課程", 32, 0, 32),
      ],
      totalUnmet: 106,
      missingGenEdDomains: ["自然與科技", "社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-year1",
    through: "111-2",
    label: "大一結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 2, 6),
        cat("基本能力課程", 12, 8, 4),
        cat("通識涵養課程", 12, 4, 8),
        cat("院系必修課程", 64, 23, 41),
        cat("選修課程", 32, 2, 30),
      ],
      totalUnmet: 89,
      missingGenEdDomains: ["自然與科技", "社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-year2",
    through: "112-2",
    label: "大二結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 2, 6),
        cat("基本能力課程", 12, 12, 0),
        cat("通識涵養課程", 12, 8, 4),
        cat("院系必修課程", 64, 52, 12),
        cat("選修課程", 32, 14, 18),
      ],
      totalUnmet: 40,
      missingGenEdDomains: ["社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-year3",
    through: "113-2",
    label: "大三結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 6, 2),
        cat("基本能力課程", 12, 12, 0),
        cat("通識涵養課程", 12, 10, 2),
        cat("院系必修課程", 64, 64, 0),
        cat("選修課程", 32, 26, 6),
      ],
      totalUnmet: 10,
      missingGenEdDomains: ["社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-full",
    through: "114-2",
    label: "四年修完",
    expect: {
      // 通識超修 2、選修超修 8：超過應修的部分不計入，所以 earned 寫到應修為止
      categories: [
        cat("全人教育核心課程", 8, 8, 0),
        cat("基本能力課程", 12, 12, 0),
        cat("通識涵養課程", 12, 12, 0),
        cat("院系必修課程", 64, 64, 0),
        cat("選修課程", 32, 32, 0),
      ],
      totalUnmet: 0,
      missingGenEdDomains: [],
      canGraduate: "needs-review",
    },
  },
  // ---- 第二位同學（2026-10-12）：同系同屆，另一份真實成績單，同樣五個時間點。
  // 標準答案是引擎的審查結果，2026-10-12 逐類手算核對過（各時間點累計學分與成績單一致：22、39、91、125、145）；
  // 【待成績單本人或使用者核對】。和第一位的差別：大一入學前抵免 2 門通識（人文、自然各 2 學分）、
  // 外語修文創產業英文＋生活美語、修了外系選修（織品、民生學院的課）、通識組合不同
  {
    fixture: "fju-im-111-b-year1-fall",
    through: "111-1",
    label: "第二位：大一上結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 2, 6),
        cat("基本能力課程", 12, 4, 8),
        cat("通識涵養課程", 12, 4, 8),
        cat("院系必修課程", 64, 12, 52),
        cat("選修課程", 32, 0, 32),
      ],
      totalUnmet: 106,
      missingGenEdDomains: ["人文與藝術", "自然與科技", "社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-b-year1",
    through: "111-2",
    label: "第二位：大一結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 2, 6),
        cat("基本能力課程", 12, 8, 4),
        cat("通識涵養課程", 12, 4, 8),
        cat("院系必修課程", 64, 23, 41),
        cat("選修課程", 32, 2, 30),
      ],
      totalUnmet: 89,
      missingGenEdDomains: ["人文與藝術", "自然與科技", "社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-b-year2",
    through: "112-2",
    label: "第二位：大二結束",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 2, 6),
        cat("基本能力課程", 12, 12, 0),
        cat("通識涵養課程", 12, 8, 4),
        cat("院系必修課程", 64, 52, 12),
        cat("選修課程", 32, 17, 15),
      ],
      totalUnmet: 37,
      missingGenEdDomains: ["人文與藝術", "社會科學"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-b-year3",
    through: "113-2",
    label: "第二位：大三結束",
    expect: {
      // 選修已修 33（含外系 4），超過應修的 1 不計
      categories: [
        cat("全人教育核心課程", 8, 6, 2),
        cat("基本能力課程", 12, 12, 0),
        cat("通識涵養課程", 12, 10, 2),
        cat("院系必修課程", 64, 64, 0),
        cat("選修課程", 32, 32, 0),
      ],
      totalUnmet: 4,
      missingGenEdDomains: ["人文與藝術"],
      canGraduate: "no",
    },
  },
  {
    fixture: "fju-im-111-b-full",
    through: "114-2",
    label: "第二位：四年修完",
    expect: {
      categories: [
        cat("全人教育核心課程", 8, 8, 0),
        cat("基本能力課程", 12, 12, 0),
        cat("通識涵養課程", 12, 12, 0),
        cat("院系必修課程", 64, 64, 0),
        cat("選修課程", 32, 32, 0),
      ],
      totalUnmet: 0,
      missingGenEdDomains: [],
      canGraduate: "needs-review",
    },
  },
];
