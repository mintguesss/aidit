import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { AbortNotice } from "@/components/shell/AbortNotice";
import { HoldList } from "@/components/audit/HoldList";

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

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {!outcome.ok ? (
        <AbortNotice outcome={outcome} />
      ) : (
        <>
          <PageHead
            title="待確認事項"
            stamp={`${outcome.audit.holds.length} 項`}
            lead="這些項目未計入學分判定 —— 系統檢索所有可得依據後仍無法判定，已停止自動推論。"
          />
          {/* 沒有待確認事項時只是一句說明，不包白底面板 */}
          {outcome.audit.holds.length > 0 ? (
            <section className="panel">
              <HoldList
                holds={outcome.audit.holds}
                contactSubject={outcome.audit.student.className ?? outcome.audit.student.dept}
              />
            </section>
          ) : (
            <HoldList holds={[]} contactSubject="" />
          )}
          <details className="panel explain">
            <summary>為什麼系統不直接猜一個答案</summary>
            <div className="bd">
              在畢業審查場域，答錯的代價遠高於不答：一個假的「未修 12 學分」會讓已能畢業的學生多讀一學期，
              一個假的「已滿足」則會讓學生到畢業前一刻才發現不能畢業。
              <br />
              因此規則包會明確記錄「這條規則有洞」（例如附註允許跨院採計但未列明範圍），
              命中的修課<b>整個移出</b>學分計算，並在上方列為待確認事項，
              同時算出「若經承辦單位認定可採計，結果會如何」供參考。
              <br />
              不確定是寫在規則包裡的資料，不是模型臨時的判斷。
            </div>
          </details>
        </>
      )}
    </Shell>
  );
}
