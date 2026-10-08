/**
 * 沒有明確加 --live 就不呼叫模型。
 *
 * 必須是 run.ts 的第一個 import：模型設定在 client.ts 載入時就決定，.env 也是在那之前讀。
 * 這裡設成空字串，.env 載入器以「已存在的環境變數優先」，就不會被蓋回去
 * （與 scripts/ci.ts 同一個做法）。Supabase 不清：規則包與原文語料要從那裡讀。
 */
export const LIVE = process.argv.includes("--live");

if (!LIVE) {
  for (const k of [
    "ANTHROPIC_API_KEY",
    "AIDIT_LLM_PROVIDER",
    "AIDIT_LLM_MODEL",
    "AIDIT_LLM_BASE_URL",
    "AIDIT_LLM_API_KEY",
    "AIDIT_LLM_REASONING_EFFORT",
  ]) {
    process.env[k] = "";
  }
}
