import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { PlanPanel } from "@/components/plan/PlanPanel";
import { ExtraGoals } from "@/components/audit/ExtraGoals";
import { constraintSetFrom, describeSet } from "@/lib/chat/apply";

export const dynamic = "force-dynamic";

/** 下學期選課建議：先依基本資料的選課傾向產生，再以對話微調。 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome, preferences, termLimits } = session;
  const search = `?fixture=${fixture}&term=${term}`;
  const constraints = constraintSetFrom(preferences);

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {!outcome.ok ? (
        <AbortNotice outcome={outcome} />
      ) : (
        <>
          <PageHead
            title="下學期選課建議"
            stamp={outcome.audit.nextTerm}
            lead="依你的選課傾向排出。想改什麼，直接在下方說。"
          />
          <ExtraGoals
            mode="plan"
            defaults={preferences}
            fixture={fixture}
            term={term}
            rulepackHref={`/rulepack${search}`}
            detailHref={`/audit${search}`}
          />
          <PlanPanel
            fixture={fixture}
            term={term}
            initial={{
              plans: outcome.state.plans,
              constraints,
              constraintLabels: describeSet(constraints),
              excluded: outcome.state.solve?.excluded,
              conflicts:
                outcome.state.solve && !outcome.state.solve.ok
                  ? outcome.state.solve.infeasibilities
                  : undefined,
              message:
                outcome.audit.unmet === 0 &&
                outcome.audit.categories.every((c) => c.status !== "unmet")
                  ? "各類別學分均已滿足或修課中，無須推薦下學期課程。"
                  : undefined,
            }}
            originalPreferences={preferences}
            nextTerm={outcome.audit.nextTerm}
            termLimits={termLimits}
            reserved={outcome.state.record?.plannedCommitments ?? []}
            search={search}
          />
        </>
      )}
    </Shell>
  );
}
