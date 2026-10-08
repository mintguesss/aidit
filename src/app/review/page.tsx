import { listDrafts, loadDraft } from "@/lib/review/store";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REVIEW_COOKIE, reviewerFromSession } from "@/lib/review/auth";
import { ReviewTopbar } from "@/components/trace/ReviewTopbar";

export const dynamic = "force-dynamic";

/** 人工校對頁的入口：列出待校對的規則包草稿。 */
export default async function ReviewIndex() {
  const reviewer = reviewerFromSession((await cookies()).get(REVIEW_COOKIE)?.value);
  if (!reviewer) redirect("/review/login?next=/review");
  const drafts = await listDrafts();
  // 先全部解析完再進 JSX：server component 的 render 不能 await
  const views = await Promise.all(drafts.map(async (id) => ({ id, v: await loadDraft(id) })));

  return (
    <>
      <ReviewTopbar reviewer={reviewer} />

      <div className="abort">
        <div className="box" style={{ borderLeftColor: "var(--ink-3)" }}>
          <h1 style={{ color: "var(--ink)" }}>規則包人工校對</h1>
          <p>
            畢業規定先從系上公布的文件整理成草稿，<b>必須逐條經人工校對、全部通過並鎖版</b>，系統才會拿來審查。
            還沒鎖版的草稿不會用於任何判定。
          </p>
          <p>校對紀錄（誰、什麼時候、通過或修正）會保存下來，作為資料品質的證據。</p>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-hd">
            <h2>待校對草稿</h2>
          </div>
          <div className="panel-bd">
            {drafts.length === 0 ? (
              <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13.5 }}>
                目前沒有草稿。請先執行：
                <br />
                <code style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>
                  python scripts/pdf-to-segments.py plan.pdf plan-im-112 &quot;112 學年度…課程規劃表&quot; &gt;
                  .data/segments/plan-im-112.json
                </code>
                <br />
                <code style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>
                  npm run rulepack:extract -- --segments .data/segments/plan-im-112.json --id im-112 --dept IM
                  --year 112 --college MGT
                </code>
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {views.map(({ id, v }) => {
                  const total = v?.items.length ?? 0;
                  // 只算「通過」：需要修正、退回都還不能鎖版
                  const ids = new Set(v?.items.map((i) => i.id));
                  const done = v?.record.decisions.filter((d) => d.status === "approved" && ids.has(d.itemId)).length ?? 0;
                  return (
                    <li key={id} style={{ marginBottom: 6 }}>
                      <a href={`/review/${id}`}>{id}</a>
                      <span style={{ color: "var(--text-3)", fontSize: 12.5, marginLeft: 8 }}>
                        {done}/{total} 項已通過
                        {v?.record.lockedAt ? `　已於 ${v.record.lockedAt.slice(0, 10)} 鎖版` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
