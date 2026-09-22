import { z } from "zod/v4";
import { structured, type LlmBudget } from "@/lib/llm/client";
import type { AskIntent, ChatMessage, ForbiddenTopic, PlanIntent } from "./types";

/**
 * 意圖解析（docs/CONVERSATION.md §0.1）。
 *
 * LLM 的輸出 schema **只允許意圖與參數**，不允許出現任何判定結果。
 * 沒有 `answer` 欄位、沒有 `reply` 欄位、沒有任何可以塞學分數字的地方 ——
 * 這不是靠 prompt 拜託模型不要亂講，而是讓它在型別上就沒有地方講。
 *
 * 回答的文字由 compose.ts 依 §3 的模板從引擎結果組出來。
 */

// ------------------------------------------------------------ 共用

const zForbidden = z
  .enum([
    "grade-prediction",
    "teacher-evaluation",
    "act-on-behalf",
    "professional-advice",
    "other-institution",
    "other-student",
  ])
  .nullable();

/** 澄清問題只允許問一個，而且只能問參數，不能問「你想知道什麼」 */
const zClarify = z.string().max(60).nullable();

// --------------------------------------------------- A 介面：課表微調

const zPlanIntent = z.object({
  intent: z
    .enum([
      "adjust-time",
      "adjust-load",
      "swap-course",
      "pin-course",
      "change-goal",
      "explain",
      "compare",
      "out-of-scope",
    ])
    .describe("清單外的一律 out-of-scope"),
  forbidden: zForbidden,
  clarify: zClarify,
  /** 約束變更；只有 adjust-* / swap / pin / change-goal 會用到 */
  delta: z
    .object({
      avoidDays: z.array(z.number().int().min(1).max(7)).max(7),
      allowDays: z.array(z.number().int().min(1).max(7)).max(7),
      avoidEarly: z.boolean().nullable(),
      preferCompactDays: z.boolean().nullable(),
      maxCredits: z.number().int().min(0).max(30).nullable(),
      courseCountDelta: z.number().int().min(-6).max(6).nullable(),
      courseCountTarget: z.number().int().min(0).max(10).nullable(),
      goal: z.enum(["asap", "balanced", "light"]).nullable(),
      goals: z.array(z.enum(["early-graduation", "minor", "cert-program"])).max(3),
      /** 課號或課名；程式會自行查開課資料轉成課號 */
      excludeCourses: z.array(z.string().max(40)).max(5),
      pinCourses: z.array(z.string().max(40)).max(5),
      reset: z.boolean(),
    })
    .nullable(),
  /** intent=explain 時，使用者問的是哪一門課（課號或課名） */
  explainCourse: z.string().max(40).nullable(),
  /** 這次改了什麼、為什麼 —— 只描述條件，不得描述結果 */
  reason: z.string().max(80),
});

export type PlanIntentResult =
  | { kind: "intent"; intent: PlanIntent; params: PlanParams; reason: string }
  | { kind: "explain"; course: string }
  | { kind: "compare" }
  | { kind: "clarify"; question: string }
  | { kind: "forbidden"; topic: ForbiddenTopic }
  | { kind: "out-of-scope" };

/** LLM 解析出的原始參數。課名轉課號、套用到約束集合都在 apply.ts 完成。 */
export type PlanParams = NonNullable<z.infer<typeof zPlanIntent>["delta"]>;

const PLAN_SYSTEM = [
  "你是選課建議的條件解析元件。使用者會用一句話描述想怎麼調整下學期的課表。",
  "",
  "你唯一的工作是把這句話對應到固定的意圖與參數。",
  "你不知道也不需要知道任何學分數字、課表內容或判定結果 —— 那些由確定性求解器負責。",
  "",
  "允許的意圖只有這些：",
  "  adjust-time   調整時段（不要早八、把週五的課拿掉、空出某節）",
  "  adjust-load   調整堂數（輕鬆一點、多修一點、幾學分以內）",
  "  swap-course   換掉某一門課",
  "  pin-course    某一門課一定要留",
  "  change-goal   改變目標（提前畢業、加修輔系或學程）",
  "  explain       問為什麼選了某門課、為什麼沒有某門課",
  "  compare       再給我一版、跟上一版差在哪",
  "清單外的一律回傳 out-of-scope。",
  "",
  "其他規則：",
  "1. 只輸出使用者明確說出口的參數，不得推測。",
  "2. 缺少必要參數時（例如說要換掉某課卻沒說是哪一門），回傳 clarify 並只問一個問題。",
  "3. 問到成績預測、教師評價、代為選課等，回傳對應的 forbidden 分類。",
  "4. reason 只描述「改了什麼條件」，不得描述課表會變成什麼樣子。",
].join("\n");

export async function parsePlanIntent(
  messages: ChatMessage[],
  budget: LlmBudget,
): Promise<PlanIntentResult> {
  const res = await structured(
    {
      system: PLAN_SYSTEM,
      user: renderHistory(messages),
      schema: zPlanIntent,
      offline: () => offlinePlanIntent(lastUser(messages)),
    },
    budget,
  );
  return toPlanResult(res.data, lastUser(messages));
}

function toPlanResult(d: z.infer<typeof zPlanIntent>, raw: string): PlanIntentResult {
  if (d.forbidden) return { kind: "forbidden", topic: d.forbidden };
  if (d.intent === "out-of-scope") return { kind: "out-of-scope" };
  if (d.clarify) return { kind: "clarify", question: d.clarify };
  if (d.intent === "explain") {
    if (!d.explainCourse) return { kind: "clarify", question: "想問的是哪一門課？給我課號或完整課名。" };
    return { kind: "explain", course: d.explainCourse };
  }
  if (d.intent === "compare") return { kind: "compare" };

  if (!d.delta) return { kind: "out-of-scope" };
  return { kind: "intent", intent: d.intent, params: d.delta, reason: d.reason || raw };
}

// ------------------------------------------------- B 介面：修業問答

const zAskIntent = z.object({
  intent: z.enum([
    "personal-audit",
    "regulation",
    "course-info",
    "procedure",
    "what-if",
    "plan",
    "out-of-scope",
  ]),
  forbidden: zForbidden,
  clarify: zClarify,
  /** personal-audit：問的是哪一個類別（可留空＝問整體） */
  category: z.string().max(20).nullable(),
  /** regulation：問的規定主題關鍵詞，程式據此查規則包與公告庫 */
  topic: z.string().max(40).nullable(),
  /** course-info：課號或課名 */
  course: z.string().max(40).nullable(),
  /** procedure：辦理事項關鍵詞（抵免、停修、輔系申請…） */
  procedure: z.string().max(40).nullable(),
  /** what-if：情境類型與參數 */
  scenario: z
    .object({
      type: z.enum([
        "early-graduation",
        "withdraw-course",
        "add-minor",
        "double-major",
        "add-cert-program",
        "change-major",
        "grade-threshold",
      ]),
      targetTerm: z.string().max(10).nullable(),
      dept: z.string().max(20).nullable(),
      program: z.string().max(30).nullable(),
      code: z.string().max(40).nullable(),
    })
    .nullable(),
});

export type AskIntentResult =
  | { kind: "intent"; intent: AskIntent; params: AskParams }
  | { kind: "clarify"; question: string }
  | { kind: "forbidden"; topic: ForbiddenTopic }
  | { kind: "out-of-scope" };

export type AskParams = {
  category?: string;
  topic?: string;
  course?: string;
  procedure?: string;
  scenario?: z.infer<typeof zAskIntent>["scenario"];
  raw: string;
};

const ASK_SYSTEM = [
  "你是修業問答的路由器。收到問題後只做一件事：分類，並抽出參數。",
  "",
  "你不回答問題，也不知道任何學分數字或規定內容 —— 分類完成後由程式呼叫對應的能力去查。",
  "",
  "分類：",
  "  personal-audit 本人的審查結果（我還差幾學分、通識夠了嗎）",
  "  regulation     規定是什麼（超修可以流用嗎、輔系要幾學分）",
  "  course-info    開課資訊（某課什麼時候開、誰教、還有沒有名額）",
  "  procedure      怎麼辦理（抵免要怎麼申請、停修期限）",
  "  what-if        改條件重新推算（提前畢業、停修某課）",
  "  plan           要排課表（幫我排下學期的課）",
  "  out-of-scope   其餘一切",
  "",
  "其他規則：",
  "1. 分不出來就回 out-of-scope，不要硬歸到某一類。",
  "2. 缺少必要參數時回傳 clarify，只問一個問題。",
  "3. 成績預測、教師評價、代為申請、法律醫療心理建議、他校事務、他人資料，",
  "   回傳對應的 forbidden 分類。",
].join("\n");

export async function parseAskIntent(
  messages: ChatMessage[],
  budget: LlmBudget,
): Promise<AskIntentResult> {
  const res = await structured(
    {
      system: ASK_SYSTEM,
      user: renderHistory(messages),
      schema: zAskIntent,
      offline: () => offlineAskIntent(lastUser(messages)),
    },
    budget,
  );
  const d = res.data;
  if (d.forbidden) return { kind: "forbidden", topic: d.forbidden };
  if (d.clarify) return { kind: "clarify", question: d.clarify };
  if (d.intent === "out-of-scope") return { kind: "out-of-scope" };
  return {
    kind: "intent",
    intent: d.intent,
    params: {
      category: d.category ?? undefined,
      topic: d.topic ?? undefined,
      course: d.course ?? undefined,
      procedure: d.procedure ?? undefined,
      scenario: d.scenario,
      raw: lastUser(messages),
    },
  };
}

// ------------------------------------------------------------ 離線替身

const FORBIDDEN_PATTERNS: [RegExp, ForbiddenTopic][] = [
  [/老師|教授|講師|甜不甜|給分|評價/, "teacher-evaluation"],
  [/會不會被?當|會不會過|預測.*成績|猜.*成績|能不能考上|錄取機會|上得了/, "grade-prediction"],
  [/幫我(選|加選|退選|申請|送件|報名)|代為(選課|申請)/, "act-on-behalf"],
  [/法律|訴訟|看醫生|憂鬱|心理|諮商/, "professional-advice"],
  [/他校|別的學校|台大|清大|交大/, "other-institution"],
  [/我同學|別人的|其他學生|他的成績/, "other-student"],
];

function detectForbidden(t: string): ForbiddenTopic | null {
  for (const [re, topic] of FORBIDDEN_PATTERNS) if (re.test(t)) return topic;
  return null;
}

const DAY_WORDS: [RegExp, number][] = [
  [/星期一|週一|禮拜一/, 1],
  [/星期二|週二|禮拜二/, 2],
  [/星期三|週三|禮拜三/, 3],
  [/星期四|週四|禮拜四/, 4],
  [/星期五|週五|禮拜五/, 5],
  [/星期六|週六|禮拜六/, 6],
  [/星期日|星期天|週日|禮拜天/, 7],
];

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const numOf = (x: string | undefined) =>
  x === undefined ? null : /^\d+$/.test(x) ? Number(x) : (CN_NUM[x] ?? null);

function emptyDelta() {
  return {
    avoidDays: [] as number[],
    allowDays: [] as number[],
    avoidEarly: null as boolean | null,
    preferCompactDays: null as boolean | null,
    maxCredits: null as number | null,
    courseCountDelta: null as number | null,
    courseCountTarget: null as number | null,
    goal: null as "asap" | "balanced" | "light" | null,
    goals: [] as ("early-graduation" | "minor" | "cert-program")[],
    excludeCourses: [] as string[],
    pinCourses: [] as string[],
    reset: false,
  };
}

function offlinePlanIntent(raw: string): z.infer<typeof zPlanIntent> {
  const t = raw.replace(/\s/g, "");
  const base = {
    intent: "out-of-scope" as const,
    forbidden: null,
    clarify: null,
    delta: null,
    explainCourse: null,
    reason: "",
  };
  const forbidden = detectForbidden(t);
  if (forbidden) return { ...base, forbidden };

  // explain：為什麼選／為什麼沒有
  if (/為什麼|為何|怎麼沒有|沒有排|沒選/.test(t)) {
    const code = /([A-Z]{2}\d{4})/.exec(raw)?.[1];
    const name = /(?:為什麼|為何|怎麼)(?:沒有|沒|不)?(?:選|排|上|排入)?(?:有)?([一-龥（）()]{3,15}?)[？?。]?$/.exec(t)?.[1];
    return { ...base, intent: "explain", explainCourse: code ?? name ?? null };
  }
  if (/再給我一版|另一版|其他方案|換一組|差在哪|比較/.test(t)) {
    return { ...base, intent: "compare" };
  }
  if (/重來|回到原本|重設|取消(所有)?調整/.test(t)) {
    const d = emptyDelta();
    d.reset = true;
    return { ...base, intent: "adjust-load", delta: d, reason: "重設為個人資料的原始設定" };
  }

  const d = emptyDelta();
  const reasons: string[] = [];

  if (/早八|第一節|太早/.test(t)) {
    d.avoidEarly = !/可以早八|接受早八|不介意早八/.test(t);
    reasons.push(d.avoidEarly ? "不排早八" : "接受早八");
  }
  for (const [re, day] of DAY_WORDS) {
    if (!re.test(t)) continue;
    const free = /可以|能排|沒關係/.test(t) && !/空|不要|別|拿掉/.test(t);
    if (free) d.allowDays.push(day);
    else d.avoidDays.push(day);
    reasons.push(`${free ? "開放" : "空出"}星期${"一二三四五六日"[day - 1]}`);
  }
  const less = /少(\d+|[一二兩三四])?[堂門]|少修(\d+|[一二兩三四])?[堂門]|減少(\d+|[一二兩三四])?[堂門]/.exec(t);
  const lessVague = /少修?一?點|少排一?點|少一些/.test(t);
  if (less || lessVague) {
    d.courseCountDelta = -(less ? (numOf(less[1] ?? less[2] ?? less[3]) ?? 1) : 1);
    reasons.push(`堂數減少 ${Math.abs(d.courseCountDelta)} 堂`);
  }
  const more = /多(\d+|[一二兩三四])?[堂門]|多修(\d+|[一二兩三四])?[堂門]/.exec(t);
  const moreVague = /多修?一?點|多排一?點|多一些|多上一?點/.test(t);
  if (more || moreVague) {
    d.courseCountDelta = more ? (numOf(more[1] ?? more[2]) ?? 1) : 1;
    reasons.push(`堂數增加 ${d.courseCountDelta} 堂`);
  }
  const exact = /(\d+|[一二兩三四五六])[堂門]課?就好|只(?:想)?修(\d+|[一二兩三四五六])[堂門]/.exec(t);
  if (exact) {
    const n = numOf(exact[1] ?? exact[2]);
    if (n !== null) {
      d.courseCountTarget = n;
      reasons.push(`期望 ${n} 堂課`);
    }
  }
  const credits = /(\d+)學分(?:以內|以下|上限)/.exec(t);
  if (credits) {
    d.maxCredits = Number(credits[1]);
    reasons.push(`學分上限 ${d.maxCredits}`);
  }
  if (/集中|不要太散|排在一起|同一天|少跑幾天/.test(t)) {
    d.preferCompactDays = true;
    reasons.push("課程盡量集中");
  }
  if (/分散|別擠在同一天/.test(t)) {
    d.preferCompactDays = false;
    reasons.push("不特別要求集中");
  }
  if (/提前畢業|拚一點|越快越好|盡快畢業/.test(t)) {
    d.goal = "asap";
    d.goals.push("early-graduation");
    reasons.push("目標改為最快畢業");
  } else if (/輕鬆|輕一點|喘口氣|不要太重/.test(t)) {
    d.goal = "light";
    reasons.push("目標改為輕量修課");
  } else if (/正常|一般進度/.test(t)) {
    d.goal = "balanced";
    reasons.push("目標改為正常進度");
  }
  if (/輔系/.test(t)) d.goals.push("minor");
  if (/學程/.test(t)) d.goals.push("cert-program");

  // 換掉／一定要留
  // 「換掉某某」與「把某某換掉」兩種語序都要接得住
  const swapAfter = /(?:換掉|不想修|拿掉)([一-龥（）()A-Z0-9]{3,15})/.exec(t);
  const swapBefore = /把([一-龥（）()A-Z0-9]{3,15}?)(?:換掉|拿掉|去掉|移除)/.exec(t);
  const swapName = swapBefore?.[1] ?? swapAfter?.[1];
  if (swapName && !/早八/.test(swapName)) {
    d.excludeCourses.push(swapName);
    reasons.push(`排除「${swapName}」`);
  }
  const pin = /([一-龥（）()A-Z0-9]{3,15})(?:一定要留|要保留|不要動|留著)/.exec(t);
  if (pin) {
    d.pinCourses.push(pin[1]!);
    reasons.push(`保留「${pin[1]}」`);
  }
  const add = /(?:幫我)?加(?:一門|一堂)?([一-龥（）()A-Z0-9]{3,15})/.exec(t);
  if (add) {
    d.pinCourses.push(add[1]!);
    reasons.push(`加入「${add[1]}」`);
  }

  if (reasons.length === 0) return base;

  const intent: PlanIntent =
    d.excludeCourses.length > 0
      ? "swap-course"
      : d.pinCourses.length > 0
        ? "pin-course"
        : d.goal !== null || d.goals.length > 0
          ? "change-goal"
          : d.avoidDays.length > 0 || d.allowDays.length > 0 || d.avoidEarly !== null || d.preferCompactDays !== null
            ? "adjust-time"
            : "adjust-load";

  return { ...base, intent, delta: d, reason: reasons.join("、") };
}

function offlineAskIntent(raw: string): z.infer<typeof zAskIntent> {
  const t = raw.replace(/\s/g, "");
  const base = {
    intent: "out-of-scope" as const,
    forbidden: null,
    clarify: null,
    category: null,
    topic: null,
    course: null,
    procedure: null,
    scenario: null,
  };
  const forbidden = detectForbidden(t);
  if (forbidden) return { ...base, forbidden };

  if (/提前.*畢業|早一?學期畢業/.test(t)) {
    return {
      ...base,
      intent: "what-if",
      scenario: {
        type: "early-graduation",
        targetTerm: /(\d{3}-[12])/.exec(t)?.[1] ?? null,
        dept: null,
        program: null,
        code: null,
      },
    };
  }
  if (/停修|退選|撤選/.test(t)) {
    const code = /([A-Z]{2}\d{4})/.exec(raw)?.[1];
    const quoted = /[「『]([^」』]{2,20})[」』]/.exec(raw)?.[1];
    // 「停修資料探勘會怎樣」的課名到語尾詞為止；「停修一門三學分的課」則根本沒有指名課程
    const tail = /(?:停修|退選|撤選)(?:掉)?([一-龥]{2,20})/.exec(t)?.[1] ?? "";
    const name = tail
      .replace(/(的課|會怎樣|會如何|怎麼樣|可以嗎|好不好|嗎|呢).*$/, "")
      .replace(/^(掉)?(一|某|那|這|幾)?[門堂]/, "");
    const generic = /^[一二三四五六七八九十兩\d]*學?分?的?課?程?$/.test(name);
    const key = code ?? quoted ?? (name.length >= 2 && !generic ? name : null);
    if (!key) return { ...base, clarify: "想停修哪一門課？給我課號或完整課名。" };
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "withdraw-course", targetTerm: null, dept: null, program: null, code: key },
    };
  }
  // 轉系、雙主修、輔系是三件不同的事，關鍵字由具體到一般比對，順序不能顛倒
  if (/轉系|轉入|轉到.*系/.test(t)) {
    const m = /轉(?:系|入|到)[：:]?\s*([一-龥]{2,6}?)系?(?:$|[，,。？?])|([一-龥]{2,6})系轉/.exec(t);
    const dept = (m?.[1] ?? m?.[2] ?? "").replace(/我想|申請|轉系|轉入/g, "") || null;
    if (!dept) return { ...base, clarify: "想轉到哪一個學系？" };
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "change-major", targetTerm: null, dept, program: null, code: null },
    };
  }
  if (/雙主修|雙學位/.test(t)) {
    const m = /([一-龥]{2,4})系雙主修|雙主修[：:]?\s*([一-龥]{2,4})/.exec(t);
    const dept = (m?.[1] ?? m?.[2] ?? "").replace(/申請|加修|我想/g, "") || null;
    if (!dept) return { ...base, clarify: "想加修哪一個學系的雙主修？" };
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "double-major", targetTerm: null, dept, program: null, code: null },
    };
  }
  if (/輔系|輔修/.test(t)) {
    const m = /([一-龥]{2,4})系(?:輔系|輔修)|(?:輔系|輔修)[：:]?\s*([一-龥]{2,4})/.exec(t);
    const dept = (m?.[1] ?? m?.[2] ?? "").replace(/申請|加修|我想/g, "") || null;
    if (!dept) return { ...base, clarify: "想加修哪一個學系的輔系？" };
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "add-minor", targetTerm: null, dept, program: null, code: null },
    };
  }
  if (/學程/.test(t) && /加修|申請|想修|修得|能不能/.test(t)) {
    const m = /([一-龥]{2,10}?)學程/.exec(t);
    const program = (m?.[1] ?? "").replace(/加修|申請|想修/g, "");
    if (!program) return { ...base, clarify: "想加修哪一個學分學程？" };
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "add-cert-program", targetTerm: null, dept: null, program, code: null },
    };
  }
  if (/成績門檻|甄試|書審|推甄|加權平均|我的平均/.test(t)) {
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "grade-threshold", targetTerm: null, dept: null, program: null, code: null },
    };
  }

  if (/幫我排|排課|排下學期|課表怎麼排/.test(t)) return { ...base, intent: "plan" };

  if (/怎麼申請|怎麼辦理|要去哪|找誰|流程|期限|截止|表單/.test(t)) {
    return { ...base, intent: "procedure", procedure: t };
  }

  if (/什麼時候開|誰教|哪個老師開|有沒有名額|餘額|幾學分.*課|時段/.test(t)) {
    const code = /([A-Z]{2}\d{4})/.exec(raw)?.[1];
    const name = /([一-龥]{3,12})(?:什麼時候|誰教|有沒有|還有)/.exec(t)?.[1];
    return { ...base, intent: "course-info", course: code ?? name ?? t };
  }

  if (/可以流用|能不能流用|規定|學則|規劃表|要幾學分|上限|下限|幾學分才能|領域/.test(t)) {
    return { ...base, intent: "regulation", topic: t };
  }

  if (/還差|還缺|差多少|夠了嗎|能不能畢業|可以畢業|畢得了|我的.*學分|待確認|超修|多少學分/.test(t)) {
    const cat = ["通識", "系專業選修", "系專業必修", "自由選修", "院基礎", "校訂共同必修"].find((c) =>
      t.includes(c),
    );
    return { ...base, intent: "personal-audit", category: cat ?? null };
  }

  return base;
}

// ------------------------------------------------------------ 共用工具

function renderHistory(messages: ChatMessage[]): string {
  return messages
    .slice(-10)
    .map((m) => `${m.role === "user" ? "學生" : "系統"}：${m.content}`)
    .join("\n");
}

export function lastUser(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!.content;
  }
  return "";
}

/** §0.7 澄清提問每個問題 ≤ 1 次，再不明確就轉「超出範圍」 */
export function alreadyClarified(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant") return m.meta?.clarifying === true;
  }
  return false;
}
