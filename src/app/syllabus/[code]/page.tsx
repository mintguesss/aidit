import Link from "next/link";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { allOfferings, fetchedAt } from "@/lib/offerings";
import { formatSlots } from "@/lib/solver/slots";

export const dynamic = "force-dynamic";

/**
 * 課程大綱。
 *
 * 這一頁只呈現**系統手上真的有的**開課資料：時段、學分、教師、餘額、採計類別、
 * 先修條件與其來源信心。正式的課程大綱在學校的課程查詢系統，這裡不假裝是它。
 */
export default async function SyllabusPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { code } = await params;
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const search = `?fixture=${fixture}&term=${term}`;

  const o = allOfferings().find((x) => x.code.toUpperCase() === code.toUpperCase());

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title={o ? o.name : "查無此課程"}
        stamp={o ? o.code : undefined}
        lead={
          o
            ? `${o.year}-${o.term} 開課資料。以下為本系統於抓取時取得的欄位，正式課程大綱以學校課程查詢系統公告為準。`
            : `開課資料中查無課號 ${code}。`
        }
      />

      {o ? (
        <>
          <section className="panel">
            <div className="panel-hd">
              <h2>開課資訊</h2>
              <span className="hint">抓取時間 {fmt(fetchedAt())}</span>
            </div>
            <div className="panel-bd">
              <div className="fieldgrid">
                <F k="課號" v={o.code} mono />
                <F k="學分" v={String(o.credits)} />
                <F k="授課教師" v={o.teacher} />
                <F k="開課單位" v={`${o.dept}／${o.college}`} />
                <F
                  k="時段"
                  v={o.slotsUnknown ? `無法解析（原始字串：${o.rawSlotText ?? "—"}）` : formatSlots(o.slots)}
                />
                <F k="修課餘額" v={`${Math.max(0, o.capacity - o.enrolled)}／${o.capacity}`} />
                <F k="可採計類別" v={o.category.join("、")} />
                {o.generalDomain ? <F k="通識領域" v={o.generalDomain} /> : null}
                <F k="原始時段字串" v={o.rawSlotText ?? "—"} mono />
                <F k="修課人數" v={`${o.enrolled}／${o.capacity}`} />
              </div>
              <p className="panel-foot">
                以上欄位由原始開課資料正規化而來。
                <a href={`/api/offering/${o.code}`} download>
                  下載原始檔（JSON）
                </a>
                　可核對系統看到的與課程查詢系統上的是不是同一件事：抓取時間、未正規化的時段字串、
                大綱裡的先修文字都在裡面。
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-hd">
              <h2>先修條件</h2>
              <span className="hint">來源信心會標示，低信心者不據以排除課程</span>
            </div>
            <div className="panel-bd">
              {o.prerequisites.length === 0 ? (
                <p className="lead">開課資料未載明先修條件。</p>
              ) : (
                <ul className="prereqs">
                  {o.prerequisites.map((p, i) => (
                    <li key={i}>
                      <span className="code">{p.codes.join("、") || "（未列課號）"}</span>
                      <span className={`tag ${p.confidence === "explicit" ? "ok" : "hold"}`}>
                        {p.confidence === "explicit"
                          ? "結構化欄位"
                          : p.confidence === "extracted"
                            ? "由大綱文字抽取"
                            : "來源不明"}
                      </span>
                      {p.sourceText ? <div className="src">原文：{p.sourceText}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="panel-foot">
                只有<b>結構化欄位</b>取得的先修條件會被當成硬限制；由大綱文字抽取的僅作提示，
                因為那是自然語言的判讀，錯了會害學生少修一門可以修的課。
              </p>
            </div>
          </section>

          <p className="lead">
            <Link href={`/plan${search}`}>← 回選課建議</Link>
          </p>
        </>
      ) : (
        <div className="empty">
          請確認課號，或回<Link href={`/plan${search}`}>選課建議</Link>頁重新點選。
        </div>
      )}
    </Shell>
  );
}

function F({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="field">
      <div className="field-k">{k}</div>
      <div className={`field-v${mono ? " mono" : ""}`}>{v}</div>
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
