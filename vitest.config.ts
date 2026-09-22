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
      AIDIT_LLM_PROVIDER: "",
    },
  },
});
