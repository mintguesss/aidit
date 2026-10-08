import Link from "next/link";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { RulePackUpload } from "@/components/settings/RulePackUpload";

export const dynamic = "force-dynamic";

/** 適用規劃表：看目前套用哪一版，以及上傳自己的那一版。 */
export default async function RulePackPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome } = session;
  const search = `?fixture=${fixture}&term=${term}`;
  const audit = outcome.ok ? outcome.audit : null;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title="適用規劃表"
        stamp={audit ? `rev.${audit.rulePack.version}` : undefined}
        lead={
          <>
            判定用的是哪一版規劃表，以及版本不對時要怎麼換。每一條規定的原文見{" "}
            <Link href={`/sources${search}`}>原文出處</Link>。
          </>
        }
      />

      <section className="panel">
        <div className="panel-hd">
          <h2>目前套用</h2>
          <span className="hint">由學籍入學學年決定</span>
        </div>
        <div className="panel-bd">
          {audit ? (
            <>
              <div className="fieldgrid">
                <div className="field">
                  <div className="field-k">規則包</div>
                  <div className="field-v mono">
                    {audit.rulePack.id} rev.{audit.rulePack.version}
                  </div>
                </div>
                <div className="field">
                  <div className="field-k">適用學年</div>
                  <div className="field-v">{audit.student.admissionYear} 學年度</div>
                </div>
                <div className="field">
                  <div className="field-k">來源</div>
                  <div className="field-v">
                    {audit.rulePack.provenance === "approved"
                      ? "已人工校對並鎖版"
                      : audit.rulePack.provenance === "synthetic"
                        ? "合成規則包（評測用）"
                        : "未校對草稿"}
                  </div>
                </div>
                <div className="field">
                  <div className="field-k">畢業最低學分</div>
                  <div className="field-v">{audit.minCredits}</div>
                </div>
              </div>
              <p className="panel-foot">
                每一條判定都可以回查到這一版的原文；逐條依據見
                <Link href={`/audit${search}`}> 修業明細</Link>，完整執行過程見
                <Link href={`/trace${search}`}> 執行紀錄</Link>。
              </p>
            </>
          ) : (
            <p className="lead">本案已轉人工審查，未套用任何規劃表版本。</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2>版本不對？上傳你的規劃表</h2>
          <span className="hint">上傳後不會直接生效</span>
        </div>
        <div className="panel-bd">
          <p className="lead">
            <b>在人工校對鎖版之前，上傳的版本一律不參與學分判定。</b>
          </p>
          <RulePackUpload />
        </div>
      </section>
    </Shell>
  );
}
