import type { GraduationCheck } from "@/lib/types";
import { SourceLinks } from "../sources/SourceLinks";
import { DeclareToggle } from "./DeclareToggle";

/**
 * 畢業條件檢核。
 *
 * 四條各自掛一個「依據」會讓這一區變成四個小連結；
 * 原文本來就集中在「原文出處」頁，所以整區只放一個連結指過去。
 */
export function GraduationCheckDetails({ checks }: { checks: GraduationCheck[] }) {
  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>畢業條件</h2>
        <SourceLinks citations={checks.flatMap((g) => g.citations)} label="依據" />
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
            {g.detail ? <span className="d">{g.detail}</span> : null}
            {/* 學校資料看不出來的條件，學生可以自己勾；勾了顯示「自行勾選」，系統不查核 */}
            {g.declarable ? <DeclareToggle checkId={g.id} checked={Boolean(g.selfDeclared)} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
