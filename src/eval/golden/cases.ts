import type { FixtureId } from "@/lib/providers/fixtures";

/**
 * Golden set（SPEC.md §10）—— 人工計算的標準答案。
 *
 * 這裡的每一個數字都是對照 src/lib/rules/corpus/plan-im-111.txt 手算出來的，
 * 不得由 engine 反推，否則回歸測試只會證明「引擎和自己一致」。
 *
 * 手算依據（合成規劃表）：
 *   校訂共同必修 20 ＋ 通識 12 ＋ 院基礎 12 ＋ 系專必修 48 ＋ 系專選修 24 ＋ 自由選修 12 ＝ 128
 */

export type CategoryExpectation = {
  id: string;
  earned: number;
  inProgress: number;
  unmet: number;
  overflow: number;
  status: "satisfied" | "unmet" | "pending_in_progress";
};

export type GoldenCase = {
  fixture: FixtureId;
  /** 這一例在測什麼 */
  tests: string;
  /** 預期整案中止（轉系生） */
  expectAllHold?: true;
  expect?: {
    totalEarned: number;
    countable: number;
    inProgress: number;
    unmet: number;
    overflow: number;
    holds: number;
    categories: CategoryExpectation[];
    /** 手算過程，寫出來讓人能複核 */
    workings: string;
  };
};

const cat = (
  id: string,
  earned: number,
  inProgress: number,
  unmet: number,
  overflow: number,
  status: CategoryExpectation["status"],
): CategoryExpectation => ({ id, earned, inProgress, unmet, overflow, status });

export const GOLDEN_CASES: GoldenCase[] = [
  {
    fixture: "demo",
    tests: "不變式、超修不流用、跨院 ambiguity、抵免停開課號、通識領域分布、英文檢定無明文",
    expect: {
      totalEarned: 123,
      countable: 117,
      inProgress: 6,
      unmet: 5,
      overflow: 6,
      holds: 3,
      workings:
        "及格：共同必修20＋院基礎12＋系專必修44＋通識8＋系專選21＋他系選修18＝123。" +
        "跨院 ME4021（3）與抵免 IM1001（3）命中 ambiguity，整個移出指派問題，不計入 123。" +
        "自由選修應修12，指派到18，超修6不得流用 → 可採計117。" +
        "修課中：IM4002（4）＋GE1210（2）＝6。未修：通識2＋系專選3＝5。117＋6＋5＝128。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 8, 2, 2, 0, "unmet"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 44, 4, 0, 0, "pending_in_progress"),
        cat("major-elective", 21, 0, 3, 0, "unmet"),
        cat("free-elective", 12, 0, 0, 6, "satisfied"),
      ],
    },
  },
  {
    fixture: "plain",
    tests: "基準正確性：各類別剛好滿足",
    expect: {
      totalEarned: 128,
      countable: 128,
      inProgress: 0,
      unmet: 0,
      overflow: 0,
      // 英文能力檢定之公告未載明適用學年，依規則包一律轉人工 —— 即使學分全數滿足
      holds: 1,
      workings:
        "20＋12＋48＋12（通識含自然科技 GE1401）＋24（系專選21＋IM4018 3）＋12（他系4門）＝128，無超修、無修課中。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 24, 0, 0, 0, "satisfied"),
        cat("free-elective", 12, 0, 0, 0, "satisfied"),
      ],
    },
  },
  {
    fixture: "overflow-no-transfer",
    tests: "超修不得流用：131 學分仍差 9 學分",
    expect: {
      totalEarned: 131,
      countable: 119,
      inProgress: 0,
      unmet: 9,
      overflow: 12,
      holds: 1,
      workings:
        "及格：20＋12＋48＋12＋系專選15＋他系選修24＝131。" +
        "他系選修只能歸自由選修：應修12，指派24，超修12。" +
        "系專選僅15，未修9。119＋0＋9＝128。超修12不得補系專選的9。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 15, 0, 9, 0, "unmet"),
        cat("free-elective", 12, 0, 0, 12, "satisfied"),
      ],
    },
  },
  {
    fixture: "transfer-student",
    tests: "學籍入學學年 ≠ 實際入學學年 → 整案轉人工，不得硬算",
    expectAllHold: true,
  },
  {
    fixture: "waiver-retired",
    tests: "抵免課號已停開且查無對照 → 該筆整個移出指派問題並產生 HoldItem",
    expect: {
      totalEarned: 128,
      countable: 128,
      inProgress: 0,
      unmet: 0,
      overflow: 0,
      holds: 2,
      workings:
        "與 plain 相同的 128 學分；抵免 IM1001（3）命中 waiverWithoutMapping，不計入任何類別，" +
        "因此 totalEarned 仍為 128 而非 131。holds＝抵免對照＋英文檢定。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 24, 0, 0, 0, "satisfied"),
        cat("free-elective", 12, 0, 0, 0, "satisfied"),
      ],
    },
  },
  {
    fixture: "legacy-code",
    tests: "舊課號 IM2903 經對照後應計入系專業必修，不得掉到自由選修",
    expect: {
      totalEarned: 128,
      countable: 128,
      inProgress: 0,
      unmet: 0,
      overflow: 0,
      holds: 1,
      workings:
        "IM2903 標記 equivalentOf=IM2003，比對時以 IM2003 計，系專必修仍為 48。其餘與 plain 相同。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 24, 0, 0, 0, "satisfied"),
        cat("free-elective", 12, 0, 0, 0, "satisfied"),
      ],
    },
  },
  {
    fixture: "double-major",
    tests: "雙主修科目歸屬：他系科目只能進自由選修，不得影響本系類別",
    expect: {
      totalEarned: 134,
      countable: 128,
      inProgress: 0,
      unmet: 0,
      overflow: 6,
      holds: 1,
      workings:
        "plain 的 128 再加 FN4001（3）＋FN4002（3）＝134。兩門均為他系選修，只能歸自由選修：" +
        "應修12、指派18、超修6。可採計仍為128。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 24, 0, 0, 0, "satisfied"),
        cat("free-elective", 12, 0, 0, 6, "satisfied"),
      ],
    },
  },
  {
    fixture: "repeat-course",
    tests: "重補修不得重複採計：IM4011 出現兩次及格紀錄，只能計一次",
    expect: {
      totalEarned: 128,
      countable: 128,
      inProgress: 0,
      unmet: 0,
      overflow: 0,
      holds: 1,
      workings:
        "IM4011（3）出現兩筆及格紀錄，依學則第 23 條僅計一次，故總學分為 128 而非 131，系專選仍為 24。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 24, 0, 0, 0, "satisfied"),
        cat("free-elective", 12, 0, 0, 0, "satisfied"),
      ],
    },
  },
  {
    fixture: "cross-college",
    tests: "跨院選修 ambiguity trigger：該筆不計入，並算出「若採計」之影響",
    expect: {
      totalEarned: 125,
      countable: 125,
      inProgress: 0,
      unmet: 3,
      overflow: 0,
      holds: 2,
      workings:
        "plain 去掉 IM4018（3）後系專選為 21；加入跨院 ME4021（3）但命中 ambiguity，整個移出，" +
        "故 totalEarned＝125、系專選未修 3。125＋0＋3＝128。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "satisfied"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 21, 0, 3, 0, "unmet"),
        cat("free-elective", 12, 0, 0, 0, "satisfied"),
      ],
    },
  },
  {
    fixture: "domain-unmet-credits-ok",
    tests: "通識學分已足但領域分布未達：unmet 為 0，status 仍須為 unmet",
    expect: {
      totalEarned: 128,
      countable: 128,
      inProgress: 0,
      unmet: 0,
      overflow: 0,
      holds: 1,
      workings:
        "通識 12 學分已足（人文藝術 6、社會科學 4、生命探索 2），但缺自然科技領域。" +
        "學分數上沒有缺口（unmet＝0），依規劃表第 3 頁仍不得視為滿足本類別（status＝unmet）。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 12, 0, 0, 0, "unmet"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 48, 0, 0, 0, "satisfied"),
        cat("major-elective", 24, 0, 0, 0, "satisfied"),
        cat("free-elective", 12, 0, 0, 0, "satisfied"),
      ],
    },
  },
  {
    fixture: "no-enrollment-data",
    tests: "資料來源不含修課中資料：修課中一律以 0 計，並產生 capabilities 缺項的 HoldItem",
    expect: {
      totalEarned: 123,
      countable: 117,
      inProgress: 0,
      unmet: 11,
      overflow: 6,
      holds: 4,
      workings:
        "demo 去掉兩筆修課中（IM4002 4、GE1210 2）。及格學分不變＝123，可採計 117。" +
        "未修＝系專必修4＋通識4＋系專選3＝11。117＋0＋11＝128。" +
        "holds＝跨院＋抵免＋英文檢定＋資料來源未含修課中。",
      categories: [
        cat("common-required", 20, 0, 0, 0, "satisfied"),
        cat("general", 8, 0, 4, 0, "unmet"),
        cat("college-core", 12, 0, 0, 0, "satisfied"),
        cat("major-required", 44, 0, 4, 0, "unmet"),
        cat("major-elective", 21, 0, 3, 0, "unmet"),
        cat("free-elective", 12, 0, 0, 6, "satisfied"),
      ],
    },
  },
];
