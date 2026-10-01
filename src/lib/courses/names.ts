/**
 * 課名比對：規則包只有課名、沒有課號時用（輔大的國文、外國語文）。
 *
 * 不做模糊比對。課名猜錯就會把學分算進錯的類別，寧可比不到（落到待確認或未修）也不要猜。
 * 只允許兩種寫法：
 *   完全相同 —— 去掉空白後一字不差（「國文」）
 *   開頭相同 —— 成績單把級別或語種寫在括號裡（「外國語文(中級英文)」「外國語文(基礎日文)」），
 *               規劃表只寫「外國語文」。開頭由規則包明列，人工校對過，不是系統自己推的
 */

/** 去掉所有空白（含全形），「Web 程式設計」與「Web程式設計」視為同一門 */
export const normalizeName = (s: string) => s.replace(/\s+/g, "");

export function courseNameMatches(rule: { names: string[]; prefixes?: string[] }, name: string): boolean {
  const n = normalizeName(name);
  return (
    rule.names.some((x) => normalizeName(x) === n) ||
    (rule.prefixes ?? []).some((p) => n.startsWith(normalizeName(p)))
  );
}
