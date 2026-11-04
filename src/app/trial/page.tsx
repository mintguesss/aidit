import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TrialDashboard } from "@/components/trial/TrialDashboard";
import { ReviewTopbar } from "@/components/trace/ReviewTopbar";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aidit｜學生試用後台", robots: { index: false, follow: false } };

/** 學生試用的主持人後台：新增受試者、看進度、判定、匯出。沿用校對登入 */
export default async function TrialPage() {
  const who = await reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value);
  if (!who) redirect("/review/login?next=/trial");
  return (
    <>
      <ReviewTopbar reviewer={who} current="trial" />
      <div className="trial-wide" data-anon-keep>
        <TrialDashboard />
      </div>
    </>
  );
}
