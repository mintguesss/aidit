import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
    // 校對紀錄、排課這類測試要連續寫檔或跑完整求解，整批平行跑時偶爾超過預設的 5 秒。
    // 單獨跑都在 1 秒左右；放寬只是避免機器忙時誤報，真的卡住照樣會失敗
    testTimeout: 20_000,
    /**
     * 測試一律走離線替身，不連任何外部服務。
     *
     * 這不只是為了快：golden set 是 CI 的回歸基準，只要它可能受外部狀態影響，
     * 「正確率不得下降」這道門檻就不再是機械保證。而且 store 是以環境變數
     * 決定後端的 —— 開發者 shell 裡剛好設了 SUPABASE_*，單元測試就會直接
     * 寫進正式資料庫。清空比相信每個人都不會設要可靠。
     */
    env: {
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      ANTHROPIC_API_KEY: "",
      // AIDIT_LLM_* 要整組清掉，不能只清 provider：resolveConfig 會把
      // 沒設 provider 當成 anthropic，再拿殘留的 AIDIT_LLM_MODEL 去比對
      // Anthropic 的型號表，於是家用主機照 docs/SELFHOST.md 設好
      // qwen3:14b 之後，npm run ci 會在載入模組時就整組拋錯。
      AIDIT_LLM_PROVIDER: "",
      AIDIT_LLM_MODEL: "",
      AIDIT_LLM_BASE_URL: "",
      AIDIT_LLM_API_KEY: "",
      AIDIT_LLM_REASONING_EFFORT: "",
    },
  },
});
