import type { Citation } from "@/lib/types";

/**
 * 對話的型別定義（docs/CONVERSATION.md）。
 *
 * 兩個介面的共同底線（§0.1）：
 *   LLM 只負責理解問題與組織措辭，一切判定由確定性引擎產出。
 *   因此 LLM 的輸出 schema 只允許「意圖與參數」，不允許出現任何判定結果。
 */

// ------------------------------------------------------------ §0.2 三種回答

/** 三種回答，沒有第四種 */
export type ReplyKind = "決定" | "不確定" | "超出範圍";

export type Reply = {
  kind: ReplyKind;
  /** 結論一句話；三種回答都要短（§3） */
  headline: string;
  /** 補充說明；可為空 */
  detail?: string;
  /** kind = 決定 時必附；沒有依據就不得作答（§0.3） */
  citations: Citation[];
  /** kind = 不確定 時：查過哪些來源 */
  searched?: string[];
  /** kind = 不確定／超出範圍 時：建議洽詢單位 */
  contact?: string;
  /** 未計入的待確認事項數 */
  uncountedHolds?: number;
};

// ------------------------------------------- §1.1 對話狀態是約束集合

/** 使用者以對話疊加上去的約束。每輪的產物就是一個 delta。 */
export type ConstraintDelta = {
  avoidDays?: number[];
  avoidPeriods?: { day: number; periods: number[] }[];
  maxCredits?: number;
  minCredits?: number;
  /** 課號 */
  excludeCourses?: string[];
  /** 一定要留的課（課號） */
  pinCourses?: string[];
  goals?: PlanGoal[];
  /** 這次改了什麼、為什麼 */
  reason: string;
};

export type PlanGoal = "early-graduation" | "minor" | "cert-program";

/**
 * 目前生效的約束集合。
 *
 * 對話可以很長，但狀態永遠是這個小物件，不會因為歷史變長而漂移。
 * 使用者也能在畫面上直接看到並編輯它。
 */
export type ConstraintSet = {
  /** 來自個人資料的修課目標，決定求解器的目標函數 */
  goal: "asap" | "balanced" | "light";
  avoidEarly: boolean;
  avoidDays: number[];
  avoidPeriods: { day: number; periods: number[] }[];
  maxCredits?: number;
  minCredits?: number;
  targetCourseCount?: number;
  /** 「盡量」集中在少數幾天：軟偏好，只影響排序 */
  preferCompactDays: boolean;
  /**
   * 課「必須」排在幾天內：硬限制，排不進就回報無解。
   * 與 preferCompactDays 是兩件事 —— 使用者說「集中在一天」時，把它當成「盡量集中」
   * 會在已經開啟集中時回「條件已經是目前的設定」，而使用者要的一天根本沒被處理。
   */
  maxDays?: number;
  excludeCourses: string[];
  pinCourses: string[];
  /** 「想修一堂 AI 相關的課」：主題與下學期符合的課號（TODO G2） */
  /** days：希望那門課排在哪幾天（「最好排在禮拜一、二、四」）。偏好：那幾天都沒開就照樣排別天 */
  wantTopic?: { label: string; codes: string[]; days?: number[] };
  /** 「多選一堂兩學分的課」：新加的那門盡量是幾學分。偏好（TODO G1） */
  newCourseCredits?: number;
  /** 「這學期不排通識」：這幾類這學期整類不排（學分留到之後的學期）（TODO G12） */
  skipCategories?: { id: string; name: string }[];
  /** 堂數上限：「拿掉一堂」之後不自己補回來（見 Constraints.maxCourseCount）。之後改堂數就解除 */
  maxCourseCount?: number;
  /** 上一次「拿掉一堂某類」拿掉的是哪一門：使用者說「換另一門」時改拿同一類的別門 */
  lastDrop?: { category: string; code: string };
  goals: PlanGoal[];
  note?: string;
};

// ------------------------------------------------------- §1.5／§2.2 意圖

/** A 介面：課表微調的允許意圖（§1.5）。清單外一律走「超出範圍」。 */
export type PlanIntent =
  | "adjust-time"
  | "adjust-load"
  | "swap-course"
  | "pin-course"
  | "change-goal"
  | "explain"
  | "compare";

/** B 介面：修業問答的意圖分類（§2.2） */
export type AskIntent =
  | "personal-audit"
  | "regulation"
  | "course-info"
  | "procedure"
  | "what-if"
  | "plan"
  | "out-of-scope";

/** §2.4 明確禁止的主題 */
export type ForbiddenTopic =
  | "grade-prediction"
  | "teacher-evaluation"
  | "act-on-behalf"
  | "professional-advice"
  | "other-institution"
  | "other-student";

export const FORBIDDEN_REPLY: Record<ForbiddenTopic, { headline: string; contact: string }> = {
  "grade-prediction": {
    headline: "本系統不預測成績，也不預測是否通過。",
    contact: "成績相關問題請洽授課教師或教務處註冊組。",
  },
  "teacher-evaluation": {
    headline: "本系統不對教師做評價性的判斷。",
    contact: "課程內容問題請洽開課系所或授課教師。",
  },
  "act-on-behalf": {
    headline: "本系統沒有寫入校務系統的能力，不代為選課或送件。",
    contact: "請於選課系統或教務處線上申請系統自行操作。",
  },
  "professional-advice": {
    headline: "法律、醫療與心理諮商不在本系統的範圍內。",
    contact: "請洽學校相關專業單位，如學生輔導中心。",
  },
  "other-institution": {
    headline: "本系統只處理本校本系的修業規劃。",
    contact: "他校事務請洽該校承辦單位。",
  },
  "other-student": {
    headline: "本系統只能存取你本人的修課紀錄。",
    contact: "他人資料請由本人自行查詢。",
  },
};

// ------------------------------------------------------------ 對話輪次

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** assistant 訊息才有：本輪的分類結果，供後續判斷是否已澄清過（§0.7） */
  meta?: { kind: ReplyKind; intent?: string; clarifying?: boolean };
};

/** §0.7 上限 */
export const LIMITS = {
  /** 每輪 LLM 呼叫 */
  llmCallsPerTurn: 2,
  /** 單一對話 session 輪數 */
  turnsPerSession: 20,
} as const;
