import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell } from "@/components/shell/Shell";
import { AssistantChat } from "@/components/chat/AssistantChat";

export const dynamic = "force-dynamic";

/**
 * 總體對話。
 *
 * 什麼都能問，但任何涉及學分與畢業與否的數字一律來自確定性引擎；
 * 需要重新推算的題目由程式算完再附回。成績預測與教師評價明確不做。
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome } = session;
  const search = `?fixture=${fixture}&term=${term}`;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {/* 這一頁就只有對話，再加一層頁首標題只是把同一件事講兩次 */}
      <AssistantChat
        fixture={fixture}
        term={term}
        planHref={`/plan${search}`}
        scenarioHref={`/scenario${search}`}
        rulepackHref={`/rulepack${search}`}
        stamp={outcome.ok ? `未計入 ${outcome.audit.holds.length} 項待確認` : undefined}
      />
    </Shell>
  );
}
