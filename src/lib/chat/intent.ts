import { z } from "zod/v4";
import { structured, type LlmBudget } from "@/lib/llm/client";
import { findCourseCode } from "@/lib/courses/code";
import { allOfferings } from "@/lib/offerings";
import { isKnownTopic } from "./topics";
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
      /** 只涵蓋第 1 節 */
      avoidEarly: z.boolean().nullable(),
      /** 整個早上（第 1–4 節）；與 avoidEarly 是兩件事，不得互相代用 */
      avoidMorning: z.boolean().nullable(),
      /**
       * 某一天的某個時段（「禮拜一早上要打工」「週五下午不要有課」）。
       * 整天用 avoidDays；每天早上用 avoidMorning。三者範圍不同，不得互相代用 ——
       * 用 avoidDays 代替「週五下午」會把整個星期五都空掉，做得比使用者要的多。
       */
      avoidDayParts: z
        .array(
          z.object({
            day: z.number().int().min(1).max(7),
            part: z.enum(["morning", "afternoon", "evening"]),
          }),
        )
        .max(14),
      /** 只是「盡量」集中；說了幾天要用 maxDays */
      preferCompactDays: z.boolean().nullable(),
      /**
       * 課必須排在幾天內（「集中在一天」填 1、「兩天就好」填 2）；不限天數填 7。
       * 與 preferCompactDays 不同：那只是盡量，這是硬限制，排不進就回報做不到。
       */
      maxDays: z.number().int().min(1).max(7).nullable(),
      maxCredits: z.number().int().min(0).max(30).nullable(),
      courseCountDelta: z.number().int().min(-6).max(6).nullable(),
      courseCountTarget: z.number().int().min(0).max(30).nullable(),
      goal: z.enum(["asap", "balanced", "light"]).nullable(),
      goals: z.array(z.enum(["early-graduation", "minor", "cert-program"])).max(3),
      /** 課號或課名；程式會自行查開課資料轉成課號 */
      excludeCourses: z.array(z.string().max(40)).max(5),
      pinCourses: z.array(z.string().max(40)).max(5),
      /** 「想修一堂 AI 相關的課」的主題（AI、程式、資安…）；沒提到填 null（TODO G2） */
      addTopic: z.string().max(20).nullable().optional(),
      /** 新加的那門課要幾學分（「多選一堂兩學分的課」填 2）；只限新加的課，沒提到填 null（TODO G1） */
      newCourseCredits: z.number().int().min(1).max(6).nullable().optional(),
      /**
       * 「換成」「改成」：拿掉的課由新的課補上，堂數不變（TODO G12）。
       * 與「多一堂」「加一堂」不同：那是堂數 +1
       */
      // 不用 nullable：Claude 的結構化輸出最多 16 個可為 null 的欄位，排課的格式原本有 18 個（Haiku 5.5 實測 400）。
      // 用 optional：沒說就省略，程式本來也只看真假
      replace: z.boolean().optional(),
      /**
       * 拿掉某一類的課（「拿掉一堂通識」「通識拿掉」「這學期不排通識」）。
       * category 填使用者說的類別（通識、選修、必修、全人…）；count 填幾門，「全部、這學期都不排」填 "all"，沒說填 null
       */
      dropCategory: z
        .object({ category: z.string().max(12), count: z.union([z.number().int().min(1).max(6), z.literal("all")]).nullable() })
        .nullable()
        .optional(),
      /** 「換另一門」：上一次拿掉的那門放回來，改拿同一類的另一門 */
      dropAnother: z.boolean().optional(),
      reset: z.boolean(),
    })
    .nullable(),
  /** intent=explain 時，使用者問的是哪一門課（課號或課名） */
  explainCourse: z.string().max(40).nullable(),
  /**
   * 供 trace 稽核用：模型自述它認為自己改了什麼。
   *
   * **不會顯示給使用者。** 畫面上的「改了什麼」由 apply.ts 的 describeDelta
   * 從前後約束集合的實際差異產生 —— 模型的自述與實際套用的參數可能不一致
   * （見 describeDelta 的註解），留著是為了讓 trace 能對照出這種落差。
   */
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

/**
 * 禁止主題的判定規則，兩個介面共用。
 *
 * 舊版只寫「問到成績預測、教師評價、代為選課等，回傳對應的 forbidden 分類」：
 * 沒說預設是 null，六個代號也沒有中文定義，模型只能自己猜 other-student 是什麼意思。
 * 實測 自架小模型 把「課盡量集中」「為什麼沒有企業流程管理」都判成 other-student，
 * 該拒絕的句子也常拒錯理由。同一組 12 句各跑 3 次：舊版 14/36，加上預設值與
 * 定義後 30/36，其中該拒絕的 4 句理由全對。
 */
const FORBIDDEN_RULE = [
  "forbidden 預設為 null。只有使用者的問題明確屬於下列六類之一才填，其餘一律 null：",
  "   grade-prediction    要系統預測成績、會不會過、好不好過",
  "   teacher-evaluation  要系統評價老師教得好不好",
  "   act-on-behalf       要系統代為選課、送件、申請",
  "   professional-advice 法律、醫療、心理諮商",
  "   other-institution   問別的學校的規定",
  "   other-student       要查別人（同學、朋友、室友）的資料",
].join("\n");

const PLAN_SYSTEM = [
  "你是選課建議的條件解析元件。使用者會用一句話描述想怎麼調整下學期的課表。",
  "要寫給使用者看的文字（clarify）一律用台灣繁體中文。",
  "",
  "你唯一的工作是把這句話對應到固定的意圖與參數。",
  "你不知道也不需要知道任何學分數字、課表內容或判定結果 —— 那些由確定性求解器負責。",
  "",
  "允許的意圖只有這些：",
  "  adjust-time   調整時段（不要早八、不要早上、週五下午不要、把週五的課拿掉）",
  "  adjust-load   調整堂數或學分（輕鬆一點、多修一點、只修三門、15 學分以內）",
  "  swap-course   換掉某一門課",
  "  pin-course    某一門課一定要留、加某一門課、想修某個主題的課（AI 相關、程式相關）",
  "  change-goal   改變目標（提前畢業、加修輔系或學程），或重來、取消調整",
  "  explain       問為什麼選了某門課、為什麼沒有某門課",
  "  compare       再給我一版、跟上一版差在哪",
  "清單外的一律回傳 out-of-scope。",
  "",
  "其他規則：",
  "1. 只輸出使用者明確說出口的參數，不得推測。",
  "   沒提到的欄位：布林填 null、數字填 null、陣列填 []。false 與 0 代表使用者真的這樣說。",
  "2. 缺少必要參數時（例如說要換掉某課卻沒說是哪一門），回傳 clarify 並只問一個問題。",
  `3. ${FORBIDDEN_RULE}`,
  "   描述自己想怎麼排課（星期、時段、堂數、學分、加減某門課、再給一版、重來）永遠不是 forbidden。",
  "4. 時段有三種範圍，由窄到寬，不得互相代用：",
  "   某天的某時段（禮拜一早上、週五下午）→ avoidDayParts",
  "   每天早上（第 1–4 節）→ avoidMorning；只有早八（第 1 節）→ avoidEarly",
  "   整天（空出星期五）→ avoidDays",
  "   「盡量集中」→ preferCompactDays；說了天數（集中在一天、兩天就好）→ maxDays",
  "5. 重來、回到原本、全部取消 → intent=change-goal、delta.reset=true。這不是 compare。",
  "   「取消剛剛的調整」「改回去」是退回上一步，由畫面處理，不要填 reset。",
  "6. reason 只描述「改了什麼條件」，不得描述課表會變成什麼樣子。",
  "7. 想修某個主題的課（「我想修一堂 AI 相關的課」）→ intent=pin-course、delta.addTopic 填主題（如 \"AI\"），",
  "   不要猜課名放進 pinCourses。說了新加的課要幾學分（「多選一堂兩學分的課」）→ delta.newCourseCredits 填 2，",
  "   同時 courseCountDelta=1。學分數只限新加的那門，不是學期學分上限（那是 maxCredits）。",
  "8. 「換成」「改成」→ delta.replace=true，堂數不變，courseCountDelta 不要填。「加一堂」「多一堂」才是 courseCountDelta=1。",
  "9. 拿掉某一類的課（「拿掉一堂通識」「通識拿掉」「這學期不排通識」）→ delta.dropCategory：category 填使用者說的類別，",
  "   count 填幾門；「全部」「這學期都不排」填 \"all\"；沒說幾門填 null（程式會反問），不要猜。不要把類別名稱放進 excludeCourses。",
  "   「換另一門」（上一輪拿掉的那門不要拿，改拿另一門）→ delta.dropAnother=true。",
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

/**
 * 模型寫的反問句會原樣顯示給學生。混進簡體字（2026-10-12 實測「请问你想延几学期毕业」）就換成通用的問法，
 * 不顯示。只列簡繁寫法不同、而且在反問句裡常見的字。
 */
const SIMPLIFIED = /[请这们个说时学选课还没为会对过发经应门间关现实点从让给头买问题么级历设际几毕业]/;
export function safeQuestion(q: string): string {
  return SIMPLIFIED.test(q) ? "可以再說得具體一點嗎？例如目標學期、學系或課名。" : q;
}

function toPlanResult(d: z.infer<typeof zPlanIntent>, raw: string): PlanIntentResult {
  if (d.forbidden) return { kind: "forbidden", topic: d.forbidden };
  if (d.intent === "out-of-scope") return { kind: "out-of-scope" };
  if (d.clarify) return { kind: "clarify", question: safeQuestion(d.clarify) };
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
  category: z
    .string()
    .max(20)
    .nullable()
    .describe("使用者問的學分類別，例如「通識」「系專業選修」；沒指定類別就填 null。不是意圖名稱"),
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
  "要寫給使用者看的文字（clarify）一律用台灣繁體中文。",
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
  `3. ${FORBIDDEN_RULE}`,
  "   問自己的修業進度、規定、開課資訊、辦理流程永遠不是 forbidden。",
  "   「我想申請學程」「我想加修輔系」是在問能不能、要怎麼辦，不是要系統代辦；",
  "   只有要系統替他送出申請、選課、填表才是 act-on-behalf。",
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
  return toAskResult(res.data, lastUser(messages));
}

function toAskResult(d: z.infer<typeof zAskIntent>, raw: string): AskIntentResult {
  if (d.forbidden) return { kind: "forbidden", topic: d.forbidden };
  if (d.clarify) return { kind: "clarify", question: safeQuestion(d.clarify) };
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
      raw,
    },
  };
}

// ------------------------------------------------- 規則式解析（模型的後援與安全網）

/**
 * 用離線替身的同一套規則解析，供 route.ts 在模型之外再判一次。
 *
 * 規則只比對字面，不會推測使用者沒說的東西，所以拿來當兩種用途：
 *   - 安全網：規則判定為禁止主題就一律拒絕。只會多擋、不會少擋 ——
 *     實測 自架小模型 對「我最近壓力好大睡不著」偶爾不拒絕，反而把修課目標改成輕量。
 *   - 後援：模型沒給出任何有效變更（沒填、填錯被擋、或填成原本就是的值）、
 *     或回超出範圍，而規則能從原句抽出明確條件時，改用規則的。
 *     實測模型對「不要早上的課」填成只涵蓋第 1 節的 avoidEarly、對「我想輕鬆一點」什麼都沒填。
 * 反方向永遠不做：規則絕不推翻模型的拒絕。
 */
export function rulePlanIntent(raw: string): PlanIntentResult {
  return toPlanResult(offlinePlanIntent(raw), raw);
}

export function ruleAskIntent(raw: string): AskIntentResult {
  return toAskResult(offlineAskIntent(raw), raw);
}

// ------------------------------------------------------------ 離線替身

/**
 * 禁止主題的關鍵字。順序有意義：先比對的先贏。
 *
 * 每一條都要求「評價／預測／代辦」的語意，而不是只要提到某個名詞就擋 ——
 * 早期版本只要句子裡有「老師」就判成評價教師，結果「企業流程管理是哪個老師開的」
 * 這種開課資訊也被拒絕；「心理」會擋掉「我想修心理學」。
 */
const FORBIDDEN_PATTERNS: [RegExp, ForbiddenTopic][] = [
  [
    /(老師|教授|講師).{0,6}(怎麼樣|好不好|如何|人好|教得|甜|涼|兇|嚴|推薦|評價|好嗎)|甜不甜|涼不涼|給分|評價/,
    "teacher-evaluation",
  ],
  [
    /會不會被?當|被當掉|會不會.{0,2}過|好不好過|難不難過|好過嗎|難過嗎|過得了|預測.*成績|猜.*成績|能不能考上|錄取機會|上得了/,
    "grade-prediction",
  ],
  [
    /幫我(?:直接|先|去|順便)?(?:選課|加選|退選|申請|送件|報名|選上|選)|幫我把.{0,8}(?:送出|選上|加選|退選)|代為(?:選課|申請)/,
    "act-on-behalf",
  ],
  [/法律(?!系)|訴訟|律師|看醫生|生病|憂鬱|焦慮|失眠|睡不著|想不開|心理(?!學|系)|諮商/, "professional-advice"],
  [
    /他校|別的學校|其他學校|外校|台大|臺大|政大|清大|交大|成大|師大|北大|中興大學|中山大學|中正大學|輔大|淡江|東吳|逢甲/,
    "other-institution",
  ],
  [
    /(同學|室友|朋友|學長|學姊|學姐|學弟|學妹|男友|女友|別人|其他學生|其他人)的?.{0,6}(成績|學分|資料|修課|課表|畢業)|他的成績|別人的/,
    "other-student",
  ],
];

function detectForbidden(t: string): ForbiddenTopic | null {
  // 課名裡的字不算：「法律與生活什麼時候上課」不是法律諮詢，「心理學與生活」不是心理諮商。
  // 規則判出的拒絕在 route 裡一律優先（安全網），所以這裡誤判，模型答對了也會被蓋掉
  const s = withoutCourseNames(t);
  for (const [re, topic] of FORBIDDEN_PATTERNS) if (re.test(s)) return topic;
  return null;
}

/** 把句子裡出現的開課課名（三個字以上，長的先）挖掉 */
function withoutCourseNames(t: string): string {
  const names = [...new Set(allOfferings().map((o) => o.name.replace(/\s/g, "")))]
    .filter((n) => n.length >= 3 && t.includes(n))
    .sort((a, b) => b.length - a.length);
  return names.reduce((s, n) => s.split(n).join("　"), t);
}

export const DAY_WORDS: [RegExp, number][] = [
  [/星期一|週一|禮拜一/, 1],
  [/星期二|週二|禮拜二/, 2],
  [/星期三|週三|禮拜三/, 3],
  [/星期四|週四|禮拜四/, 4],
  [/星期五|週五|禮拜五/, 5],
  [/星期六|週六|禮拜六/, 6],
  [/星期日|星期天|週日|禮拜天/, 7],
];

/**
 * 句子裡每個星期是什麼意思，以分句判斷（「不要早八，最好在禮拜一」的「不要」不能算到禮拜一頭上）：
 *   block   不要排、空出（「星期五不要排課」）
 *   free    解除空出、可以排（「解除「空出星期一」」「星期三可以排」）
 *   prefer  想排在這天（「最好在禮拜一、二、四」）—— 系統沒有「某門課排哪天」的條件，不能當成空出
 * 「星期一、二、四」這種簡寫先展開。
 */
export function dayCues(text: string): { block: number[]; free: number[]; prefer: number[] } {
  const t = text.replace(/(星期|禮拜|週|周)([一二三四五六日天])((?:\s*[、,，和跟及或與]\s*[一二三四五六日天](?![一-龥]{0,0}[期拜]))+)/g, (_m, w: string, first: string, more: string) =>
    [first, ...more.split(/\s*[、,，和跟及或與]\s*/).filter(Boolean)].map((d) => w + d).join("、"),
  ).replace(/周/g, "週");
  const out = { block: [] as number[], free: [] as number[], prefer: [] as number[] };
  for (const clause of t.split(/[，,。；;！!？?]|但是|不過|然後/)) {
    const days = DAY_WORDS.filter(([re]) => re.test(clause)).map(([, d]) => d);
    if (days.length === 0) continue;
    const kind = /解除|取消|恢復|不用空|不必空|可以排|能排|可以有課|沒關係/.test(clause)
      ? "free"
      : BLOCK_CUE.test(clause) || /放假|休息|不上課|沒課|空下來|空出來/.test(clause)
        ? "block"
        : /最好|希望|想要?|排在|安排在|放在|^.{0,4}在/.test(clause)
          ? "prefer"
          : "block";
    out[kind].push(...days);
  }
  return out;
}

export type DayPart = "morning" | "afternoon" | "evening";
export const PART_WORDS: [RegExp, DayPart][] = [
  [/早上|上午/, "morning"],
  [/下午|午後/, "afternoon"],
  [/晚上|夜間/, "evening"],
];
const PART_LABEL: Record<DayPart, string> = { morning: "早上", afternoon: "下午", evening: "晚上" };
/** 句子是在「畫掉」某段時間，而不是在說那段時間可以 */
export const BLOCK_CUE = /不要|不想|別排|別|空出|空下|拿掉|沒辦法|不行|沒空|要打工|要上班|有事/;

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/**
 * 「3」「三」「十二」「二十」→ 數字；兩位數以內就夠用（學分、堂數都不會更大）。
 * 離線規則與 apply.ts 的數值防護共用，兩邊對「使用者說了幾」的理解必須一致。
 */
export function parseNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  const m = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m) return (m[1] ? CN_DIGIT[m[1]]! : 1) * 10 + (m[2] ? CN_DIGIT[m[2]]! : 0);
  return s.length === 1 ? (CN_DIGIT[s] ?? null) : null;
}
const numOf = (x: string | undefined) => (x === undefined ? null : parseNum(x));

function emptyDelta() {
  return {
    avoidDays: [] as number[],
    allowDays: [] as number[],
    avoidEarly: null as boolean | null,
    avoidMorning: null as boolean | null,
    avoidDayParts: [] as { day: number; part: "morning" | "afternoon" | "evening" }[],
    preferCompactDays: null as boolean | null,
    maxDays: null as number | null,
    maxCredits: null as number | null,
    courseCountDelta: null as number | null,
    courseCountTarget: null as number | null,
    goal: null as "asap" | "balanced" | "light" | null,
    goals: [] as ("early-graduation" | "minor" | "cert-program")[],
    excludeCourses: [] as string[],
    pinCourses: [] as string[],
    addTopic: null as string | null,
    newCourseCredits: null as number | null,
    replace: false,
    dropCategory: null as { category: string; count: number | "all" | null } | null,
    dropAnother: false,
    reset: false,
  };
}

/** 「這學期都不排通識」：整類不排，不是拿一門（模型填的 count="all" 也要原句有這種說法才算） */
export const DROP_ALL_CUE = /全部|都(?:拿掉|不要|不排|去掉)|這學期(?:都)?不(?:想)?(?:排|修|要|上|選)|全拿掉/;

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
    const code = findCourseCode(raw);
    const name = /(?:為什麼|為何|怎麼)(?:沒有|沒|不)?(?:選|排|上|排入)?(?:有)?([一-龥（）()]{3,15}?)[？?。]?$/.exec(t)?.[1];
    return { ...base, intent: "explain", explainCourse: code ?? name ?? null };
  }
  if (/再給我一版|另一版|其他方案|換一組|差在哪|比較/.test(t)) {
    return { ...base, intent: "compare" };
  }
  // 「改回去」「回上一版」是退一步，由畫面上的對話紀錄處理（ChatPanel），不是重來
  if (/重來|回到原本|回到最初|重設|全部取消|取消(?:所有|全部)的?(?:調整|設定|條件)/.test(t)) {
    const d = emptyDelta();
    d.reset = true;
    // 重設不是調整堂數；標成 adjust-load 會讓 trace 記成完全不同的一件事
    return { ...base, intent: "change-goal", delta: d, reason: "重設為個人資料的原始設定" };
  }

  const d = emptyDelta();
  const reasons: string[] = [];

  // 時段由窄到寬比對，每比對到一段就從句子裡拿掉，剩下的才交給更寬的規則：
  //   某天的某時段（週五下午）→ 每天的某時段（早上）→ 整天（星期五）
  // 順序顛倒的話，「週五下午不要有課」會被當成整個星期五，
  // 「禮拜一早上要打工」會變成每天早上都不排 —— 做的比使用者要的多，而且是無聲的。
  let rest = t;
  const blocking = BLOCK_CUE.test(t);
  for (const [dre, day] of DAY_WORDS) {
    for (const [pre, part] of PART_WORDS) {
      const re = new RegExp(`(?:${dre.source})的?(?:${pre.source})`);
      if (!re.test(rest)) continue;
      if (blocking) {
        d.avoidDayParts.push({ day, part });
        reasons.push(`空出星期${"一二三四五六日"[day - 1]}${PART_LABEL[part]}`);
      }
      rest = rest.replace(re, "＿");
    }
  }

  // 「早上」（第 1–4 節）比「早八」（第 1 節）範圍大，兩者不得互相代用
  if (/早八|第一節|太早/.test(rest)) {
    d.avoidEarly = !/(?:可以|能|接受|不介意)(?:排|上|有)?早八|早八(?:也)?(?:可以|沒關係|沒差)/.test(rest);
    reasons.push(d.avoidEarly ? "不排早八" : "接受早八");
  } else if (/早上|上午/.test(rest)) {
    d.avoidMorning = !/(?:可以|能|接受|不介意)(?:排|上|有)?(?:早上|上午)|(?:早上|上午)(?:也)?(?:可以|沒關係|沒差)/.test(rest);
    reasons.push(d.avoidMorning ? "不排早上的課" : "接受早上的課");
  } else if (/下午|午後/.test(rest)) {
    if (BLOCK_CUE.test(rest)) {
      // 「下午不要有課」：每個平日的下午都畫掉
      for (const day of [1, 2, 3, 4, 5]) d.avoidDayParts.push({ day, part: "afternoon" });
      reasons.push("不排下午的課");
    } else {
      // 「集中在下午」「下午的課比較好」：想要下午，等於早上不要
      d.avoidMorning = true;
      reasons.push("課排在下午（不排早上）");
    }
  }
  if (/晚上|夜間/.test(rest) && BLOCK_CUE.test(rest)) {
    for (const day of [1, 2, 3, 4, 5]) d.avoidDayParts.push({ day, part: "evening" });
    reasons.push("不排晚上的課");
  }

  const cues = dayCues(rest);
  for (const day of cues.block) {
    d.avoidDays.push(day);
    reasons.push(`空出星期${"一二三四五六日"[day - 1]}`);
  }
  for (const day of cues.free) {
    d.allowDays.push(day);
    reasons.push(`開放星期${"一二三四五六日"[day - 1]}`);
  }
  // 「少一堂」「少修一門」「少選一堂」「減少一堂」；動詞可有可無
  const less = /(?:減)?少(?:修|選|排|上)?(\d+|[一二兩三四])?[堂門]/.exec(t);
  const lessVague = /少修?一?點|少排一?點|少一些/.test(t);
  if (less || lessVague) {
    d.courseCountDelta = -(less ? (numOf(less[1]) ?? 1) : 1);
    reasons.push(`堂數減少 ${Math.abs(d.courseCountDelta)} 堂`);
  }
  // 「多一堂」「多修一門」「多選一堂」—— 先前漏了「多選」，整句掉進超出範圍
  const more = /多(?:修|選|排|上|加)?(\d+|[一二兩三四])?[堂門]/.exec(t);
  const moreVague = /多修?一?點|多排一?點|多一些|多上一?點/.test(t);
  if (more || moreVague) {
    d.courseCountDelta = more ? (numOf(more[1]) ?? 1) : 1;
    reasons.push(`堂數增加 ${d.courseCountDelta} 堂`);
  }
  // 「我想修一堂 AI 相關的課」「加一門程式有關的課程」（TODO G2）
  const topic = /([A-Za-z]{1,12}|[一-鿿]{1,6})(?:相關|有關)的?課/.exec(t);
  if (topic) {
    // 「想修一堂程式」→「程式」：取「修、堂、門、想、要…」之後的最後一段
    const parts = topic[1]!.split(/[我想要修上選加排一堂門個些的]/).filter(Boolean);
    d.addTopic = parts.at(-1) ?? topic[1]!;
    reasons.push(`想修一門「${d.addTopic}」相關的課`);
  } else {
    // 「換成一堂 AI 的課」：沒寫「相關」，但 AI 是已知主題（「換成一堂兩學分的課」的「兩學分」不是）
    const bare = /(?:換成|改成|換為|加|修|上|選)(?:一[堂門個])?([A-Za-z]{1,12}|[一-鿿]{2,6}?)的?課/.exec(t);
    if (bare && isKnownTopic(bare[1]!)) {
      d.addTopic = bare[1]!;
      reasons.push(`想修一門「${d.addTopic}」相關的課`);
    }
  }
  // 「換另一門」：上一次拿掉的放回來，改拿同一類的另一門（TODO G12）
  if (/換另一門|換別門|拿另一門|換另外一門|拿別的那門|換一門別的/.test(t)) {
    d.dropAnother = true;
    reasons.push("改拿另一門");
  }
  // 「換成」「改成」：堂數不變（TODO G12）
  if (/換成|改成|換為|替換成|換一堂|換一門/.test(t)) d.replace = true;
  // 「拿掉一堂通識」「通識拿掉」「這學期不排通識」「不要通識」（TODO G12）
  const dropBefore = /(?:拿掉|去掉|刪掉|移除|少(?:修|選|排|上)?|不要|不排|不想(?:上|修|選)|不(?:上|修))(\d|[一二兩三四])?[堂門個]?的?(通識|選修|必修|全人|核心|基本能力|群組)/.exec(t);
  const dropAfter = /把?(\d|[一二兩三四])?[堂門個]?的?(通識|選修|必修|全人|核心|基本能力|群組)(?:課程?)?(?:都|全部|全)?(?:拿掉|去掉|刪掉|移除|不要|不排|換成|改成|換掉)/.exec(t);
  const drop = dropBefore ?? dropAfter;
  if (drop) {
    const all = DROP_ALL_CUE.test(t);
    // 「通識拿掉，換成一堂 AI 的課」：沒說拿幾門，但「換成一堂」就是換一門
    const n = drop[1] ? numOf(drop[1]) : d.replace && /換成一[堂門個]|改成一[堂門個]/.test(t) ? 1 : null;
    d.dropCategory = { category: drop[2]!, count: all ? "all" : n };
    reasons.push(`拿掉${all ? "全部" : n ? `${n} 門` : ""}「${drop[2]}」`);
    // 「少一堂通識」的「少一堂」已經算進拿掉的門數，不再另外減堂數
    if (d.courseCountDelta !== null && d.courseCountDelta < 0) d.courseCountDelta = null;
  }

  // 「多選一堂兩學分的課」：只限新加的那門（TODO G1）
  const perCourse = /(\d|[一二兩三四五六])學分的課/.exec(t);
  if (perCourse) {
    const n = numOf(perCourse[1]);
    if (n !== null && n >= 1 && n <= 6) {
      d.newCourseCredits = n;
      reasons.push(`新加的課 ${n} 學分`);
    }
  }
  const exact = /(\d+|[一二兩三四五六])[堂門]課?就好|只(?:想)?修(\d+|[一二兩三四五六])[堂門]/.exec(t);
  if (exact) {
    const n = numOf(exact[1] ?? exact[2]);
    if (n !== null) {
      d.courseCountTarget = n;
      reasons.push(`期望 ${n} 堂課`);
    }
  }
  // 「15 學分以內」「學分不要超過 15」「最多 15 學分」「十二學分以內」都要接得住
  const N = "(\\d+|[一二兩三四五六七八九十]+)";
  const credits =
    new RegExp(`${N}\\s*學分(?:以內|以下|上限|就好|就夠)`).exec(t) ??
    new RegExp(`學分(?:不要?超過|最多|上限|別超過)\\s*${N}`).exec(t) ??
    new RegExp(`(?:不要?超過|最多|別超過)\\s*${N}\\s*學分`).exec(t);
  const creditN = credits ? numOf(credits[1]) : null;
  if (creditN !== null) {
    d.maxCredits = creditN;
    reasons.push(`學分上限 ${d.maxCredits}`);
  }
  if (/集中|不要太散|排在一起|同一天|少跑幾天/.test(t)) {
    d.preferCompactDays = true;
    reasons.push("課程盡量集中");
  }
  // 說了天數就是硬限制：「集中在一天」「兩天就好」「只想上三天」
  const DN = "(\\d+|[一二兩三四五六七])";
  const daysM =
    new RegExp(`(?:集中(?:在|到|成)|排(?:在|到)|塞(?:在|到)|壓(?:在|到)|只(?:想)?(?:上|排))\\s*${DN}\\s*天`).exec(t) ??
    new RegExp(`${DN}\\s*天(?:內|以內|就好|上完)`).exec(t);
  const dayN = daysM ? numOf(daysM[1]) : null;
  if (dayN !== null && dayN >= 1 && dayN <= 6) {
    d.maxDays = dayN;
    reasons.push(`課排在 ${dayN} 天內`);
  } else if (/天數不限|不限天數|幾天都(?:可以|行|沒關係)/.test(t)) {
    d.maxDays = 7;
    reasons.push("不限上課天數");
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
  const swapAfter = /(?:換掉|不想修|不想上|不要上|不要修|拿掉)([一-龥（）()A-Z0-9]{3,15})/.exec(t);
  const swapBefore = /把([一-龥（）()A-Z0-9]{3,15}?)(?:換掉|拿掉|去掉|移除)/.exec(t);
  // 拿掉的是一整類（上面的 dropCategory），不是課名；「通識拿掉換成…」的「換成…」也不是課名
  const swapName = d.dropCategory ? undefined : (swapBefore?.[1] ?? swapAfter?.[1]);
  // 「把週五的課拿掉」「不要上到晚上」說的是時段不是課名 —— 時段已由上面處理，
  // 這裡再當成課名去查只會多一句「開課資料中找不到「週五的課」」
  if (swapName && !/早八|早上|上午|下午|晚上|星期|週|禮拜|第.節/.test(swapName)) {
    d.excludeCourses.push(swapName);
    reasons.push(`排除「${swapName}」`);
  }
  const pin = /([一-龥（）()A-Z0-9]{3,15})(?:一定要留|要保留|不要動|留著)/.exec(t);
  if (pin) {
    d.pinCourses.push(pin[1]!);
    reasons.push(`保留「${pin[1]}」`);
  }
  // 「加修心理學」的「修」是動詞不是課名的一部分，否則會去查「修心理學」而找不到
  const add = /(?:幫我)?加(?:修)?(?:一門|一堂)?([一-龥（）()A-Z0-9]{3,15})/.exec(t);
  // 「加一門程式相關的課」是主題，不是課名（上面的 addTopic 已處理）
  if (add && !d.addTopic) {
    d.pinCourses.push(add[1]!);
    reasons.push(`加入「${add[1]}」`);
  }

  if (reasons.length === 0) return base;

  const intent: PlanIntent =
    d.excludeCourses.length > 0 || d.dropCategory || d.dropAnother
      ? "swap-course"
      : d.pinCourses.length > 0 || d.addTopic
        ? "pin-course"
        : d.goal !== null || d.goals.length > 0
          ? "change-goal"
          : d.avoidDays.length > 0 ||
              d.allowDays.length > 0 ||
              d.avoidEarly !== null ||
              d.avoidMorning !== null ||
              d.avoidDayParts.length > 0 ||
              d.preferCompactDays !== null ||
              d.maxDays !== null
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

  // 開課資訊的問句形式最明確（什麼時候開、誰教、有沒有名額），排最前面。
  // 排在「流程」後面的話，「企業流程管理什麼時候開」會因為課名裡有「流程」兩個字
  // 被當成辦理手續，回「系統未收錄這項事務的辦理流程」。
  // 「什麼時候開始」不算（「畢業審查什麼時候開始」是在問手續，2026-10-12 實測被當成查課）
  if (/什麼時候開(?!始)|什麼時候開始上|什麼時候上課?|上課時間|幾點上|星期幾上|禮拜幾上|哪天上|誰教|哪個老師開|有沒有名額|還有名額|餘額|幾學分.*課|時段/.test(t)) {
    const code = findCourseCode(raw);
    const name = /([一-龥]{2,12}?)(?:什麼時候|的?上課時間|幾點|星期幾|禮拜幾|哪天|誰教|有沒有|還有|是哪個)/.exec(t)?.[1];
    return { ...base, intent: "course-info", course: code ?? name ?? t };
  }

  // 「怎麼辦」要排在所有 what-if 之前：問的是手續，不是可不可行。
  // 排在後面的話，「怎麼申請輔系？」會先撞上 /輔系/ 那一條，因為句子裡沒有系名
  // 而被反問「想加修哪一個學系的輔系？」—— 使用者問流程，系統卻要他先選系，答非所問。
  if (/怎麼申請|如何申請|怎麼辦理|如何辦理|要去哪|去哪裡辦|找誰|流程|期限|截止|表單|表格|什麼時候(?:開始|申請|辦)|何時(?:開始|申請|辦)/.test(t)) {
    return { ...base, intent: "procedure", procedure: t };
  }

  // 「提前畢業」與「我想在 115-1 畢業」是同一件事：指定一個畢業學期去試算
  if (/提前.*畢業|早一?學期畢業|\d{3}-[12].{0,3}畢業|畢業.{0,4}\d{3}-[12]/.test(t)) {
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
    const code = findCourseCode(raw);
    const quoted = /[「『]([^」』]{2,20})[」』]/.exec(raw)?.[1];
    // 「停修資料探勘會怎樣」的課名到語尾詞為止；「停修一門三學分的課」則根本沒有指名課程
    // 課名後面的（二）、(上) 要一起抓：只抓「專題研究」會對到已修過的（一）（2026-10-12 實測）
    const tail = /(?:停修|退選|撤選)(?:掉)?([一-龥]{2,20}(?:[（(][一二三四五六七八九十上下\dA-Za-z]{1,3}[）)])?)/.exec(t)?.[1] ?? "";
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
  // 轉系、雙主修、輔系是三件不同的事，關鍵字由具體到一般比對，順序不能顛倒。
  // 學系名稱要明確寫出「某某系」才算試算：以前「雙主修」後面的幾個字照抓，
  // 「雙主修的規定是什麼」被當成「試算加修『的規定是』系」（2026-10-11 實測）。
  // 沒說哪一系的是在問規定或流程，交給後面的規則與模型
  const scenarioOf = (kw: RegExp): "procedure" | "regulation" | null =>
    kw.test(t) ? (/怎麼申請|如何申請|申請流程|怎麼辦|去哪|找誰|期限|什麼時候申請/.test(t) ? "procedure" : "regulation") : null;
  const deptNear = (kw: string): string | null => {
    const m =
      new RegExp(`(?:${kw})(?:到|進|去|成)?\\s*[：:]?\\s*(?:加修|申請|修)?\\s*([一-龥]{2,8}?)學?系`).exec(t) ??
      new RegExp(`([一-龥]{2,8}?)學?系的?(?:${kw})`).exec(t);
    const dept = cleanDept(m?.[1] ?? "");
    // 「雙主修跟輔系差在哪」的「跟輔」不是學系
    return dept.length >= 2 && !/^(?:本|外|他|別|各|該|哪個?|科|同|原|其他)$/.test(dept) && !/[跟和與或的是在嗎]|輔$|轉$/.test(dept) ? dept : null;
  };
  const generic = (kind: "procedure" | "regulation") =>
    kind === "procedure"
      ? { ...base, intent: "procedure" as const, procedure: t }
      : { ...base, intent: "regulation" as const, topic: t };
  if (/轉系|轉入|轉到.*系/.test(t)) {
    const dept = deptNear("轉系|轉入|轉到|轉");
    if (dept) return { ...base, intent: "what-if", scenario: { type: "change-major", targetTerm: null, dept, program: null, code: null } };
    if (/我想轉|想要轉|要轉/.test(t)) return { ...base, clarify: "想轉到哪一個學系？" };
    return generic(scenarioOf(/轉系|轉入/)!);
  }
  if (/雙主修|雙學位/.test(t)) {
    const dept = deptNear("雙主修|雙學位");
    if (dept) return { ...base, intent: "what-if", scenario: { type: "double-major", targetTerm: null, dept, program: null, code: null } };
    if (/^我?想(?:要)?(?:修|申請)?雙主修.?$/.test(t)) return { ...base, clarify: "想加修哪一個學系的雙主修？" };
    return generic(scenarioOf(/雙主修|雙學位/)!);
  }
  if (/輔系|輔修/.test(t)) {
    const dept = deptNear("輔系|輔修");
    if (dept) return { ...base, intent: "what-if", scenario: { type: "add-minor", targetTerm: null, dept, program: null, code: null } };
    if (/^我?想(?:要)?(?:修|申請)?(?:輔系|輔修).?$/.test(t)) return { ...base, clarify: "想加修哪一個學系的輔系？" };
    return generic(scenarioOf(/輔系|輔修/)!);
  }
  // 學程同上：名稱只取緊貼「學程」前面的那段，去掉「我想」「能不能修」這類字。
  // 以前整段照抓，「我想申請學程」被當成試算「我想學程」（2026-10-11 實測）
  if (/學程/.test(t)) {
    const m = /([A-Za-z一-龥]{2,14}?)(?:學分|微)?學程/.exec(t);
    const program = (m?.[1] ?? "")
      .replace(/^.*?(?:加修|申請|想修|修讀|要修|能修|修|讀|念)/, "")
      .replace(/^(?:我|想要?|要|能不能|可不可以|可以|一個|這個|那個)+/, "")
      .replace(/(?:學分|微)$/, "");
    const named = program.length >= 2 && !/^(?:什麼|哪個|哪些|這|那|學分|微|跨領域)$/.test(program) && !/[跟和與或的是嗎]/.test(program);
    // 「電商學程我還差什麼」也是試算：問的是這個學程自己還差哪些，不是畢業進度（2026-10-12 實測模型答成畢業進度）
    if (named && /加修|申請|想修|修得|能不能|可不可以|想讀|會怎樣|如果|還差|還缺|差多少|還要修|要修哪些|要修什麼/.test(t)) {
      return { ...base, intent: "what-if", scenario: { type: "add-cert-program", targetTerm: null, dept: null, program, code: null } };
    }
    if (/^我?想(?:要)?(?:加修|修|申請|讀)?(?:學分|微)?學程.?$/.test(t)) return { ...base, clarify: "想加修哪一個學程？" };
    if (!named || !/加修|想修/.test(t)) return generic(scenarioOf(/學程/)!);
  }
  if (/成績門檻|甄試|書審|推甄|加權平均|我的平均/.test(t)) {
    return {
      ...base,
      intent: "what-if",
      scenario: { type: "grade-threshold", targetTerm: null, dept: null, program: null, code: null },
    };
  }

  if (/幫我排|排課|排下學期|課表怎麼排/.test(t)) return { ...base, intent: "plan" };

  if (/可以流用|能不能流用|規定|學則|規劃表|要修?幾學分|總共.{0,4}幾學分|最低.{0,3}學分|上限|下限|幾學分才能|領域/.test(t)) {
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

/**
 * 學系名稱前面黏著的口語去掉：「如果我修心理」→「心理」、「我想申請財金」→「財金」。
 * 規則抽的和模型填的都要過（2026-10-12 實測兩邊都抽成「如果我修心理」，心理系輔系就對不到）。
 * 學系名稱不會含這些字，所以取到最後一個為止。
 */
export function cleanDept(raw: string): string {
  const s = raw.trim().replace(/^.*(?:如果|假如|要是|我想|想要|想|申請|加修|修讀|修|要|讀|念|去|到|進)/, "");
  return s.length >= 2 ? s : raw.trim();
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
