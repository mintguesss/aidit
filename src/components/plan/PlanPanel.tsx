"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CoursePreferences, ExclusionSummary, Infeasibility, Plan } from "@/lib/types";
import { parseSlots } from "@/lib/solver/slots";
import { Timetable } from "./Timetable";
import { ExportButtons } from "./ExportButtons";
import { PrefBar } from "./PrefBar";
import type { ConstraintSet } from "@/lib/chat/types";
import { ChatPanel, type PlanUpdate } from "../chat/ChatPanel";
import { loadStored } from "@/lib/ui/prefs";

/**
 * A 介面：課表微調（docs/CONVERSATION.md §1）。
 *
 * 第一份課表依「個人資料與選課傾向」排出；下方的對話框逐輪調整約束集合。
 * 對話狀態是 ConstraintSet，不是訊息歷史 —— 對話可以很長，
 * 但狀態永遠是一個小物件，而且使用者隨時看得到目前的條件清單。
 */

const TIPS = [
  "不要早八",
  "空出星期五",
  "少一堂課",
  "課盡量集中",
  "為什麼沒有企業流程管理？",
  "再給我一版",
  "重來",
];

type State = {
  plans: Plan[];
  constraints: ConstraintSet;
  constraintLabels: string[];
  excluded?: ExclusionSummary;
  conflicts?: Infeasibility[];
  message?: string;
};

type PlanApiResult = {
  plans?: Plan[];
  constraints?: ConstraintSet;
  appliedConstraints?: string[];
  excluded?: ExclusionSummary;
  conflicts?: Infeasibility[];
  message?: string;
};

export function PlanPanel({
  fixture,
  term,
  nextTerm,
  initial,
  originalPreferences,
  termLimits,
  reserved,
  search,
  school,
  categoryOrder,
}: {
  fixture: string;
  term: string;
  nextTerm: string;
  initial: State;
  originalPreferences: CoursePreferences;
  termLimits: { maxCredits: number; minCredits: number };
  reserved: { label: string; slotText: string }[];
  search: string;
  /** 學校：週課表與匯出的節次名稱、鐘點依各校作息 */
  school?: string;
  /** 規則包的類別順序：週課表的配色跟修業進度條一致 */
  categoryOrder?: string[];
}) {
  const [state, setState] = useState<State>(initial);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [syncing, setSyncing] = useState(false);

  // 伺服器渲染用的是案例預設；使用者若在個人資料頁存過自己的設定，掛載後重排一次
  useEffect(() => {
    const s = loadStored(originalPreferences);
    const stored = s.required;
    const hasOptional =
      Boolean(s.optional.careerDirection) ||
      s.optional.interestAreas.length > 0 ||
      s.optional.avoidCourseTypes.length > 0;
    if (JSON.stringify(stored) === JSON.stringify(originalPreferences) && !hasOptional) return;
    let cancelled = false;
    setSyncing(true);
    void fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture, term, preferences: stored, optional: s.optional }),
    })
      .then((r) => r.json())
      .then((d: PlanApiResult) => {
        if (cancelled) return;
        setState((s) => ({
          plans: d.plans ?? [],
          constraints: d.constraints ?? s.constraints,
          constraintLabels: d.appliedConstraints ?? s.constraintLabels,
          excluded: d.excluded,
          conflicts: d.conflicts,
          message: d.message,
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlanUpdate = (u: PlanUpdate) => {
    setState((s) => ({
      ...s,
      plans: u.plans,
      constraints: u.constraints,
      constraintLabels: u.constraintLabels,
      conflicts: u.conflicts,
      message: undefined,
    }));
  };

  // 只交出一份課表。並排三個「替代方案」看起來像選單，
  // 但學生無從判斷差別在哪 —— 要換就用下面的對話說，系統會說明代價。
  const plan = state.plans[0];
  const reservedSlots = reserved.map((r) => ({ label: r.label, slots: parseSlots(r.slotText).slots }));

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <h2>建議課表</h2>
          <span className="hint">{syncing ? "依你儲存的選課傾向重新排課中…" : nextTerm}</span>
          {plan ? <ExportButtons plan={plan} school={school} /> : null}
        </div>

        <PrefBar
          labels={state.constraintLabels}
          warnings={plan?.warnings ?? []}
          editHref={`/profile${search}`}
        />

        {plan ? (
          <>
            <div className="planbar">
              <span className="planmeta strong">
                {plan.totalCredits} 學分／{plan.courses.length} 門
              </span>
              <span className="viewsw">
                <button className="chip" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                  週課表
                </button>
                <button className="chip" aria-pressed={view === "list"} onClick={() => setView("list")}>
                  清單
                </button>
              </span>
            </div>

            {view === "grid" ? (
              <Timetable
                courses={plan.courses}
                reserved={reservedSlots}
                search={search}
                school={school}
                categoryOrder={categoryOrder}
              />
            ) : null}

            {view === "list" ? (
            <table className="resp">
              <thead>
                <tr>
                  <th style={{ width: 86 }}>課號</th>
                  <th>科目名稱</th>
                  <th className="num" style={{ width: 54 }}>學分</th>
                  <th className="nowrap" style={{ width: 110 }}>時段</th>
                  <th className="nowrap" style={{ width: 78 }}>教師</th>
                  <th className="nowrap" style={{ width: 150 }}>採計類別</th>
                  <th className="num" style={{ width: 56 }}>餘額</th>
                  <th className="nowrap" style={{ width: 84 }}>檢核</th>
                  <th className="nowrap" style={{ width: 56 }}>課綱</th>
                </tr>
              </thead>
              <tbody>
                {plan.courses.map((c) => (
                  <tr className="plan-tr" key={c.code}>
                    <td className="code span" data-lb="課號">{c.code}</td>
                    <td className="cell-main span">
                      {c.name}
                      {c.prereqWarning ? (
                        <div className="clash">
                          先修提醒：{c.prereqWarning}（由課程大綱文字抽取，信心較低，未據以排除本課程）
                        </div>
                      ) : null}
                      <Reviews course={c} />
                    </td>
                    <td className="num" data-lb="學分">{c.credits}</td>
                    <td className="nowrap" data-lb="時段">{c.slotText}</td>
                    <td className="nowrap" data-lb="教師">{c.teacher}</td>
                    <td className="num" data-lb="餘額" title={c.remaining === null ? "開課資料未提供" : undefined}>
                      {c.remaining ?? "—"}
                    </td>
                    <td className="span nowrap" data-lb="採計類別">{c.categoryLabel}</td>
                    <td className="span">
                      <span className={`tag ${c.slotText.startsWith("時段未知") ? "hold" : "ok"}`}>
                        {c.slotText.startsWith("時段未知")
                          ? "時段未知"
                          : c.slots.length === 0
                            ? "無固定時間"
                            : "無衝堂"}
                      </span>
                    </td>
                    <td className="span nowrap" data-lb="課綱">
                      <Link className="syl" href={`/syllabus/${c.code}${search}${c.section ? `${search ? "&" : "?"}sec=${c.section}` : ""}`}>
                        課綱
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            ) : null}

          </>
        ) : (
          <NoPlan state={state} term={nextTerm} />
        )}

        <details className="explain">
          <summary>求解條件與已排除的課程</summary>
          <div className="bd">
            <b>硬限制</b>　補足未修學分；學則之學期學分上限 {termLimits.maxCredits}、
            <b>下限 {termLimits.minCredits}</b>（湊不足時會以其他可修課程補足）；
            先修科目（結構化欄位取得者）須已修畢；修課餘額大於 0；不與已登記時段重疊
            {reserved.length > 0 ? `（${reserved.map((r) => `${r.label} ${r.slotText}`).join("、")}）` : ""}；
            你指定要空出的星期與節次；你指定要排除或保留的課程。
            <br />
            <b>軟偏好</b>　不排早八、期望堂數、課程集中度。做不到時會照排並在上方說明。
            <br />
            <b>不自動放寬</b>　對話中無解時，系統會列出可放寬的選項讓你決定，
            不會自己解除你設的條件再交出一份看起來可行的課表。
            {state.excluded ? (
              <>
                <br />
                <b>已排除</b>　{state.excluded.candidatesBeforeFilter} 門開課中，
                {state.excluded.excludedBy
                  .map((e) => `因${e.reason}排除 ${e.count} 門（${e.examples.join("、")}）`)
                  .join("；")}
                。
              </>
            ) : null}
            <br />
            <b>本系統不代為選課</b>　僅輸出建議清單，實際加選須由學生於選課系統自行操作。
          </div>
        </details>
      </section>

      <ChatPanel
        title="調整課表"
        hint="每次調整都會回報：改了什麼、課表差異、代價"
        scope="plan"
        fixture={fixture}
        term={term}
        constraints={state.constraints}
        shownCourses={state.plans[0]?.courses.map((c) => c.code)}
        rulepackHref={`/rulepack${search}`}
        onPlanUpdate={onPlanUpdate}
        placeholder="例如：不要早八、空出星期五、為什麼沒有某某課"
        tips={TIPS}
        intro="想改什麼直接說。每一輪我都會回報：改了什麼條件、課表差在哪、代價是什麼。"
        guide={
          <>
            <p>
              上面的課表依你在<Link href={`/profile${search}`}>個人資料</Link>設定的選課傾向排出。
              想改什麼直接說，每一輪我都會回報三件事：<b>改了什麼條件</b>、<b>課表差在哪</b>、
              <b>代價是什麼</b>。
            </p>
            <p>
              <b>可以說</b>
            </p>
            <ul>
              <li>時段 —— 不要早八、把週五的課拿掉</li>
              <li>堂數 —— 少一堂課、這學期 12 學分以內</li>
              <li>換課 —— 把某某換掉、某某一定要留、幫我加一門某某</li>
              <li>目標 —— 我想提前畢業</li>
              <li>問原因 —— 為什麼沒有某某課</li>
              <li>比較 —— 再給我一版</li>
            </ul>
            <p>
              我只把你的話解析成條件，<b>課程的挑選與學分計算全程由求解器負責</b>。
              無解時我會列出可放寬的選項，但不會自己解除你設的條件。
            </p>
          </>
        }
      />
    </>
  );
}

function NoPlan({ state, term }: { state: State; term: string }) {
  if (state.message) return <div className="empty">{state.message}</div>;
  return (
    <>
      <div className="empty">
        在目前的條件下求不出可行的組合。下列為受限的類別與排除原因 ——
        系統不回空清單，因為「沒有建議」與「條件互相衝突」是兩件事。
      </div>
      {(state.conflicts ?? []).map((c) => (
        <div className="note warn" key={c.category}>
          <b>{c.category}</b>　{term} 共 {c.candidatesBeforeFilter} 門符合類別之開課，經過濾後無一可選。
          <br />
          {c.excludedBy.map((e) => `${e.reason} ${e.count} 門（${e.examples.join("、")}）`).join("；")}
          <br />
          {c.conflictWith ? (
            <>
              <b>衝突對象</b>　{c.conflictWith}
              <br />
            </>
          ) : null}
          <b>建議</b>　{c.suggestion}
        </div>
      ))}
    </>
  );
}

function Reviews({ course }: { course: Plan["courses"][number] }) {
  const list = course.discussions ?? [];
  if (list.length === 0) {
    return (
      <div className="review">
        查無近兩年公開討論。<span>不影響採計判定</span>
      </div>
    );
  }
  const latest = list.reduce((a, b) => (a.postedAt > b.postedAt ? a : b));
  return (
    <div className="review">
      近兩年 {list.length} 則公開討論：{list[0]!.summary}
      <span>　匿名網路討論，最新一則 {latest.postedAt}，僅供參考，不參與採計判定</span>
    </div>
  );
}
