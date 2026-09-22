import type { StudentRecord } from "@/lib/types";
import type { Capabilities, CourseRecordProvider } from "./types";

/**
 * 瀏覽器 session 讀取（SPEC.md §4，實作順序第三）。
 *
 * 設計約束先寫在這裡，避免日後有人「順便」把憑證送到伺服器：
 *   1. 憑證不離開使用者瀏覽器；本類別只接受已在前端解析完成的 StudentRecord
 *   2. 伺服器端不得持有 cookie、session id 或任何可代為登入的材料
 *   3. 系統架構上沒有寫回校務系統的 endpoint
 *
 * 目前未啟用：呼叫 fetch() 會明確拋錯，而不是回傳半套資料。
 */
export class SessionProvider implements CourseRecordProvider {
  readonly kind = "session" as const;

  async fetch(): Promise<StudentRecord> {
    throw new Error(
      "session provider 尚未啟用。本版本僅支援 mock 與 upload；session 模式需在瀏覽器端完成解析後才可送入。",
    );
  }

  capabilities(): Capabilities {
    return {
      hasWaivers: false,
      hasEnrollment: false,
      hasCertPrograms: false,
      hasGraduationEvidence: false,
    };
  }
}
