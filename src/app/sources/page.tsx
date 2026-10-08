import Link from "next/link";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { allSources } from "@/lib/rules/sources";
import { SourceHighlight } from "@/components/sources/SourceHighlight";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  plan: "課程規劃表",
  regulation: "學則",
  announcement: "公告",
  extra: "輔系／雙主修／學程規定",
};

/**
 * 原文出處。
 *
 * 所有被引用的條文集中在這裡，每一段有固定錨點；各頁的結論只放一個短連結指過來。
 * 依據沒有變少，只是換了地方放 —— 而且在這裡看得到同一份文件的其他條文與前後脈絡，
 * 對查核反而更有用。
 */
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const docs = allSources();
  const total = docs.reduce((a, d) => a + d.passages.length, 0);

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title="原文出處"
        stamp={`${docs.length} 份文件・${total} 條引用`}
        lead={
          <>
            判定所引用的每一段原文都在這裡。各頁的「依據」連結會直接跳到對應的段落。目前套用哪一版規劃表見{" "}
            <Link href={`/rulepack?fixture=${fixture}&term=${term}`}>適用規劃表</Link>。
          </>
        }
      />

      <SourceHighlight />

      <nav className="src-toc">
        {docs.map((d) => (
          <a key={d.id} href={`#doc-${d.id}`}>
            {d.shortTitle}
            <em>{d.passages.length}</em>
          </a>
        ))}
      </nav>

      {docs.map((d) => (
        <section className="panel" id={`doc-${d.id}`} key={d.id}>
          <div className="panel-hd">
            <h2>{d.title}</h2>
            <span className="hint">
              {KIND_LABEL[d.kind] ?? d.kind}
              {d.publishedAt ? `・${d.publishedAt} 版` : ""}
              {d.provenance === "synthetic" ? "・合成" : ""}
            </span>
            {d.hasCorpus ? (
              <a className="src-dl" href={`/api/corpus/${d.id}`} download>
                下載全文
              </a>
            ) : null}
          </div>

          {d.passages.length === 0 ? (
            <p className="src-foot" style={{ padding: "14px 18px" }}>
              本次判定未引用這份文件的條文。
            </p>
          ) : (
            <ul className="src-list">
              {d.passages.map((p) => (
                <li id={p.anchor} key={p.anchor}>
                  <div className="src-loc">{p.locator}</div>
                  {p.quote ? (
                    <blockquote>{p.quote}</blockquote>
                  ) : (
                    <blockquote className="none">本欄位未留存原文片段，無法回查原文。</blockquote>
                  )}
                  <div className="src-used">用於　{p.usedBy.join("、")}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className="lead">
        引用是否對得上原文，由 <code>citation.verify</code> 在每次判定時逐條回查；
        對不上的結論會降級為待確認事項。過程見{" "}
        <Link href={`/trace?fixture=${fixture}&term=${term}`}>執行紀錄</Link>。
      </p>
    </Shell>
  );
}
