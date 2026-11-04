import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { HoldList } from "@/components/audit/HoldList";
import { pendingChecksAsHolds } from "@/lib/audit/pending";

export const dynamic = "force-dynamic";

/** 待確認事項：系統停止自動推論的地方。 */
export default async function Holds({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome } = session;
  // 畢業條件的待確認不在 audit.holds 裡，沒列出來的話這頁會寫 0 項，和首頁矛盾
  const holds = outcome.ok ? [...outcome.audit.holds, ...pendingChecksAsHolds(outcome.audit)] : [];

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {!outcome.ok ? (
        <AbortNotice outcome={outcome} />
      ) : (
        <>
          <PageHead
            title="待確認事項"
            stamp={`${holds.length} 項`}
            lead="系統查過所有依據仍判定不了，這些項目未計入學分判定。點卡片看原因。"
          />
          {/* 一則一張卡，不再包一層白底面板 */}
          <HoldList
            holds={holds}
            contactSubject={outcome.audit.student.className ?? outcome.audit.student.dept}
            scope={fixture}
            school={outcome.audit.student.school}
          />
        </>
      )}
    </Shell>
  );
}
