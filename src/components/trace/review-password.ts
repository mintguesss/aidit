/**
 * 校對人與校對密碼（TODO E2）：輸入一次，這個瀏覽器之後都記得。
 * 存在 localStorage，只在校對的人自己的瀏覽器；拿不到儲存空間時每次重新輸入。
 */

const KEY = { password: "aidit:review-password", reviewer: "aidit:reviewer" } as const;

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function save(key: string, v: string) {
  try {
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch {
    // 無痕或封鎖儲存：不記，照常用
  }
}

export const getReviewPassword = () => load(KEY.password);
export const setReviewPassword = (v: string) => save(KEY.password, v);
export const getReviewer = () => load(KEY.reviewer);
export const setStoredReviewer = (v: string) => save(KEY.reviewer, v);

export const reviewHeaders = (password: string) => ({
  "content-type": "application/json",
  ...(password ? { "x-review-password": password } : {}),
});
