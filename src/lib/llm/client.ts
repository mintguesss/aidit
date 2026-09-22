import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
import type { LlmUsage } from "@/lib/types";

/**
 * LLM 呼叫邊界（BACKEND.md §7）。
 *
 * 只有三處允許呼叫 LLM：規則抽取（離線）、rule.reconcile、情境試算意圖解析。
 * credit.audit / schedule.solve / citation.verify 不得 import 本檔 —— CI 會掃描。
 *
 * 規格偏差（詳見 SPEC-CHANGES.md）：
 *   - BACKEND.md 要求 temperature: 0，但現行 Claude 模型（Opus 5 等）已移除取樣參數，
 *     送出 temperature 會得到 400。改以 structured output + schema 驗證 + 上限重試
 *     達成「輸出形狀確定」，並以 output_config.effort 控制推理深度。
 *   - response_format 改為 output_config.format（messages.parse）。
 */

/**
 * 可選模型。
 *
 * 開發期間用便宜的模型跑，最後要出驗證數據時再換回 Opus 5 —— 但**換模型就要
 * 重跑整份評測**，不同模型的數字不能混在同一張表上比較。
 *
 * 定價（USD / 1M tokens）必須跟著模型走：trace 的成本欄位與評測報告都讀這裡，
 * 寫死一組價格再換模型，報表會理直氣壯地給出錯的數字。
 *
 * supportsEffort：Haiku 4.5 不支援 output_config.effort，送出會得到 400。
 */
const MODELS = {
  "claude-opus-5": { inputPerMTok: 5.0, outputPerMTok: 25.0, supportsEffort: true },
  "claude-sonnet-5": { inputPerMTok: 2.0, outputPerMTok: 10.0, supportsEffort: true },
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0, supportsEffort: false },
} as const;

export type ModelId = keyof typeof MODELS;

function resolveModel(): ModelId {
  const want = process.env.AIDIT_LLM_MODEL;
  if (want && want in MODELS) return want as ModelId;
  if (want) {
    // 打錯字就靜靜退回預設是最糟的：帳單和評測數據會對不上你以為在跑的模型
    throw new Error(
      `AIDIT_LLM_MODEL="${want}" 不是支援的模型。可選：${Object.keys(MODELS).join("、")}`,
    );
  }
  return "claude-opus-5";
}

export const MODEL: ModelId = resolveModel();

/** 定價（USD / 1M tokens），用於 trace 的成本欄位。隨 MODEL 變動。 */
export const PRICING = MODELS[MODEL];

export const LLM_CALL_LIMIT = 3;
export const LLM_TIMEOUT_MS = 8000;
/** 結構化輸出很小；刻意壓低上限以控成本，超過即視為輸出異常 */
export const LLM_MAX_TOKENS = 1024;

export class LlmBudgetExceeded extends Error {
  constructor(readonly limit: number) {
    super(`本次審查的 LLM 呼叫已達上限 ${limit} 次，依 BACKEND.md §7 中止。`);
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
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
};

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
    try {
      const res = await getClient().messages.parse({
        model: MODEL,
        max_tokens: LLM_MAX_TOKENS,
        system: req.system,
        output_config: {
          // Haiku 4.5 不支援 effort，送出會 400，所以依模型決定要不要帶
          ...(PRICING.supportsEffort ? { effort: req.effort ?? "low" } : {}),
          format: zodOutputFormat(req.schema),
        },
        messages: [{ role: "user", content: req.user }],
      });

      const inputTokens = res.usage.input_tokens;
      const outputTokens = res.usage.output_tokens;
      const costUsd = round6(
        (inputTokens / 1_000_000) * PRICING.inputPerMTok +
          (outputTokens / 1_000_000) * PRICING.outputPerMTok,
      );
      budget.consume({ inputTokens, outputTokens, costUsd });

      if (res.stop_reason === "refusal") {
        throw new Error(`模型拒絕回應：${res.stop_details?.category ?? "unknown"}`);
      }
      if (res.parsed_output === null || res.parsed_output === undefined) {
        throw new Error("結構化輸出解析失敗");
      }
      const parsed = req.schema.safeParse(res.parsed_output);
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
    }
  }
  throw new Error(`LLM 呼叫兩次皆失敗：${String(lastError)}`);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
