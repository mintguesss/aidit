/**
 * 試用用到的案例是多人共用同一位學生。
 *
 * 系統沒有登入，自行勾選、偏好、執行紀錄的刪除都以學生為鍵，存在伺服器上：
 * 一位受試者勾了「我已通過」，下一位看到的待確認事項就少一項，手算與任務的比較也跟著失準。
 * 這些案例一律不寫伺服器，偏好只留在受試者自己的瀏覽器。
 */
const SHARED_CASES = new Set(["fju-im-111-b-year2", "fju-im-111-year2", "tour"]);

/** 接受網址用的別名（school-a-…）或內部代號 */
export const isSharedCase = (fixture: string | undefined) => SHARED_CASES.has((fixture ?? "").replace(/^school-a-/, "fju-"));
