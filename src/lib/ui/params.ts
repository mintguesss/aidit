import { FIXTURES, type FixtureId } from "@/lib/providers/fixtures";

/** 各功能頁共用的查詢參數解析。無效值一律回退到預設，不丟錯誤頁。 */
export type PageParams = { fixture: FixtureId; term: string };

const TERM_RE = /^\d{3}-[12]$/;

export function parsePageParams(sp: { fixture?: string; term?: string }): PageParams {
  const f = FIXTURES.find((x) => x.id === sp.fixture);
  const fixture = (f?.id ?? "demo") as FixtureId;
  // 沒指定學期就用案例自己的「目前學期」（大二結束的案例是 112-2）
  const term = sp.term && TERM_RE.test(sp.term) ? sp.term : (f?.term ?? "114-2");
  return { fixture, term };
}
