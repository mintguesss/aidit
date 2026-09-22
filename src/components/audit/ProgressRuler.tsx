import Link from "next/link";
import type { CategoryResult } from "@/lib/types";

/**
 * 修業進度。
 *
 * 一條橫條，依類別切段，每段寬度等於該類別的應修學分 —— 長度本身就是資訊。
 *
 * 兩個維度分開處理：
 *   **顏色 = 哪一個類別**（每段一個色）
 *   **質地 = 修課狀態**（實心＝已修得、斜線＝修課中、淺底＝未修）
 *
 * 名稱與數值排在各自那一段的正上方與正下方（三列共用同一組彈性比例，
 * 所以永遠對得齊）。放在旁邊的對照表雖然塞得下更多字，
 * 但讀的人得先找「這個顏色是哪一段」—— 字跟著段落走就不必找。
 *
 * 超修不畫進條內：學則明定不得流用，視覺上不能給出相反的暗示。
 */
export function ProgressRuler({
  categories,
  minCredits,
  overflow,
  auditHref,
}: {
  categories: CategoryResult[];
  minCredits: number;
  overflow: number;
  /** 點類別名稱直接跳到修業明細的對應列並展開 */
  auditHref?: string;
}) {
  const earned = categories.reduce((a, c) => a + c.earned, 0);
  const inProgress = categories.reduce((a, c) => a + c.inProgress, 0);
  const flexOf = (c: CategoryResult) => ({ flex: `${c.required} 0 0` });

  return (
    <div className="pg">
      <div className="pg-hd">
        <h3>修業進度</h3>
        <div className="pg-key">
          <span>
            <i className="sw st-done" />
            已修得
          </span>
          <span>
            <i className="sw st-now" />
            修課中
          </span>
          <span>
            <i className="sw st-unmet" />
            未修
          </span>
        </div>
        <div className="pg-sum">
          <b>{earned + inProgress}</b>
          <em>/{minCredits}</em>
        </div>
      </div>

      <div className="pg-rows">
        <div className="pg-row pg-names">
          {categories.map((c, i) => (
            <div key={c.id} data-c={(i % 6) + 1} style={flexOf(c)}>
              {auditHref ? (
                <Link className="nm" href={`${auditHref}#row-${c.id}`}>
                  {c.shortName}
                </Link>
              ) : (
                <span className="nm">{c.shortName}</span>
              )}
            </div>
          ))}
          {overflow > 0 ? (
            <div className="pg-ovcell">
              <span className="nm">超修</span>
            </div>
          ) : null}
        </div>

        <div className="pg-row pg-bar">
          {categories.map((c, i) => (
            <div
              key={c.id}
              className="pg-seg"
              data-c={(i % 6) + 1}
              style={flexOf(c)}
              title={`${c.name}　已修得 ${c.earned}・修課中 ${c.inProgress}・未修 ${c.unmet}（應修 ${c.required}）`}
            >
              {c.earned > 0 ? <i className="st-done" style={{ flex: `${c.earned} 0 0` }} /> : null}
              {c.inProgress > 0 ? <i className="st-now" style={{ flex: `${c.inProgress} 0 0` }} /> : null}
              {c.unmet > 0 ? <i className="st-unmet" style={{ flex: `${c.unmet} 0 0` }} /> : null}
            </div>
          ))}
          {overflow > 0 ? (
            <div className="pg-ovcell pg-ovbar" title={`超修 ${overflow} 學分，計入總學分但不得流用`} />
          ) : null}
        </div>

        <div className="pg-row pg-vals">
          {categories.map((c, i) => (
            <div key={c.id} data-c={(i % 6) + 1} style={flexOf(c)}>
              <span className="vl">
                <b className={c.unmet > 0 ? "bad" : undefined}>{c.earned + c.inProgress}</b>
                <em>/{c.required}</em>
              </span>
              {c.unmet > 0 ? <span className="short">缺 {c.unmet}</span> : null}
            </div>
          ))}
          {overflow > 0 ? (
            <div className="pg-ovcell">
              <span className="vl">＋{overflow}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* 窄螢幕：段落太窄，字放不進去也切不乾淨，改成條子下方的清單 */}
      <ul className="pg-list">
        {categories.map((c, i) => (
          <li key={c.id} data-c={(i % 6) + 1}>
            <span className="ix" />
            <span className="nm">{c.shortName}</span>
            <span className="vl">
              <b className={c.unmet > 0 ? "bad" : undefined}>{c.earned + c.inProgress}</b>
              <em>/{c.required}</em>
            </span>
            <span className="st">
              {c.unmet > 0 ? (
                <span className="bad">未修 {c.unmet}</span>
              ) : c.inProgress > 0 ? (
                <span className="now">修課中可完成</span>
              ) : (
                <span className="ok">已完成</span>
              )}
            </span>
          </li>
        ))}
        {overflow > 0 ? (
          <li className="ov">
            <span className="ix" />
            <span className="nm">超修</span>
            <span className="vl">＋{overflow}</span>
            <span className="st">
              <span className="now">不流用</span>
            </span>
          </li>
        ) : null}
      </ul>

      <p className="pg-foot">
        每一段的寬度等於該類別的應修學分，合計 {minCredits} 學分。
        {overflow > 0
          ? `自由選修超修的 ${overflow} 學分計入修得總學分，但依學則不得流用至其他類別，因此畫在框外。`
          : "目前無超修學分。"}
      </p>
    </div>
  );
}
