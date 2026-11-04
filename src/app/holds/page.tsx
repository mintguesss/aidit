import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { HoldList } from "@/components/audit/HoldList";
import { pendingGraduationChecks } from "@/lib/audit/pending";

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
  const checks = outcome.ok ? pendingGraduationChecks(outcome.audit) : [];

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {!outcome.ok ? (
        <AbortNotice outcome={outcome} />
      ) : (
        <>
          <PageHead
            title="待確認事項"
            stamp={`${outcome.audit.holds.length + checks.length} 項`}
            lead="系統查過所有依據仍判定不了，這些項目未計入學分判定。點卡片看原因。"
          />
          {/* 一則一張卡，不再包一層白底面板 */}
          {outcome.audit.holds.length > 0 ? (
            <HoldList
              holds={outcome.audit.holds}
              contactSubject={outcome.audit.student.className ?? outcome.audit.student.dept}
              scope={fixture}
            />
          ) : checks.length === 0 ? (
            <HoldList holds={[]} contactSubject="" />
          ) : null}
          {/* 畢業條件不在 holds 裡，沒列出來的話這頁會寫 0 項，和首頁矛盾 */}
          {checks.length > 0 ? (
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-hd">
                <h2>畢業條件待確認</h2>
                <span className="hint">修課紀錄看不出是否通過，請自行確認或洽承辦單位</span>
              </div>
              <div className="panel-bd">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {checks.map((g) => (
                    <li key={g.id} style={{ marginBottom: 8 }}>
                      <b>{g.name}</b>：{g.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Shell>
  );
}
