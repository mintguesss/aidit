import { loadDraft } from "@/lib/review/store";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";
import { ReviewTopbar } from "@/components/trace/ReviewTopbar";
import { ReviewBoard } from "@/components/trace/ReviewBoard";

export const dynamic = "force-dynamic";

/**
 * 人工校對頁（docs/BACKEND.md §2）。
 * 左邊原文（高亮 quote 位置），右邊抽取結果，逐條 approve／修正。
 */
export default async function ReviewPack({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const reviewer = await reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value);
  if (!reviewer) redirect(`/review/login?next=/review/${encodeURIComponent(packId)}`);
  const view = await loadDraft(packId);

  if (!view) {
    return (
      <div className="abort">
        <div className="box">
          <h1>查無此草稿</h1>
          <p>
            找不到 <code>{packId}</code> 的抽取草稿。請確認 <code>.data/drafts/</code> 下是否有對應檔案。
          </p>
          <p>
            <a href="/review">回到草稿清單</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ReviewTopbar reviewer={reviewer} packId={packId} />
      <ReviewBoard view={view} reviewer={reviewer} />
    </>
  );
}
