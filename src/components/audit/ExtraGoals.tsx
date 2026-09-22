"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CoursePreferences } from "@/lib/types";
import type { ExtraGoalSummary } from "@/lib/extra/goals";
import { loadPreferences } from "@/lib/ui/prefs";
import { SourceLinks } from "../sources/SourceLinks";

/**
 * 額外修業目標（輔系／雙主修／學分學程／轉系）。
 *
 * 三種用法共用同一份資料，只換呈現密度：
 *   brief  首頁　　 一個目標一條進度，看得出還差多少
 *   full   修業明細 逐項應修／已修／未修、缺哪幾門、依據原文、相關修課
 *   plan   選課建議 提醒這份課表沒有把這些目標算進去
 *
 * 界線：**已收錄該項規定**時逐項計算（確定性，每條附得出依據）；
 * **尚未收錄**時只列出相關的已修課程，並說明缺哪些資料 —— 絕不給出猜的學分數字。
 */
export function ExtraGoals({
  mode,
  defaults,
  fixture,
  term,
  rulepackHref,
  detailHref,
}: {
  mode: "brief" | "full" | "plan";
  /** 伺服器端的案例預設；使用者若在個人資料頁改過，掛載後以 localStorage 為準 */
  defaults: CoursePreferences;
  fixture: string;
  term: string;
  rulepackHref: string;
  detailHref?: string;
}) {
  const [rows, setRows] = useState<ExtraGoalSummary[] | null>(null);

  useEffect(() => {
    // 一定要問伺服器：已註冊的輔系／雙主修／學程來自學籍資料，不在本機偏好裡
    const goals = loadPreferences(defaults).extraGoals;
    let cancelled = false;
    void fetch("/api/extra-goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture, term, goals }),
    })
      .then((r) => r.json())
      .then((d: { rows?: ExtraGoalSummary[] }) => {
        if (!cancelled) setRows(d.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 從首頁點某個目標過來時，展開它的相關修課並捲到位置
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || mode !== "full") return;
    const apply = () => {
      const m = /^#eg-(\d+)$/.exec(window.location.hash);
      if (!m) return;
      const idx = Number(m[1]);
      setOpenIndex(idx);
      requestAnimationFrame(() => {
        document.getElementById(`eg-${idx}`)?.scrollIntoView({ block: "center" });
      });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [mode, rows]);

  if (!rows || rows.length === 0) return null;

  if (mode === "plan") {
    const known = rows.filter((r) => r.audit);
    const unknown = rows.filter((r) => !r.audit);
    return (
      <div className="note warn">
        這份課表只依<b>本系</b>的規定排課。
        {known.length > 0 ? (
          <>
            {known
              .map((r) => `${r.kindLabel}（${r.dept?.name ?? r.goal.target}）另有 ${r.audit!.unmet} 學分未修`)
              .join("；")}
            ，這些學分不在上面的課表裡。
          </>
        ) : null}
        {unknown.length > 0 ? (
          <>
            {unknown.map((r) => `${r.kindLabel}（${r.goal.target}）`).join("、")}
            則因為尚未收錄規定，系統連還差多少都算不出來。
          </>
        ) : null}
        {detailHref ? (
          <>
            　逐項現況見 <Link href={detailHref}>修業明細</Link>。
          </>
        ) : null}
      </div>
    );
  }

  if (mode === "brief") {
    return (
      <section className="panel">
        <div className="panel-hd">
          <h2>額外修業目標</h2>
          <span className="hint">依學籍資料與你的宣告，與本系分開計算</span>
        </div>
        <div className="eg-bars">
          {rows.map((r, i) => (
            <div className="eg-bar" key={i}>
              <div className="eg-bar-hd">
                <span className="eg-kind">{r.kindLabel}</span>
                {!r.registered ? <span className="eg-self">自行宣告</span> : null}
                {detailHref ? (
                  <Link className="eg-name" href={`${detailHref}#eg-${i}`}>
                    {r.dept ? r.dept.name : r.goal.target}
                  </Link>
                ) : (
                  <b>{r.dept ? r.dept.name : r.goal.target}</b>
                )}
                {r.audit ? (
                  <span className="eg-vl">
                    <b className={r.audit.unmet > 0 ? "bad" : undefined}>
                      {r.audit.earned + r.audit.inProgress}
                    </b>
                    <em>/{r.audit.minCredits}</em>
                    {r.audit.unmet > 0 ? <span className="short">缺 {r.audit.unmet}</span> : null}
                  </span>
                ) : (
                  <span className="eg-st">尚未收錄規定，無法計算還差多少</span>
                )}
              </div>
              {/* 有多個應修項目就分段畫，一段一項 —— 全部混成一條會看不出是哪一項還沒修 */}
              {r.audit ? (
                <>
                  <div className="eg-track">
                    {r.audit.requirements.map((q) => (
                      <span
                        key={q.id}
                        className="eg-seg"
                        style={{ flex: `${q.required} 0 0` }}
                        title={`${q.label}　已修 ${q.earned}・修課中 ${q.inProgress}・未修 ${q.unmet}（應修 ${q.required}）`}
                      >
                        {q.earned > 0 ? (
                          <i className="st-done" style={{ flex: `${q.earned} 0 0` }} />
                        ) : null}
                        {q.inProgress > 0 ? (
                          <i className="st-now" style={{ flex: `${q.inProgress} 0 0` }} />
                        ) : null}
                        {q.unmet > 0 ? (
                          <i className="st-unmet" style={{ flex: `${q.unmet} 0 0` }} />
                        ) : null}
                      </span>
                    ))}
                  </div>
                  <div className="eg-segnames">
                    {r.audit.requirements.map((q) => (
                      <span key={q.id} style={{ flex: `${q.required} 0 0` }}>
                        {q.label}
                        <em>
                          {q.earned + q.inProgress}/{q.required}
                        </em>
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>

      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>額外修業目標</h2>
        <span className="hint">與本系分開計算，互不流用</span>
      </div>
      {rows.map((r, i) => (
        <div className="eg-block" key={i} id={`eg-${i}`}>
          <div className="eg-hd">
            <span className="eg-kind">{r.kindLabel}</span>
            <b>{r.dept ? r.dept.name : r.goal.target}</b>
            {!r.registered ? <span className="eg-self">自行宣告，尚未註冊</span> : null}
            {r.audit ? (
              <span className="eg-vl">
                <b className={r.audit.unmet > 0 ? "bad" : undefined}>
                  {r.audit.earned + r.audit.inProgress}
                </b>
                <em>/{r.audit.minCredits}</em>
                {r.audit.unmet > 0 ? <span className="short">缺 {r.audit.unmet}</span> : null}
              </span>
            ) : null}
          </div>

          {r.audit ? (
            <>
              <div className="mini-wrap">
              <table className="mini">
                <thead>
                  <tr>
                    <th>應修項目</th>
                    <th className="num">應修</th>
                    <th className="num">已修</th>
                    <th className="num">修課中</th>
                    <th className="num">未修</th>
                    <th>尚缺科目</th>
                  </tr>
                </thead>
                <tbody>
                  {r.audit.requirements.map((q) => (
                    <tr key={q.id}>
                      <td className="wide cell-main">{q.label}</td>
                      <td className="num" data-lb="應修">{q.required}</td>
                      <td className="num" data-lb="已修">{q.earned}</td>
                      <td className="num" data-lb="修課中">{q.inProgress === 0 ? "—" : q.inProgress}</td>
                      <td className={`num wide${q.unmet > 0 ? " t-unmet" : ""}`} data-lb="未修">
                        {q.unmet}
                      </td>
                      <td className="wide" data-lb="尚缺科目">
                        {q.missingCodes.length > 0 ? (
                          <span className="code">{q.missingCodes.join("、")}</span>
                        ) : q.unmet > 0 ? (
                          <span className="t-mute">再修 {q.unmet} 學分該系科目</span>
                        ) : (
                          <span className="t-mute">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              <p className="eg-needs">
                <span className="lb">重複採計</span>
                {r.audit.overlapPolicy}
              </p>

              <SourceLinks
                citations={[
                  ...r.audit.requirements.map((q) => q.citation),
                  r.audit.overlapCitation,
                ]}
              />
            </>
          ) : (
            <p className="eg-why">{r.blocked}</p>
          )}

          {r.courses.length > 0 ? (
            <details className="eg-courses" open={openIndex === i}>
              <summary>相關修課 {r.courses.length} 門・{r.credits} 學分</summary>
              <div className="mini-wrap">
              <table className="mini">
                <thead>
                  <tr>
                    <th>課號與科目</th>
                    <th className="num">學分</th>
                    <th className="nowrap">學期</th>
                    <th className="nowrap">目前計入本系</th>
                  </tr>
                </thead>
                <tbody>
                  {r.courses.map((c) => (
                    <tr key={`${c.code}-${c.year}-${c.term}`}>
                      <td className="code wide">{c.code}　{c.name}</td>
                      <td className="num" data-lb="學分">{c.credits}</td>
                      <td className="nowrap" data-lb="學期">{`${c.year}-${c.term}`}</td>
                      <td className="nowrap" data-lb="計入本系">
                        {c.countedAs ? c.countedAs : <span className="t-mute">未採計</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </details>
          ) : null}

          {!r.audit ? (
            <p className="eg-needs">
              <span className="lb">需要補齊</span>
              {r.needs.join("、")}。取得後可到 <Link href={rulepackHref}>適用規劃表</Link> 上傳。
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
