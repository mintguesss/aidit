import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { appendFileSync } from "node:fs";
import type { LlmUsage } from "@/lib/types";

/**
 * LLM 呼叫邊界（docs/BACKEND.md §7）。
 *
 * 只有三處允許呼叫 LLM：規則抽取（離線）、rule.reconcile、情境試算意圖解析。
 * credit.audit / schedule.solve / citation.verify 不得 import 本檔 —— CI 會掃描。
 *
 * 規格偏差（詳見 docs/SPEC-CHANGES.md）：
 *   - docs/BACKEND.md 要求 temperature: 0，但現行 Claude 模型（Opus 5 等）已移除取樣參數，
 *     送出 temperature 會得到 400。改以 structured output + schema 驗證 + 上限重試
 *     達成「輸出形狀確定」，並以 output_config.effort 控制推理深度。
 *   - response_format 改為 output_config.format（messages.parse）。
 */

/**
 * 模型與供應商。
 *
 * 兩條路：Anthropic 官方 API，或任何 OpenAI 相容端點（vLLM、Groq、
 * OpenRouter 都是這個形狀）。預設維持 Anthropic，不設任何東西時行為完全不變。
 *
 * 為什麼要能換：離線替身永遠回傳完美形狀，所以它從來沒有測到
 * 「模型亂回 → schema 驗證失敗 → 重試 → 降級成待確認」這條路徑，
 * 而那是「零錯答」主張的最後一道防線。接一個本機模型上去跑，才驗得到它。
 *
 * 換了模型就要重跑整份評測：不同模型的數字不能放在同一張比較表上，
 * 所以 MODEL_LABEL 會印進評測報告。
 */
// 模型代號要用 Anthropic 現行的正式代號（2026-10 更新；舊的 claude-opus-5 不是正式代號，呼叫會失敗）。
// 價格只用來算 trace 的成本欄位：實測前到 Anthropic Console 確認，與官方價目不符就改這裡
const ANTHROPIC_MODELS = {
  "claude-opus-5-5": { inputPerMTok: 4.0, outputPerMTok: 20.0, supportsEffort: true },
  "claude-sonnet-5-5": { inputPerMTok: 2.0, outputPerMTok: 10.0, supportsEffort: true },
  // 2026-10-07 發布。價格分級，這裡用提示 10 萬 token 以下那一級（每輪的提示遠小於此）
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, supportsEffort: true },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0, supportsEffort: false },
} as const;

export type Provider = "anthropic" | "openai-compatible";

type LlmConfig = {
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey: string;
  pricing: { inputPerMTok: number; outputPerMTok: number };
  supportsEffort: boolean;
};

function resolveConfig(): LlmConfig {
  const provider = (process.env.AIDIT_LLM_PROVIDER || "anthropic") as Provider;
  const want = process.env.AIDIT_LLM_MODEL?.trim();

  if (provider === "openai-compatible") {
    const baseUrl = process.env.AIDIT_LLM_BASE_URL?.trim().replace(/\/$/, "") ?? "";
    if (!baseUrl) {
      throw new Error("AIDIT_LLM_PROVIDER=openai-compatible 需要同時設定 AIDIT_LLM_BASE_URL。");
    }
    if (!want) {
      throw new Error("AIDIT_LLM_PROVIDER=openai-compatible 需要同時設定 AIDIT_LLM_MODEL（端點上的模型名稱）。");
    }
    return {
      provider,
      model: want,
      baseUrl,
      apiKey: process.env.AIDIT_LLM_API_KEY?.trim() ?? "",
      // 本機模型沒有每 token 成本。留 0 而不是沿用 Anthropic 費率 ——
      // 報表寧可顯示 0，也不要顯示一個憑空算出來的金額。
      pricing: { inputPerMTok: 0, outputPerMTok: 0 },
      supportsEffort: false,
    };
  }

  if (provider !== "anthropic") {
    throw new Error(`AIDIT_LLM_PROVIDER="${provider}" 不支援。可選：anthropic、openai-compatible`);
  }
  if (want && !(want in ANTHROPIC_MODELS)) {
    // 打錯字就靜靜退回預設是最糟的：帳單和評測數據會對不上你以為在跑的模型
    throw new Error(
      `AIDIT_LLM_MODEL="${want}" 不是支援的 Anthropic 模型。可選：${Object.keys(ANTHROPIC_MODELS).join("、")}`,
    );
  }
  // 用 || 而不是 ??：.env 裡留空會得到空字串，而空字串不是 nullish
  // 預設 Sonnet：模型只做意圖解析與公告適用判斷（短輸入、短輸出、照 schema 回答），不需要最強的推理
  const model = (want || "claude-haiku-5-5") as keyof typeof ANTHROPIC_MODELS;
  const spec = ANTHROPIC_MODELS[model];
  return {
    provider,
    model,
    baseUrl: "",
    apiKey: "",
    pricing: { inputPerMTok: spec.inputPerMTok, outputPerMTok: spec.outputPerMTok },
    supportsEffort: spec.supportsEffort,
  };
}

export const LLM: LlmConfig = resolveConfig();
export const MODEL = LLM.model;

/** 定價（USD / 1M tokens），用於 trace 的成本欄位。隨模型變動。 */
export const PRICING = LLM.pricing;

/** 印進評測報告，避免不同模型的數字被混在同一張表上。 */
export const MODEL_LABEL = `${LLM.provider}:${LLM.model}`;

export const LLM_CALL_LIMIT = 3;

/**
 * 單次呼叫逾時。
 *
 * 8 秒是照 docs/BACKEND.md §8 的 P95 目標訂的，對託管 API 合理；本機模型的
 * 首 token 延遲高得多，所以 openai-compatible 預設放寬到 30 秒。
 */
export const LLM_TIMEOUT_MS = (() => {
  const raw = process.env.AIDIT_LLM_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`AIDIT_LLM_TIMEOUT_MS="${raw}" 不是正數。`);
    }
    return n;
  }
  return LLM.provider === "openai-compatible" ? 30_000 : 8_000;
})();

/**
 * openai-compatible 端點的推理強度（reasoning_effort），未設定就不送這個欄位。
 *
 * 為什麼需要：思考型模型預設會先想一大段再輸出。實測 自架小模型 在
 * 家用主機上一次意圖解析要 14 秒、先想 466 字，常常超過 30 秒逾時；
 * 送 reasoning_effort=none 之後同一題 1.2 秒、思考 0 字，輸出相同。
 * 意圖解析只是分類加抽參數，用不到長鏈推理。
 *
 * 為什麼要設定才送：這是廠商相關的欄位。部分端點認 none，別的端點可能只認
 * low/medium/high 或直接拒絕，所以不能預設帶上。
 */
export const LLM_REASONING_EFFORT = (() => {
  const raw = process.env.AIDIT_LLM_REASONING_EFFORT?.trim();
  if (!raw) return undefined;
  // 值打錯是錯誤，要大聲失敗
  if (!["none", "low", "medium", "high"].includes(raw)) {
    throw new Error(`AIDIT_LLM_REASONING_EFFORT="${raw}" 不支援。可選：none、low、medium、high`);
  }
  // 但換回 anthropic 時這一行不適用，不是錯誤：家用主機改接官方 API 時
  // .env 裡很可能還留著它，為此讓整個 app 起不來不合理。
  // Anthropic 的推理強度走 output_config.effort，由 StructuredRequest.effort 控制。
  // 是否生效由 /api/health 的 llm.reasoningEffort 回報。
  return LLM.provider === "openai-compatible" ? raw : undefined;
})();
/**
 * 結構化輸出很小；刻意壓低上限以控成本，超過即視為輸出異常。
 * 5.5 系列預設會先思考，思考的 token 也算在這個上限裡，1024 可能在答案出來前就用完
 */
export const LLM_MAX_TOKENS = 2048;

export class LlmBudgetExceeded extends Error {
  constructor(readonly limit: number) {
    super(`本次審查的 LLM 呼叫已達上限 ${limit} 次，依 docs/BACKEND.md §7 中止。`);
    this.name = "LlmBudgetExceeded";
  }
}

export type LlmMode = "api" | "offline";

export type LlmCallResult<T> = {
  data: T;
  mode: LlmMode;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  retries: number;
};

/**
 * 每次審查一個 budget 實例。呼叫數、token 數與成本都記進 trace。
 */
export class LlmBudget {
  private used = 0;
  readonly usage: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  constructor(private readonly limit = LLM_CALL_LIMIT) {}

  get remaining(): number {
    return this.limit - this.used;
  }

  consume(r: { inputTokens: number; outputTokens: number; costUsd: number }): void {
    this.used += 1;
    this.usage.calls += 1;
    this.usage.inputTokens += r.inputTokens;
    this.usage.outputTokens += r.outputTokens;
    this.usage.costUsd = round6(this.usage.costUsd + r.costUsd);
  }

  assertAvailable(): void {
    if (this.used >= this.limit) throw new LlmBudgetExceeded(this.limit);
  }
}

let client: Anthropic | null = null;

export function llmAvailable(): boolean {
  return LLM.provider === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(LLM.baseUrl);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: LLM_TIMEOUT_MS, maxRetries: 0 });
  return client;
}

export type StructuredRequest<S extends z.ZodType> = {
  system: string;
  user: string;
  schema: S;
  /** 沒有金鑰時使用的確定性替身；必須能產出同形狀的結果 */
  offline: () => z.infer<S>;
  effort?: "low" | "medium" | "high";
  /** 預設 LLM_MAX_TOKENS。只有評測的對照組（整份規章塞進去算）需要更大 */
  maxTokens?: number;
  /** 預設 LLM_TIMEOUT_MS。同上，對照組一次讀幾萬字，8 秒不夠 */
  timeoutMs?: number;
};

/** refusal：模型拒絕回應的類別。拒絕也有計費，所以照樣帶 usage 回去，由外層記帳後再當成失敗 */
type ProviderResult = { output: unknown; inputTokens: number; outputTokens: number; requestId?: string | null; refusal?: string };

async function callAnthropic<S extends z.ZodType>(req: StructuredRequest<S>): Promise<ProviderResult> {
  // 不用 messages.parse／parseMessage：
  // 1. 它執行期回的是一般 Promise，拿不到 request-id（型別寫的是 APIPromise，但 .withResponse() 不存在）；
  // 2. 它在 SDK 裡就用 zod 驗證，不合格直接拋錯 —— 這時回應已經回來、已經計費，外層卻拿不到 usage，
  //    成本與每輪呼叫上限都少算一次（2026-10-12 評測發現）。
  // 這裡只把文字解析成 JSON，驗證交給 structured()：先記帳、再驗證，不合格照樣重試。
  const params = {
    model: MODEL,
    max_tokens: req.maxTokens ?? LLM_MAX_TOKENS,
    system: req.system,
    output_config: {
      // Haiku 4.5 不支援 effort，送出會 400，所以依模型決定要不要帶
      ...(LLM.supportsEffort ? { effort: req.effort ?? "low" } : {}),
      format: zodOutputFormat(req.schema),
    },
    messages: [{ role: "user" as const, content: req.user }],
  };
  const { data: res, request_id } = await getClient()
    .messages.create(params, req.timeoutMs ? { timeout: req.timeoutMs } : undefined)
    .withResponse();

  const text = res.content.find((b) => b.type === "text");
  let output: unknown = null;
  try {
    output = text && text.type === "text" ? JSON.parse(text.text) : null;
  } catch {
    // 不是合法 JSON：回 null，外層記帳後當成一次失敗
  }
  return {
    output,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    requestId: request_id,
    refusal: res.stop_reason === "refusal" ? (res.stop_details?.category ?? "unknown") : undefined,
  };
}

/**
 * OpenAI 相容端點（vLLM、Groq、OpenRouter…）。
 *
 * 用 fetch 而不是裝 openai 套件：這裡只需要 chat/completions 一條路徑，
 * 多一個相依就多一組要跟的版本。
 */
async function callOpenAiCompatible<S extends z.ZodType>(
  req: StructuredRequest<S>,
): Promise<ProviderResult> {
  // 部分伺服器會拒絕帶 $schema 的 payload
  const { $schema: _drop, ...schema } = z.toJSONSchema(req.schema) as Record<string, unknown>;

  const res = await fetch(`${LLM.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // 本機端點不檢查，但 Groq／OpenRouter 要
      ...(LLM.apiKey ? { authorization: `Bearer ${LLM.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: LLM.model,
      max_tokens: req.maxTokens ?? LLM_MAX_TOKENS,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "output", strict: true, schema },
      },
      ...(LLM_REASONING_EFFORT ? { reasoning_effort: LLM_REASONING_EFFORT } : {}),
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`${LLM.baseUrl} 回應 ${res.status}：${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("回應中沒有 message.content");

  return {
    // 內容是 JSON 字串；解析失敗交給外層當成一次失敗處理（會重試一次）
    output: JSON.parse(content) as unknown,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

function callProvider<S extends z.ZodType>(req: StructuredRequest<S>): Promise<ProviderResult> {
  return LLM.provider === "anthropic" ? callAnthropic(req) : callOpenAiCompatible(req);
}

/**
 * 設了 AIDIT_LLM_CALL_LOG（檔案路徑）就把每一次真的打出去的呼叫記一行 JSON：時間、模型、
 * 供應商的 request-id、token 與成本。評測時用來對帳（可以拿 request-id 去供應商後台查），平常不開。
 */
function logCall(r: { requestId?: string | null; inputTokens: number; outputTokens: number; costUsd: number; ms: number; attempt: number; error?: string }): void {
  const path = process.env.AIDIT_LLM_CALL_LOG;
  if (!path) return;
  try {
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), model: MODEL_LABEL, ...r }) + String.fromCharCode(10));
  } catch {
    // 記錄失敗不影響呼叫本身
  }
}

/**
 * 結構化輸出呼叫。
 *
 * 輸出必須通過 schema 驗證，驗證失敗 → 重試一次 → 仍失敗則由呼叫端降級
 * （轉 HoldItem 或請使用者澄清），絕不把未驗證的內容當成判定依據。
 */
export async function structured<S extends z.ZodType>(
  req: StructuredRequest<S>,
  budget: LlmBudget,
): Promise<LlmCallResult<z.infer<S>>> {
  const started = Date.now();

  if (!llmAvailable()) {
    // 離線替身不消耗 LLM 預算，也不列入成本 —— 評測報告不得把替身當成模型表現
    return {
      data: req.offline(),
      mode: "offline",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      ms: Date.now() - started,
      retries: 0,
    };
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= 1; attempt++) {
    budget.assertAvailable();
    const attemptStarted = Date.now();
    let answered = false;
    try {
      const res = await callProvider(req);
      answered = true;

      const { inputTokens, outputTokens } = res;
      const costUsd = round6(
        (inputTokens / 1_000_000) * PRICING.inputPerMTok +
          (outputTokens / 1_000_000) * PRICING.outputPerMTok,
      );
      budget.consume({ inputTokens, outputTokens, costUsd });
      logCall({ requestId: res.requestId, inputTokens, outputTokens, costUsd, ms: Date.now() - attemptStarted, attempt });

      if (res.refusal) throw new Error(`模型拒絕回應：${res.refusal}`);
      if (res.output === null || res.output === undefined) {
        throw new Error("結構化輸出解析失敗");
      }
      const parsed = req.schema.safeParse(res.output);
      if (!parsed.success) throw new Error(`輸出未通過 schema 驗證：${parsed.error.message}`);

      return {
        data: parsed.data,
        mode: "api",
        inputTokens,
        outputTokens,
        costUsd,
        ms: Date.now() - started,
        retries: attempt,
      };
    } catch (err) {
      if (err instanceof LlmBudgetExceeded) throw err;
      lastError = err;
      // 沒拿到回應的那一次（逾時、連不上）也記一筆，重試才數得出來；有回應但內容不合格的已經記過了
      if (!answered) {
        logCall({ requestId: null, inputTokens: 0, outputTokens: 0, costUsd: 0, ms: Date.now() - attemptStarted, attempt, error: String(err).slice(0, 200) });
      }
    }
  }
  throw new Error(`LLM 呼叫兩次皆失敗：${String(lastError)}`);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
