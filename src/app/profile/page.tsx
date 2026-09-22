import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { ProfileForm } from "@/components/settings/ProfileForm";

export const dynamic = "force-dynamic";

/** 個人資料與選課傾向。學籍資料唯讀；選課傾向可改，存在伺服器（以雜湊值為鍵）並可隨時刪除。 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome, preferences } = session;
  const search = `?fixture=${fixture}&term=${term}`;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title="個人資料與選課傾向"
        lead="學籍資料由校務系統提供、此處唯讀；選課傾向由你自己設定，可隨時查閱或刪除。"
      />
      {!outcome.ok ? (
        <AbortNotice outcome={outcome} />
      ) : (
        <ProfileForm
          fixture={fixture}
          term={term}
          student={outcome.audit.student}
          rulePack={outcome.audit.rulePack}
          defaults={preferences}
          checks={outcome.audit.graduationChecks}
          commitments={outcome.state.record?.plannedCommitments ?? []}
          search={search}
        />
      )}
    </Shell>
  );
}
