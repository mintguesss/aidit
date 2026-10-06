/**
 * 校對密碼（TODO E2）：輸入一次，同一個分頁內的寫入都帶上。
 * 只存在 sessionStorage，關掉分頁就沒了；拿不到儲存空間時每次重新輸入。
 */

const KEY = "aidit:review-password";

export function getReviewPassword(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setReviewPassword(v: string) {
  try {
    if (v) sessionStorage.setItem(KEY, v);
    else sessionStorage.removeItem(KEY);
  } catch {
    // 無痕或封鎖儲存：不記，照常用
  }
}

export const reviewHeaders = (password: string) => ({
  "content-type": "application/json",
  ...(password ? { "x-review-password": password } : {}),
});
