import { loadDraft } from "@/lib/review/store";
import { ReviewBoard } from "@/components/trace/ReviewBoard";

export const dynamic = "force-dynamic";

/**
 * 人工校對頁（docs/BACKEND.md §2）。
 * 左邊原文（高亮 quote 位置），右邊抽取結果，逐條 approve／修正。
 */
export default async function ReviewPack({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
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
      <header className="topbar">
        <div className="topbar-in">
          <span className="brand-mark">Aidit</span>
          <span className="brand-sub">規則包人工校對（內部作業）</span>
          <span className="topbar-right">
            <span className="term">{packId}</span>
          </span>
        </div>
      </header>
      <ReviewBoard view={view} />
    </>
  );
}
