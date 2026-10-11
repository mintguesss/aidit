import type { GraduationCheck } from "@/lib/types";
import { SourceLinks } from "../sources/SourceLinks";
import { DeclareToggle } from "./DeclareToggle";

/**
 * 畢業條件檢核。
 *
 * 四條各自掛一個「依據」會讓這一區變成四個小連結；
 * 原文本來就集中在「原文出處」頁，所以整區只放一個連結指過去。
 */
export function GraduationCheckDetails({
  checks,
  fixture,
  term,
}: {
  checks: GraduationCheck[];
  fixture: string;
  term: string;
}) {
  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>畢業條件</h2>
        <SourceLinks citations={checks.flatMap((g) => g.citations)} label="依據" folded />
        {checks.some((g) => g.status === "hold") ? (
          <span className="hint gcheck-hint">待確認＝修課紀錄看不出是否通過，通過了可以自己勾</span>
        ) : null}
      </div>
      {/* 四條各佔一整列太浪費 —— 每條實際只有「名稱、狀態、一句說明」 */}
      <ul className="gcheck">
        {checks.map((g) => (
          <li key={g.id}>
            <span
              className={`dot ${g.status === "satisfied" ? "ok" : g.status === "unmet" ? "unmet" : "hold"}`}
            />
            <b>{g.name}</b>
            <span className={`vl ${g.status}`}>{g.label}</span>
            {/* 說明只留要處理的（未通過）。七條每條一句字太多：通過的不用解釋，
                待確認的都是同一句「修課紀錄看不出來」，已移到標題列講一次 */}
            {g.detail && g.status === "unmet" ? <span className="d">{g.detail}</span> : null}
            {/* 學校資料看不出來的條件，學生可以自己勾；勾了顯示「自行勾選」，系統不查核 */}
            {g.declarable ? <DeclareToggle checkId={g.id} checked={Boolean(g.selfDeclared)} fixture={fixture} term={term} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
