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
import { Modal } from "../shell/Modal";
import { Spinner } from "../shell/Spinner";

/**
 * A 介面：課表微調（docs/CONVERSATION.md §1）。
 *
 * 第一份課表依「個人資料與選課傾向」排出；下方的對話框逐輪調整約束集合。
 * 頁面上只放結果摘要（幾學分幾門、哪幾門），完整的週課表／清單按鈕打開彈出視窗看 ——
 * 這一頁的主角是對話，課表大圖常駐會把對話擠到兩個螢幕以下。
 * 對話裡每一版也都能開同一個視窗看「那一版」的課表。
 * 對話狀態是 ConstraintSet，不是訊息歷史 —— 對話可以很長，
 * 但狀態永遠是一個小物件，而且使用者隨時看得到目前的條件清單。
 */

const TIPS = [
  "不要早八",
  "回上一版",
  "空出星期五",
  "少一堂課",
  "課盡量集中",
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
  /** 彈出視窗正在看哪一份課表（null＝關著） */
  const [shown, setShown] = useState<{ plan: Plan; label: string } | null>(null);
  /** 對話改了課表之後，按鈕上掛一個「已更新」，看過就拿掉 */
  const [fresh, setFresh] = useState(false);
  const [rev, setRev] = useState(0);

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
      // 「目前生效的條件」只放個人設定裡改得到的條件；對話裡加的（加一門 AI 課、期望 6 堂）
      // 已在對話卡片上列出，混進來會分不清哪些是設定、哪些只是這次對話的調整
      conflicts: u.conflicts,
      message: undefined,
    }));
    setFresh(true);
    setRev((r) => r + 1);
  };

  // 只交出一份課表。並排三個「替代方案」看起來像選單，
  // 但學生無從判斷差別在哪 —— 要換就用下面的對話說，系統會說明代價。
  const plan = state.plans[0];
  const reservedSlots = reserved.map((r) => ({ label: r.label, slots: parseSlots(r.slotText).slots }));

  const colorOf = (cat: string) => {
    const i = (categoryOrder ?? []).indexOf(cat);
    return i < 0 ? undefined : (i % 6) + 1;
  };

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <h2>建議課表</h2>
          <span className="hint">{nextTerm}</span>
        </div>

        <PrefBar
          labels={state.constraintLabels}
          warnings={plan?.warnings ?? []}
          editHref={`/profile${search}`}
        />

        {syncing ? (
          <div className="plansum loading">
            <Spinner label="依你儲存的選課傾向重新排課中…" />
          </div>
        ) : plan ? (
          // key 跟著版本變：每次對話改了課表，摘要會重新淡入一次，看得出換了
          <div className="plansum" key={rev}>
            <div className="plansum-fig">
              <b>{plan.totalCredits}</b>
              <em>學分</em>
              <b>{plan.courses.length}</b>
              <em>門</em>
            </div>
            <ul className="plansum-list">
              {plan.courses.map((c, i) => (
                <li key={c.code} data-c={colorOf(c.category)} style={{ animationDelay: `${i * 50}ms` }}>
                  {c.name}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary plansum-open"
              onClick={() => {
                setShown({ plan, label: "目前的課表" });
                setFresh(false);
              }}
            >
              查看建議課表
              {fresh ? <span className="plansum-new">已更新</span> : null}
            </button>
          </div>
        ) : (
          <NoPlan state={state} term={nextTerm} />
        )}

        <details className="explain rules">
          <summary>排課時遵守哪些條件、排除了哪些課</summary>
          <SolveRules
            termLimits={termLimits}
            reserved={reserved}
            excluded={state.excluded}
          />
        </details>
      </section>

      <ChatPanel
        title="調整課表"
        hint="改完會告訴你差在哪"
        scope="plan"
        fixture={fixture}
        term={term}
        constraints={state.constraints}
        shownCourses={state.plans[0]?.courses.map((c) => c.code)}
        rulepackHref={`/rulepack${search}`}
        onPlanUpdate={onPlanUpdate}
        onOpenPlan={(u, label) => {
          const p = u.plans[0];
          if (p) setShown({ plan: p, label });
        }}
        placeholder="想怎麼改？例如：不要早八"
        tips={TIPS}
        intro="課表排好了，想改什麼直接跟我說。每次改完我都會告訴你：改了什麼、課表差在哪、有沒有代價。"
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

      <Modal
        open={shown !== null}
        onClose={() => setShown(null)}
        title="建議課表"
        sub={shown ? `${nextTerm}・${shown.label}・${shown.plan.totalCredits} 學分／${shown.plan.courses.length} 門` : undefined}
        actions={
          shown ? (
            <>
              <span className="viewsw">
                <button className="chip" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                  週課表
                </button>
                <button className="chip" aria-pressed={view === "list"} onClick={() => setView("list")}>
                  清單
                </button>
              </span>
              <ExportButtons plan={shown.plan} school={school} />
            </>
          ) : null
        }
      >
        {shown ? (
          view === "grid" ? (
            <Timetable
              courses={shown.plan.courses}
              reserved={reservedSlots}
              search={search}
              school={school}
              categoryOrder={categoryOrder}
            />
          ) : (
            <PlanTable plan={shown.plan} search={search} />
          )
        ) : null}
      </Modal>
    </>
  );
}

/**
 * 「求解條件與已排除的課程」。
 * 原本是一整段用粗體分隔的長句；改成四組清單，一眼看得出
 * 哪些是一定守住的、哪些是盡量、做不到時怎麼辦、哪些課被排除了為什麼。
 */
function SolveRules({
  termLimits,
  reserved,
  excluded,
}: {
  termLimits: { maxCredits: number; minCredits: number };
  reserved: { label: string; slotText: string }[];
  excluded?: ExclusionSummary;
}) {
  const total = excluded?.excludedBy.reduce((a, e) => a + e.count, 0) ?? 0;
  return (
    <div className="rules-bd">
      <div className="rules-grp must">
        <h4>
          一定守住<span>排不出來寧可說排不出來</span>
        </h4>
        <ul>
          <li>補足還沒修完的學分</li>
          <li>
            每學期 <b>{termLimits.minCredits}–{termLimits.maxCredits}</b> 學分（學則上下限；不足時用其他可修的課補）
          </li>
          <li>先修科目要已經修過</li>
          <li>課程還有名額</li>
          <li>
            不跟已登記的時段撞堂
            {reserved.length > 0 ? (
              <span className="rules-tags">
                {reserved.map((r) => (
                  <span key={r.label}>
                    {r.label} {r.slotText}
                  </span>
                ))}
              </span>
            ) : null}
          </li>
          <li>你說要空出來的星期與節次、你說要排除或保留的課</li>
        </ul>
      </div>

      <div className="rules-grp soft">
        <h4>
          盡量做到<span>做不到會照排，並在上方告訴你</span>
        </h4>
        <ul>
          <li>不排早八</li>
          <li>接近你期望的堂數</li>
          <li>課程盡量集中</li>
        </ul>
      </div>

      <div className="rules-grp stop">
        <h4>排不出來的時候</h4>
        <p>
          列出可以放寬的選項，<b>由你決定</b>放寬哪一項。系統不會自己偷偷拿掉你設的條件，換一份「看起來可行」的課表給你。
        </p>
      </div>

      {excluded ? (
        <div className="rules-grp out">
          <h4>
            沒排進來的課
            <span>
              {excluded.candidatesBeforeFilter} 門開課中排除 {total} 門
            </span>
          </h4>
          <ul className="rules-out">
            {excluded.excludedBy.map((e) => (
              <li key={e.reason}>
                <span className="rules-why">{e.reason}</span>
                <b className="rules-n">{e.count} 門</b>
                <span className="rules-tags">
                  {e.examples.map((x) => (
                    <span key={x}>{x}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="rules-note">本系統只給建議清單，不代為選課；實際加選請到學校選課系統操作。</p>
    </div>
  );
}

function PlanTable({ plan, search }: { plan: Plan; search: string }) {
  const sylHref = (c: Plan["courses"][number]) =>
    `/syllabus/${c.code}${search}${c.section ? `${search ? "&" : "?"}sec=${c.section}` : ""}`;
  const check = (c: Plan["courses"][number]) =>
    c.slotText.startsWith("時段未知") ? "時段未知" : c.slots.length === 0 ? "無固定時間" : "無衝堂";
  return (
    <>
    {/* 手機：一門一張卡，課名最大、時段與教師一行、其他縮成小標籤 */}
    <ul className="pcards">
      {plan.courses.map((c) => (
        <li key={c.code}>
          <div className="pcard-top">
            <span className="pcard-name">{c.name}</span>
            <span className="pcard-cr">
              <b>{c.credits}</b>學分
            </span>
          </div>
          <div className="pcard-when">
            <span className="pcard-slot">{c.slotText}</span>
            <span>{c.teacher}</span>
            <code>{c.code}</code>
          </div>
          <div className="pcard-tags">
            <span>{c.categoryLabel}</span>
            <span>餘額 {c.remaining ?? "未知"}</span>
            <span className={c.slotText.startsWith("時段未知") ? "hold" : "ok"}>{check(c)}</span>
            <Link className="pcard-syl" href={sylHref(c)}>
              課綱 →
            </Link>
          </div>
          {c.prereqWarning ? <div className="clash">先修提醒：{c.prereqWarning}</div> : null}
        </li>
      ))}
    </ul>
    <table className="resp ptable">
      <thead>
        <tr>
          <th style={{ width: 86 }}>課號</th>
          <th>科目名稱</th>
          <th className="num" style={{ width: 54 }}>學分</th>
          <th className="nowrap" style={{ width: 110 }}>時段</th>
          <th className="nowrap" style={{ width: 78 }}>教師</th>
          <th className="num" style={{ width: 56 }}>餘額</th>
          <th className="nowrap" style={{ width: 150 }}>採計類別</th>
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
            </td>
            <td className="num" data-lb="學分">{c.credits}</td>
            <td className="nowrap" data-lb="時段">{c.slotText}</td>
            <td className="nowrap" data-lb="教師">{c.teacher}</td>
            <td className="num" data-lb="餘額" title={c.remaining === null ? "開課資料未提供" : undefined}>
              {c.remaining ?? "—"}
            </td>
            <td className="span nowrap" data-lb="採計類別">{c.categoryLabel}</td>
            <td className="span">
              <span className={`tag ${c.slotText.startsWith("時段未知") ? "hold" : "ok"}`}>{check(c)}</span>
            </td>
            <td className="span nowrap" data-lb="課綱">
              <Link className="syl" href={sylHref(c)}>
                課綱
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
