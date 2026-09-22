/**
 * trace 寫入前的個資清洗（BACKEND.md §6）。
 *
 * 保留：課程名稱、成績、類別判定 —— 那是判定依據，且無法單獨識別個人。
 * 移除：姓名、學號、Email、電話。
 */

const RULES: { name: string; re: RegExp; replace: string }[] = [
  { name: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replace: "[email]" },
  // 台灣學號常見樣式：年度碼 + 系所碼 + 流水號，7–12 碼
  { name: "student-id", re: /\b\d{7,12}\b/g, replace: "[sid]" },
  { name: "phone", re: /\b09\d{2}-?\d{3}-?\d{3}\b/g, replace: "[phone]" },
  { name: "roc-id", re: /\b[A-Z][12]\d{8}\b/g, replace: "[nid]" },
];

/** 需整個移除的欄位名（含巢狀） */
const DROP_KEYS = new Set(["displayName", "name_zh", "realName", "studentId", "sid", "email", "phone"]);

export function scrubString(s: string): string {
  let out = s;
  for (const r of RULES) out = out.replace(r.re, r.replace);
  return out;
}

export function scrub<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = walk(v);
    }
    return out;
  }
  return value;
}

/** CI 用：檢查文字中是否殘留可識別資訊 */
export function findPii(s: string): { rule: string; sample: string }[] {
  const hits: { rule: string; sample: string }[] = [];
  for (const r of RULES) {
    const m = s.match(new RegExp(r.re.source, r.re.flags));
    if (m) hits.push({ rule: r.name, sample: m[0]! });
  }
  return hits;
}
