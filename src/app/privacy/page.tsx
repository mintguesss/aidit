import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { PrivacyPanel } from "@/components/settings/PrivacyPanel";

export const dynamic = "force-dynamic";

/** 資料與隱私：查閱、刪除選填、全部刪除、匯出。 */
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const student = session.outcome.ok
    ? session.outcome.audit.student
    : session.outcome.state.record?.student;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead title="資料與隱私" lead="本頁涵蓋偏好表單（必填層、選填層）與執行紀錄：存了什麼、存在哪裡、怎麼刪掉。" />
      <PrivacyPanel
        defaults={session.preferences}
        studentStatus={student?.status}
        declared={
          session.outcome.ok
            ? session.outcome.audit.graduationChecks.filter((g) => g.selfDeclared).map((g) => g.name)
            : []
        }
        fixture={fixture}
        term={term}
      />
    </Shell>
  );
}
