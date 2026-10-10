import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { ScenarioPanel } from "@/components/audit/ScenarioPanel";

export const dynamic = "force-dynamic";

/** 情境試算：帶著現有審查結果重新求解，不是聊天機器人。 */
export default async function ScenarioPage({
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
            title="情境試算"
            stamp={`未計入 ${outcome.audit.holds.length} 項待確認`}
            lead="改一個條件，用你目前的修課紀錄重算一次。"
          />
          <ScenarioPanel
            fixture={fixture}
            term={term}
            uncountedHolds={outcome.audit.holds.length}
            nextTerm={outcome.audit.nextTerm}
          />
        </>
      )}
    </Shell>
  );
}
