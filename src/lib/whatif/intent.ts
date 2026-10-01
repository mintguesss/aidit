import { z } from "zod/v4";
import type { IntentResult, Scenario } from "@/lib/types";
import { structured, type LlmBudget } from "@/lib/llm/client";
import { findCourseCode } from "@/lib/courses/code";

/**
 * 情境試算的意圖解析（docs/SPEC.md §12）。
 *
 * 這不是聊天機器人：LLM 只做意圖解析，輸出結構化 scenario，
 * 之後一律交給確定性推算。意圖不明時回問一個澄清問題，不猜。
 * 無法對應到任何 scenario type 時，明確回覆請洽系辦，不自由發揮。
 */

const zIntent = z.object({
  kind: z.enum(["scenario", "clarify", "out-of-scope"]),
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
      /** early-graduation 用：目標畢業學期，如 "115-1" */
      targetTerm: z.string().nullable(),
      /** add-minor / double-major / change-major 用：系所代碼或名稱 */
      dept: z.string().nullable(),
      /** add-cert-program 用：學程名稱 */
      program: z.string().nullable(),
      /** withdraw-course 用：課號或課名 */
      code: z.string().nullable(),
      /** grade-threshold 用：目標描述 */
      target: z.string().nullable(),
    })
    .nullable(),
  /** kind = clarify 時的澄清問題，只問一個 */
  question: z.string().nullable(),
  /** kind = out-of-scope 時的回覆 */
  message: z.string().nullable(),
});

const SYSTEM = [
  "你是畢業審查系統的意圖解析元件，只負責把使用者的一句話對應到固定的情境類型。",
  "可用的情境類型只有七種：early-graduation、withdraw-course、add-minor、double-major、"
    + "add-cert-program、change-major、grade-threshold。",
  "輔系（add-minor）、雙主修（double-major）、轉系（change-major）是三件不同的事，不得互相代用。",
  "規則：",
  "1. 不得回答任何學分、畢業與否或課程建議 —— 那些由確定性程式計算。",
  "2. 對應不到上述任一類型時，回傳 kind=out-of-scope。",
  "3. 對應得到類型但缺少必要參數（如未指明課號）時，回傳 kind=clarify 並只問一個問題。",
  "4. 不得臆測使用者未說出口的參數。",
].join("\n");

export async function parseIntent(
  raw: string,
  context: { nextTerm: string; unmetCourses: string[] },
  budget: LlmBudget,
): Promise<IntentResult> {
  const res = await structured(
    {
      system: SYSTEM,
      user: [
        `下一個學期代號：${context.nextTerm}`,
        `目前建議修習之課程：${context.unmetCourses.join("、") || "（無）"}`,
        "使用者輸入：",
        raw,
      ].join("\n"),
      schema: zIntent,
      offline: () => offlineIntent(raw, context.nextTerm),
    },
    budget,
  );

  return toIntentResult(res.data, raw);
}

function toIntentResult(d: z.infer<typeof zIntent>, raw: string): IntentResult {
  if (d.kind === "clarify") {
    return { kind: "clarify", question: d.question ?? "請補充更具體的條件，例如目標學期或課號。", raw };
  }
  if (d.kind === "out-of-scope" || !d.scenario) {
    return {
      kind: "out-of-scope",
      message:
        d.message ??
        "此類問題不在本系統可推算的範圍內，請洽系辦公室或教務處註冊組。本系統僅就修業規劃之可行性作推算，不回答其他問題。",
      raw,
    };
  }

  const s = d.scenario;
  const scenario = ((): Scenario | null => {
    switch (s.type) {
      case "early-graduation":
        return s.targetTerm ? { type: "early-graduation", targetTerm: s.targetTerm } : null;
      case "add-minor":
        return s.dept ? { type: "add-minor", dept: s.dept } : null;
      case "double-major":
        return s.dept ? { type: "double-major", dept: s.dept } : null;
      case "change-major":
        return s.dept ? { type: "change-major", dept: s.dept } : null;
      case "add-cert-program":
        return s.program ? { type: "add-cert-program", program: s.program } : null;
      case "withdraw-course":
        return s.code ? { type: "withdraw-course", code: s.code } : null;
      case "grade-threshold":
        return { type: "grade-threshold", target: s.target ?? raw };
    }
  })();

  if (!scenario) {
    return { kind: "clarify", question: MISSING_PARAM[s.type] ?? "請補充更具體的條件。", raw };
  }
  return { kind: "scenario", scenario, raw };
}

const MISSING_PARAM: Record<string, string> = {
  "early-graduation": "請問希望於哪一個學期畢業？例如 115-1。",
  "add-minor": "請問想加修哪一個學系的輔系？",
  "double-major": "請問想加修哪一個學系的雙主修？",
  "change-major": "請問想轉到哪一個學系？",
  "add-cert-program": "請問想加修哪一個學分學程？",
  "withdraw-course": "請問想停修哪一門課？可提供課號或完整課名。",
  "grade-threshold": "請問想比較的成績門檻是什麼？",
};

/**
 * 離線替身：關鍵詞比對。
 * 刻意保守 —— 對不上就回 out-of-scope，不用相似度硬湊一個情境出來。
 */
function offlineIntent(raw: string, nextTerm: string): z.infer<typeof zIntent> {
  const t = raw.replace(/\s/g, "");
  const empty = { targetTerm: null, dept: null, program: null, code: null, target: null };

  if (/提前.*(畢業)|(畢業).*提前|早一?學期畢業/.test(t)) {
    const m = /(\d{3}-[12])/.exec(t);
    return {
      kind: "scenario",
      scenario: { ...empty, type: "early-graduation", targetTerm: m?.[1] ?? nextTerm },
      question: null,
      message: null,
    };
  }
  // 轉系、雙主修、輔系三者的關鍵字必須分開比對，且順序由具體到一般 ——
  // 「雙主修」含「主修」、「轉系」含「系」，比對順序錯了就會歸錯類，
  // 而這三件事適用的規定完全不同。
  if (/轉系|轉入|轉到.*系|系際轉換/.test(t)) {
    const m = /轉(?:系|入|到)[：:]?\s*([一-龥]{2,6}?)系?(?:$|[，,。？?])|([一-龥]{2,6})系轉/.exec(t);
    const dept = (m?.[1] ?? m?.[2] ?? "").replace(/我想|申請|轉系|轉入/g, "");
    return {
      kind: dept ? "scenario" : "clarify",
      scenario: dept ? { ...empty, type: "change-major", dept } : null,
      question: dept ? null : MISSING_PARAM["change-major"]!,
      message: null,
    };
  }
  if (/雙主修|雙學位/.test(t)) {
    const m = /([一-龥]{2,4})系雙主修|雙主修[：:]?\s*([一-龥]{2,4})/.exec(t);
    const dept = (m?.[1] ?? m?.[2] ?? "").replace(/申請|加修|我想/g, "");
    return {
      kind: dept ? "scenario" : "clarify",
      scenario: dept ? { ...empty, type: "double-major", dept } : null,
      question: dept ? null : MISSING_PARAM["double-major"]!,
      message: null,
    };
  }
  if (/輔系|輔修/.test(t)) {
    // 系名必須明確出現（「財金系輔系」或「輔系：財金」）。
    // 只寫「我想申請輔系」時不得把「申請」當成系名 —— 猜錯系名等於換一套畢業條件。
    const m = /([一-龥]{2,4})系(?:輔系|輔修)|(?:輔系|輔修)[：:]?\s*([一-龥]{2,4})/.exec(t);
    const dept = (m?.[1] ?? m?.[2] ?? "").replace(/申請|加修|我想/g, "");
    return {
      kind: dept ? "scenario" : "clarify",
      scenario: dept ? { ...empty, type: "add-minor", dept } : null,
      question: dept ? null : MISSING_PARAM["add-minor"]!,
      message: null,
    };
  }
  if (/學程/.test(t)) {
    const m = /([一-龥]{2,10}?)學程/.exec(t);
    const program = (m?.[1] ?? "").replace(/加修|申請/g, "");
    return {
      kind: program ? "scenario" : "clarify",
      scenario: program ? { ...empty, type: "add-cert-program", program } : null,
      question: program ? null : MISSING_PARAM["add-cert-program"]!,
      message: null,
    };
  }
  if (/停修|退選|撤選/.test(t)) {
    const code = findCourseCode(t);
    const name = /(?:停修|退選|撤選)([一-龥（）()一二三四五六]{2,15})/.exec(t)?.[1];
    const key = code ?? name ?? "";
    return {
      kind: key ? "scenario" : "clarify",
      scenario: key ? { ...empty, type: "withdraw-course", code: key } : null,
      question: key ? null : MISSING_PARAM["withdraw-course"]!,
      message: null,
    };
  }
  if (/成績門檻|甄試|書審|排名|平均/.test(t)) {
    return {
      kind: "scenario",
      scenario: { ...empty, type: "grade-threshold", target: raw },
      question: null,
      message: null,
    };
  }
  return {
    kind: "out-of-scope",
    scenario: null,
    question: null,
    message:
      "此類問題不在本系統可推算的範圍內，請洽系辦公室或教務處註冊組。本系統僅就修業規劃之可行性作推算。",
  };
}
