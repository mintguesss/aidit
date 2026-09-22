"use client";

import { useEffect, useState } from "react";
import { SourceLinks } from "../sources/SourceLinks";
import type { AuditResult, CategoryResult, CourseRecord, HoldItem } from "@/lib/types";

/**
 * 分類明細。<720px 時整列轉 grid 區塊（CSS 處理）。
 *
 * 展開的依據獨立成一個跨滿整列的 `<tr>`，而不是塞在最後一欄裡 ——
 * 塞在欄位裡的話，採計科目表只能用畫面右側三分之一的寬度，左邊整片空白。
 */
export function CategoryTable({ audit, courses }: { audit: AuditResult; courses: CourseRecord[] }) {
  return (
    <section className="panel">
      <table className="resp">
        <thead>
          <tr>
            <th style={{ width: "26%" }}>類別</th>
            <th className="num" style={{ width: "8%" }}>應修</th>
            <th className="num" style={{ width: "8%" }}>已修</th>
            <th className="num" style={{ width: "9%" }}>修課中</th>
            <th className="num" style={{ width: "8%" }}>未修</th>
            <th>判定與依據</th>
          </tr>
        </thead>
        <tbody>
          {audit.categories.map((c) => (
            <Row
              key={c.id}
              c={c}
              courses={courses}
              holds={audit.holds.filter((h) => h.affectedCategory === c.id)}
            />
          ))}
        </tbody>
      </table>

      <details className="explain">
        <summary>系統如何判定</summary>
        <div className="bd">
          <b>版本綁定</b>　畢業條件依<b>學籍入學學年</b>（{audit.student.admissionYear}）綁定對應版本的課程規劃表。
          {audit.student.admissionYear === audit.student.actualAdmissionYear
            ? "本筆紀錄之學籍入學學年與實際入學學年一致，版本判定無疑義；"
            : "本筆紀錄兩者不一致，"}
          兩者不同時（轉系、轉學、復學），系統停止判定並轉由人工確認。
          <br />
          <b>學分歸屬</b>　一門課同時符合多個類別時，系統以指派問題求最小未修學分，
          並以固定決勝規則（應修學分較大者優先、課程依學年學期課號升冪）確保同一份資料每次得到相同結果。
          <br />
          <b>超修</b>　超出應修學分的部分計入修得總學分，但依學則不得流用至其他類別，
          也不會折抵任何類別的未修學分。
        </div>
      </details>
    </section>
  );
}

function Row({
  c,
  courses,
  holds,
}: {
  c: CategoryResult;
  courses: CourseRecord[];
  holds: HoldItem[];
}) {
  const tags = buildTags(c, holds);
  const [open, setOpen] = useState(false);

  // 從首頁點某個類別過來時，直接展開那一列並捲到它 ——
  // 不然使用者落在一張表的中間，還要自己找剛剛點的是哪一行
  useEffect(() => {
    if (typeof window === "undefined") return;
    const want = () => window.location.hash === `#row-${c.id}`;
    const apply = () => {
      if (!want()) return;
      setOpen(true);
      requestAnimationFrame(() => {
        document.getElementById(`row-${c.id}`)?.scrollIntoView({ block: "center" });
      });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [c.id]);
  const assigned = c.assignedCodes
    .map((code) => courses.find((x) => (x.equivalentOf ?? x.code) === code || x.code === code))
    .filter((x): x is CourseRecord => Boolean(x))
    // 照修課順序排：學生是按學期修過來的，照課號排等於要他自己在腦中重排一次
    .sort((a, b) => a.year - b.year || termRank(a.term) - termRank(b.term) || a.code.localeCompare(b.code));
  return (
    <>
    <tr id={`row-${c.id}`} className={open ? "row-open" : undefined}>
      <td className="cell-main span">
        <span className="cat">{c.name}</span>
      </td>
      <td className="num" data-lb="應修">{c.required}</td>
      <td className="num" data-lb="已修">{c.earned}</td>
      <td className={`num${c.inProgress === 0 ? " t-mute" : ""}`} data-lb="修課中">
        {c.inProgress === 0 ? "—" : c.inProgress}
      </td>
      <td className={`num${c.unmet > 0 ? " t-unmet" : ""}`} data-lb="未修">{c.unmet}</td>
      <td className="span">
        <div className="tags">
          {tags.map((t) => (
            <span key={t.text} className={`tag ${t.kind}`}>
              {t.text}
            </span>
          ))}
          <button
            className="chev"
            aria-expanded={open}
            aria-controls={`cat-${c.id}`}
            aria-label={`展開${c.name}的採計科目與依據`}
            title="採計科目與依據"
            onClick={() => setOpen((v) => !v)}
          />
        </div>
      </td>
    </tr>
    {open ? (
      <tr className="detail-tr">
        <td colSpan={6} id={`cat-${c.id}`}>
          <div className="srcbox">
            {assigned.length > 0 ? (
              <div className="src-sec">
                <div className="src-lb">採計科目</div>
                <div className="mini-wrap">
                <table className="mini">
                  <thead>
                    <tr>
                      <th>課號與科目</th>
                      <th className="num">學分</th>
                      <th className="nowrap">學期</th>
                      <th className="nowrap">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assigned.map((x) => (
                      <tr key={`${x.code}-${x.year}-${x.term}`}>
                        <td className="code wide">
                          {x.code}　{x.name}
                          {x.equivalentOf ? <span className="meth">（等同 {x.equivalentOf}）</span> : null}
                        </td>
                        <td className="num" data-lb="學分">{x.credits}</td>
                        <td className="nowrap" data-lb="學期">{`${x.year}-${x.term}`}</td>
                        <td className="nowrap" data-lb="狀態">{STATUS_LABEL[x.status] ?? x.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <p className="src-foot">合計 {assigned.reduce((a, x) => a + x.credits, 0)} 學分。</p>
              </div>
            ) : c.assignedCodes.length > 0 ? (
              <div className="src-sec">
                <div className="src-lb">採計科目</div>
                <p className="src-foot">{c.assignedCodes.join("、")}</p>
              </div>
            ) : null}

            {c.subRules.length > 0 ? (
              <div className="src-sec">
                <div className="src-lb">分項規定</div>
                {c.subRules.map((sr) => (
                  <div className="src-row" key={sr.id}>
                    <b>{sr.name}</b>
                    <span>
                      {sr.detail}
                      {sr.items ? (
                        <span className="items">
                          {sr.items.map((i) => (
                            <span key={i.label} className={i.ok ? "yes" : i.note ? "now" : "no"}>
                              {i.label}
                              {i.ok ? "✓" : i.note ? "（修課中）" : "✗"}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {c.notes.length > 0 || holds.length > 0 ? (
              <div className="src-sec">
                <div className="src-lb">備註</div>
                {c.notes.map((n, i) => (
                  <div className="src-row" key={i}>
                    {n.startsWith("已查核規則衝突") ? (
                      <>
                        <b className="rsv">已查核規則衝突</b>
                        <span>{n.replace("已查核規則衝突：", "")}</span>
                      </>
                    ) : (
                      <span className="wide">{n}</span>
                    )}
                  </div>
                ))}
                {holds.map((h) => (
                  <div className="src-row" key={h.id}>
                    <b className="hold">待確認</b>
                    <span>
                      {h.title}。{h.impact}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {c.citations.length > 0 ? (
              <div className="src-sec">
                <SourceLinks citations={c.citations} />
              </div>
            ) : null}
          </div>
        </td>
      </tr>
    ) : null}
    </>
  );
}

/** 暑修排在同一學年的下學期之後 */
function termRank(t: string | number): number {
  if (t === 1 || t === "1") return 1;
  if (t === 2 || t === "2") return 2;
  return 3;
}

const STATUS_LABEL: Record<string, string> = {
  passed: "已修得",
  in_progress: "修課中",
  failed: "未通過",
  waived: "抵免",
  withdrawn: "停修",
};

function buildTags(
  c: CategoryResult,
  holds: HoldItem[],
): { text: string; kind: "ok" | "unmet" | "hold" | "plain" }[] {
  const tags: { text: string; kind: "ok" | "unmet" | "hold" | "plain" }[] = [];
  if (c.unmet > 0) tags.push({ text: `未修 ${c.unmet} 學分`, kind: "unmet" });
  else if (c.status === "pending_in_progress") tags.push({ text: "修課中可完成", kind: "plain" });
  else if (c.status === "satisfied") tags.push({ text: "已完成", kind: "ok" });

  for (const s of c.subRules) {
    if (s.status === "unmet") {
      const missing = s.items?.filter((i) => !i.ok && !i.note).map((i) => i.label) ?? [];
      tags.push({ text: missing.length > 0 ? `尚缺${missing.join("、")}領域` : s.name, kind: "unmet" });
    }
  }
  if (c.overflow > 0) tags.push({ text: `超修 ${c.overflow} 學分`, kind: "plain" });
  if (holds.length > 0) tags.push({ text: `${holds.length} 項採計待確認`, kind: "hold" });
  return tags;
}
