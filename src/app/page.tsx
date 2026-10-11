import Link from "next/link";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { RichText } from "@/components/audit/RichText";
import { ProgressRuler } from "@/components/audit/ProgressRuler";
import { FigureList } from "@/components/audit/FigureList";
import { ExtraGoals } from "@/components/audit/ExtraGoals";
import { TodoGrid, type TodoCard } from "@/components/audit/TodoGrid";
import type { AuditResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 總覽。
 *
 * 只回答三件事：現在是什麼狀況、還差什麼、接下來該去哪一頁。
 * 明細一律留在各自的功能頁 —— 把全部東西堆在同一頁，使用者反而找不到重點。
 *
 * 版面分三層：常駐的只有結論、缺口與下一步；數字拆解與說明點開才出現（再點一次收起）；
 * 完整明細點進各功能頁。同一個數字在首頁只常駐出現一次。
 */
export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome } = session;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {!outcome.ok ? (
        <AbortNotice outcome={outcome} />
      ) : (
        <>
          {/* 規劃表版本已寫在頁面上方的說明列，這裡不重複 */}
          <PageHead title="畢業學分審查結果" />

          <section className="panel">
            {/* 結論一句話常駐；細節（還差哪幾類、哪些條件待確認）收起來，下面的進度尺與數字已經講了 */}
            <details className={`verdict ${verdictClass(outcome.audit)}`}>
              <summary className="h">{outcome.audit.verdict.headline}</summary>
              <p className="p">
                <RichText text={outcome.audit.verdict.detail} />
              </p>
            </details>

            <div className="ruler">
              <ProgressRuler
                auditHref={`/audit${searchString(fixture, term)}`}
                categories={outcome.audit.categories}
                minCredits={outcome.audit.minCredits}
                overflow={outcome.audit.overflow}
                breakdown={<FigureList audit={outcome.audit} />}
              />
            </div>
          </section>

          {/* 下一步緊接在結論後面：看完缺口，第一個問題就是「那我要做什麼」 */}
          <NextSteps audit={outcome.audit} search={searchString(fixture, term)} />

          <ExtraGoals
            mode="brief"
            defaults={session.preferences}
            fixture={fixture}
            term={term}
            rulepackHref={`/rulepack${searchString(fixture, term)}`}
            detailHref={`/audit${searchString(fixture, term)}`}
          />
        </>
      )}
    </Shell>
  );
}

function verdictClass(a: AuditResult): string {
  return a.verdict.level === "ok" ? "ok" : a.verdict.level === "blocked" ? "blocked" : "";
}

function searchString(fixture: string, term: string): string {
  return `?fixture=${fixture}&term=${term}`;
}

/** 接下來要做什麼：把判定結果轉成具體的下一步，而不是讓使用者自己看表推論 */
function NextSteps({ audit, search }: { audit: AuditResult; search: string }) {
  const shortBy = audit.categories
    .filter((c) => c.unmet > 0)
    .map((c) => `${c.name} ${c.unmet}`)
    .join("、");
  const subOnly = audit.categories.filter((c) => c.status === "unmet" && c.unmet === 0);
  const unmetChecks = audit.graduationChecks.filter((g) => g.status === "unmet");

  const cards: TodoCard[] = [];

  if (audit.unmet > 0) {
    cards.push({
      k: "尚須補修",
      t: `${audit.unmet} 學分`,
      tone: "unmet",
      d: `${shortBy}。`,
      href: `/plan${search}`,
      go: "查看選課建議",
    });
  }

  if (subOnly.length > 0) {
    for (const c of subOnly) {
      const sub = c.subRules.find((s) => s.status === "unmet");
      cards.push({
        k: "學分已足但條件未達",
        t: c.name,
        tone: "unmet",
        d: sub?.detail ?? "本類別另有分布條件未達成。",
        href: `/audit${search}`,
        go: "查看修業明細",
      });
    }
  }

  if (unmetChecks.length > 0) {
    cards.push({
      k: "畢業條件未通過",
      // 一項就寫名稱；好幾項寫項數，名稱放進展開說明（名稱都很長，擠在一格裡只看得到半個）
      t: unmetChecks.length === 1 ? unmetChecks[0]!.name : `${unmetChecks.length} 項`,
      tone: "unmet",
      d: `${unmetChecks.map((g) => g.name).join("、")}。依各條件的承辦單位辦理。`,
      href: `/audit${search}`,
      go: "查看條件依據",
    });
  }

  // 畢業條件「待確認」（成績單看不出來、也沒有佐證）不在 holds 裡，但一樣不能說「全部達成」
  const holdChecks = audit.graduationChecks.filter((g) => g.status === "hold");
  if (holdChecks.length > 0) {
    cards.push({
      k: "畢業條件待確認",
      t: holdChecks.length === 1 ? holdChecks[0]!.name : `${holdChecks.length} 項`,
      tone: "hold",
      d: `${holdChecks.map((g) => g.name).join("、")}：修課紀錄看不出是否通過，請自行確認或洽承辦單位。`,
      href: `/audit${search}`,
      go: "查看條件依據",
    });
  }

  if (audit.holds.length > 0) {
    cards.push({
      k: "待人工確認",
      t: `${audit.holds.length} 項`,
      tone: "hold",
      d: "未計入上方結果，須洽承辦單位確認。",
      href: `/holds${search}`,
      go: "查看待確認事項",
    });
  }

  if (cards.length === 0) {
    cards.push({
      k: "目前狀態",
      t: "各項條件均已達成",
      tone: "ok",
      d: "學分與畢業條件皆已滿足，且無待確認事項。",
      href: `/audit${search}`,
      go: "查看修業明細",
    });
  }

  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>接下來</h2>
        <span className="todo-more">
          有疑問可以<Link href={`/assistant${search}`}>直接問</Link>
          <span className="sep">・</span>
          判定過程見<Link href={`/trace${search}`}>執行紀錄</Link>
        </span>
      </div>
      <TodoGrid cards={cards} />
    </section>
  );
}
