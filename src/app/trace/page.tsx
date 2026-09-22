import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { TraceTable } from "@/components/trace/TraceTable";

export const dynamic = "force-dynamic";

/**
 * 執行紀錄。
 * 中止的案例同樣要看得到紀錄 —— 那正是說明「為什麼不給答案」的地方。
 */
export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome } = session;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title="執行紀錄"
        stamp={`${outcome.trace.steps.length} 個步驟`}
        lead="本次審查的完整處理歷程。每個步驟的工具調用、耗時與結果均留存紀錄，供使用者與承辦單位查核。"
      />
      <TraceTable trace={outcome.trace} />
    </Shell>
  );
}
