import { FIXTURES, type FixtureId } from "@/lib/providers/fixtures";
import { supabaseConfigured } from "@/lib/store/supabase";

/**
 * 沒指定案例時看哪一個：以真實資料（輔大）為主。
 * 輔大的規則包只在 Supabase 上，沒設定的環境（CI、離線開發）找不到，退回合成資料 ——
 * 不然打開首頁就是「尚未支援」。合成案例仍可用網址參數打開（?fixture=demo），只是不列在選單裡
 */
export function defaultFixture(): FixtureId {
  return supabaseConfigured() ? "fju-im-111-year2" : "demo";
}

/** 各功能頁共用的查詢參數解析。無效值一律回退到預設，不丟錯誤頁。 */
export type PageParams = { fixture: FixtureId; term: string };

const TERM_RE = /^\d{3}-[12]$/;

export function parsePageParams(sp: { fixture?: string; term?: string }): PageParams {
  const f = FIXTURES.find((x) => x.id === sp.fixture);
  const fixture = (f?.id ?? defaultFixture()) as FixtureId;
  const g = FIXTURES.find((x) => x.id === fixture);
  // 沒指定學期就用案例自己的「目前學期」（大二結束的案例是 112-2）
  const term = sp.term && TERM_RE.test(sp.term) ? sp.term : (g?.term ?? "114-2");
  return { fixture, term };
}
