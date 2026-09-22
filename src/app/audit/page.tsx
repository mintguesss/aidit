import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { CategoryTable } from "@/components/audit/CategoryTable";
import { ExtraGoals } from "@/components/audit/ExtraGoals";
import { GraduationCheckDetails } from "@/components/audit/GraduationChecks";

export const dynamic = "force-dynamic";

/** 修業明細：逐類別的學分比對與每一條結論的依據。 */
export default async function AuditDetail({
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
          <PageHead
            title="修業明細"
            stamp={`${outcome.audit.categories.length} 個類別`}
            lead={`畢業最低 ${outcome.audit.minCredits} 學分，可採計 ${outcome.audit.countable}、修課中 ${outcome.audit.inProgress}、未修 ${outcome.audit.unmet}。`}
          />
          <CategoryTable audit={outcome.audit} courses={outcome.state.record?.courses ?? []} />
          <ExtraGoals
            mode="full"
            defaults={session.preferences}
            fixture={fixture}
            term={term}
            rulepackHref={`/rulepack?fixture=${fixture}&term=${term}`}
          />
          <GraduationCheckDetails checks={outcome.audit.graduationChecks} />
        </>
      )}
    </Shell>
  );
}
