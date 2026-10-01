/**
 * 開課資料的「爬取後原始列」。
 *
 * 刻意保留未正規化的時段字串與先修文字，讓正規化管線（normalize.ts）真的被執行，
 * 而不是把乾淨資料直接寫死在程式裡 —— 那會讓時段解析的測試失去意義。
 *
 * 本檔為合成資料（校名、教師姓名均為虛構），對應 docs/BACKEND.md §4 的抓取結果形狀。
 */

export type RawOffering = {
  code: string;
  name: string;
  credits: number;
  year: number;
  term: 1 | 2 | "summer";
  teacher: string;
  /** 課程查詢頁原樣字串 */
  slotText: string;
  dept: string;
  college: string;
  category: string[];
  generalDomain?: string;
  /** 結構化先修欄位（多數學校沒有，因此多半為空） */
  prereqField?: string;
  /** 課程大綱文字中提到的先修條件 */
  syllabusPrereqText?: string;
  /** 未知時不填（系上課表沒有，只有教務處系統有）；不是 0 */
  capacity?: number;
  enrolled?: number;
  fetchedAt: string;
};

const F = "2026-09-10T03:00:00+08:00";

export const RAW_OFFERINGS: RawOffering[] = [
  // ---------------------------------------------- 115-1 通識（自然科技）
  {
    code: "GE2107", name: "能源與永續社會", credits: 2, year: 115, term: 1, teacher: "林〇〇",
    slotText: "四 6-7", dept: "GE", college: "GEN", category: ["general", "free-elective"],
    generalDomain: "自然科技", capacity: 60, enrolled: 57, fetchedAt: F,
  },
  {
    code: "GE2115", name: "氣候變遷與調適", credits: 2, year: 115, term: 1, teacher: "陳〇〇",
    slotText: "一 1-2", dept: "GE", college: "GEN", category: ["general", "free-elective"],
    generalDomain: "自然科技", capacity: 80, enrolled: 72, fetchedAt: F,
  },
  {
    code: "GE2131", name: "科技與生活", credits: 3, year: 115, term: 1, teacher: "黃〇〇",
    slotText: "三 3-4,5", dept: "GE", college: "GEN", category: ["general", "free-elective"],
    generalDomain: "自然科技", capacity: 50, enrolled: 44, fetchedAt: F,
  },
  {
    code: "GE2140", name: "海洋科學概論", credits: 2, year: 115, term: 1, teacher: "吳〇〇",
    slotText: "五 2-3", dept: "GE", college: "GEN", category: ["general", "free-elective"],
    generalDomain: "自然科技", capacity: 40, enrolled: 40, fetchedAt: F,
  },
  // 其他領域通識（本案已滿足，用於「已滿足之類別不再推薦」的驗證）
  {
    code: "GE2201", name: "臺灣社會變遷", credits: 2, year: 115, term: 1, teacher: "張〇〇",
    slotText: "二 6-7", dept: "GE", college: "GEN", category: ["general", "free-elective"],
    generalDomain: "社會科學", capacity: 60, enrolled: 31, fetchedAt: F,
  },
  {
    code: "GE2305", name: "音樂與生活", credits: 2, year: 115, term: 1, teacher: "劉〇〇",
    slotText: "三 8-9", dept: "GE", college: "GEN", category: ["general", "free-elective"],
    generalDomain: "人文藝術", capacity: 60, enrolled: 12, fetchedAt: F,
  },

  // ---------------------------------------------- 115-1 系專業選修
  {
    code: "IM4021", name: "資料探勘與商業智慧", credits: 3, year: 115, term: 1, teacher: "李〇〇",
    slotText: "二 3-4,5", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 45, enrolled: 33, fetchedAt: F,
  },
  {
    code: "IM4028", name: "顧客關係管理", credits: 3, year: 115, term: 1, teacher: "王〇〇",
    slotText: "三 6-8", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 40, enrolled: 33, fetchedAt: F,
  },
  {
    code: "IM4033", name: "服務系統設計", credits: 3, year: 115, term: 1, teacher: "鄭〇〇",
    slotText: "五 2-3-4", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 35, enrolled: 30, fetchedAt: F,
  },
  {
    code: "IM4035", name: "資訊科技專案實務", credits: 3, year: 115, term: 1, teacher: "許〇〇",
    slotText: "一 1-2,3", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 40, enrolled: 31, fetchedAt: F,
  },
  {
    code: "IM4041", name: "自然語言處理應用", credits: 2, year: 115, term: 1, teacher: "蔡〇〇",
    slotText: "四 3-4", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 30, enrolled: 26, fetchedAt: F,
  },
  {
    code: "IM4045", name: "企業流程管理", credits: 3, year: 115, term: 1, teacher: "楊〇〇",
    slotText: "二 6-8", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 40, enrolled: 40, fetchedAt: F,
  },
  {
    code: "IM4050", name: "資訊視覺化", credits: 1, year: 115, term: 1, teacher: "周〇〇",
    slotText: "三 2", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    capacity: 30, enrolled: 24, fetchedAt: F,
  },
  {
    code: "IM4052", name: "數位轉型個案研討", credits: 3, year: 115, term: 1, teacher: "何〇〇",
    slotText: "四 2-4", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    prereqField: "IM4014", capacity: 35, enrolled: 24, fetchedAt: F,
  },
  {
    code: "IM4055", name: "智慧醫療資訊系統", credits: 3, year: 115, term: 1, teacher: "曾〇〇",
    slotText: "三 3-4,5", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    prereqField: "IM3009", capacity: 30, enrolled: 28, fetchedAt: F,
  },
  {
    code: "IM4060", name: "商業分析實務", credits: 2, year: 115, term: 1, teacher: "呂〇〇",
    slotText: "五 6-7", dept: "IM", college: "MGT", category: ["major-elective", "free-elective"],
    syllabusPrereqText: "建議已先修過資料探勘與商業智慧，否則課堂進度會較吃力。",
    capacity: 30, enrolled: 17, fetchedAt: F,
  },
  {
    code: "IM4065", name: "資訊倫理與法律", credits: 2, year: 115, term: 1, teacher: "潘〇〇",
    // 時段字串無法解析的真實情況：仍可採計，但不參與衝堂判定
    slotText: "密集課程 詳見系網", dept: "IM", college: "MGT",
    category: ["major-elective", "free-elective"], capacity: 30, enrolled: 9, fetchedAt: F,
  },

  // ---------------------------------------------- 115-1 他系（僅自由選修）
  {
    code: "FN3011", name: "個人理財規劃", credits: 2, year: 115, term: 1, teacher: "簡〇〇",
    slotText: "二 8-9", dept: "FN", college: "MGT", category: ["free-elective"],
    capacity: 50, enrolled: 38, fetchedAt: F,
  },
  {
    code: "BA3011", name: "商業簡報實務", credits: 2, year: 115, term: 1, teacher: "洪〇〇",
    slotText: "四 8-9", dept: "BA", college: "MGT", category: ["free-elective"],
    capacity: 50, enrolled: 21, fetchedAt: F,
  },

  // ---------------------------------------------- 115-1 跨院（採計待確認）
  {
    code: "ME4031", name: "工業物聯網導論", credits: 3, year: 115, term: 1, teacher: "石〇〇",
    slotText: "一 6-8", dept: "ME", college: "ENG", category: ["free-elective"],
    capacity: 40, enrolled: 22, fetchedAt: F,
  },
];
