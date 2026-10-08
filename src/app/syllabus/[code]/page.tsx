import Link from "next/link";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { allOfferings, categoriesFor, fetchedAt, remainingSeats } from "@/lib/offerings";
import { fetchOutline, outlineUrl } from "@/lib/offerings/outline";
import type { Offering } from "@/lib/types";
import { formatSlots } from "@/lib/solver/slots";
import { periodScheme, periodLabel } from "@/lib/offerings/period-scheme";

export const dynamic = "force-dynamic";

/**
 * 課程大綱。
 *
 * 開課資料（系統手上真的有的欄位），加上學校課程大綱系統的大綱（打開這一頁時才去抓，快取一天，
 * 見 lib/offerings/outline.ts）。抓不到大綱就照實說，並給學校大綱頁的連結。
 */
export default async function SyllabusPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fixture?: string; term?: string; sec?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const { fixture, term } = parsePageParams(sp);
  const session = await getAuditSession(fixture, term);
  const search = `?fixture=${fixture}&term=${term}`;
  const audit = session.outcome.ok ? session.outcome.audit : null;
  const pack = session.outcome.ok ? session.outcome.state.pack : undefined;

  const o = pickOffering(code, sp.sec, audit?.student.school ?? undefined, audit?.nextTerm, audit?.student.dept);
  const outline = o ? await fetchOutline(o) : null;
  const catName = new Map((audit?.categories ?? []).map((c) => [c.id, c.name]));
  const categories = o ? (pack ? categoriesFor(o, pack) : o.category).map((id) => catName.get(id) ?? id) : [];
  // 人數未知時為 null（系上課表沒有人數），畫面上要明講，不能印出 undefined
  const seats = o ? remainingSeats(o) : null;

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title={o ? o.name : "查無此課程"}
        stamp={o ? o.code : undefined}
        lead={
          o
            ? `${o.year}-${o.term} 開課資料${outline ? "與課程大綱" : ""}。內容以學校公告為準。`
            : `開課資料中查無課號 ${code}。`
        }
      />

      {o ? (
        <>
          <section className="panel">
            <div className="panel-hd">
              <h2>開課資訊</h2>
              <span className="hint">抓取時間 {fmt(fetchedAt(o.school))}</span>
            </div>
            <div className="panel-bd">
              <div className="fieldgrid">
                <F k="課號" v={o.code} mono />
                <F k="學分" v={String(o.credits)} />
                <F k="授課教師" v={o.teacher} />
                <F k="開課單位" v={`${o.dept}／${o.college}`} />
                <F
                  k="時段"
                  v={
                    o.slotsUnknown
                      ? `無法解析（原始字串：${o.rawSlotText ?? "—"}）`
                      : // 「一 D5-D7」的「一」看起來像破折號，頁面上寫成「星期一」
                        formatSlots(o.slots, false, (p) => periodLabel(periodScheme(o.school), p)).replace(
                          /(^|\/ )([一二三四五六日]) /g,
                          "$1星期$2 ",
                        )
                  }
                />
                {o.rooms?.length ? <F k="教室" v={o.rooms.join("、")} /> : null}
                {o.language ? <F k="授課語言" v={o.language} /> : null}
                {o.tags?.length ? <F k="課程標籤" v={o.tags.join("、")} /> : null}
                <F k="修課名額" v={o.capacity !== undefined ? `${o.capacity} 人（已選人數學校未公開）` : "開課資料未提供"} />
                <F k="可採計類別" v={categories.join("、") || "不採計"} />
                {o.generalDomain ? <F k="通識領域" v={o.generalDomain} /> : null}
                <F k="原始時段字串" v={o.rawSlotText ?? "—"} mono />
                {seats !== null ? <F k="修課餘額" v={`${seats}／${o.capacity}`} /> : null}
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

          <OutlinePanel o={o} outline={outline} />

          <section className="panel">
            <div className="panel-hd">
              <h2>先修條件</h2>
              <span className="hint">來源信心會標示，低信心者不據以排除課程</span>
            </div>
            <div className="panel-bd">
              {outline?.prerequisite ? (
                <ul className="prereqs">
                  <li>
                    <span className="code">{outline.prerequisite}</span>
                    <span className="tag hold">課程大綱原文</span>
                    <div className="src">老師在大綱上寫的先修課程。是文字說明，系統只提示、不會因此排除課程。</div>
                  </li>
                </ul>
              ) : null}
              {o.prerequisites.length === 0 ? (
                outline?.prerequisite ? null : <p className="lead">開課資料與課程大綱都沒有載明先修條件。</p>
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

/**
 * 找課表上那一班：有帶班級編號（sec）就用它；沒有就找學生下學期、自己學校的那門課，
 * 最後才退回任何一班。以前直接取「第一個同課號的」，微積分這種好幾班、好幾學期的課會顯示錯的那一班
 */
function pickOffering(
  code: string,
  sec: string | undefined,
  school: string | undefined,
  nextTerm: string | undefined,
  dept?: string,
): Offering | undefined {
  const same = allOfferings().filter((x) => x.code.toUpperCase() === code.toUpperCase());
  if (sec) {
    const hit = same.find((x) => String(x.outline?.id) === sec);
    if (hit) return hit;
  }
  const [y, t] = (nextTerm ?? "").split("-").map(Number);
  return (
    // 有本系保留班的課（人生哲學、大學入門）先找本系的班，別系的班學生選不到
    same.find((x) => x.school === school && x.year === y && x.term === t && x.dept === dept) ??
    same.find((x) => x.school === school && x.year === y && x.term === t) ??
    same.find((x) => x.school === school) ??
    same[0]
  );
}

function OutlinePanel({ o, outline }: { o: Offering; outline: Awaited<ReturnType<typeof fetchOutline>> }) {
  const url = outlineUrl(o);
  if (!url) return null;
  if (!outline) {
    return (
      <section className="panel">
        <div className="panel-hd">
          <h2>課程大綱</h2>
        </div>
        <div className="panel-bd">
          <p className="lead">
            目前抓不到這一班的大綱（老師可能還沒填，或學校系統暫時連不上）。
            <a href={url} target="_blank" rel="noreferrer">
              到學校課程大綱系統查看
            </a>
          </p>
        </div>
      </section>
    );
  }
  const pct = (xs: { name: string; percent: number }[]) => xs.map((x) => `${x.name} ${x.percent}%`).join("、");
  return (
    <section className="panel">
      <div className="panel-hd">
        <h2>課程大綱</h2>
        <span className="hint">
          來源：
          <a href={url} target="_blank" rel="noreferrer">
            輔仁大學課程大綱系統
          </a>
        </span>
      </div>
      <div className="panel-bd ol-body">
        {outline.objective ? <Block k="教學目標" v={outline.objective} /> : null}
        {outline.grading.length ? <Block k="評分方式" v={pct(outline.grading)} /> : null}
        {outline.teaching.length ? <Block k="教學方法" v={pct(outline.teaching)} /> : null}
        {outline.textbook ? <Block k="教科書" v={outline.textbook} /> : null}
        {outline.references ? <Block k="參考書目" v={outline.references} /> : null}
        {outline.weeks.length ? (
          <div className="ol-block">
            <div className="field-k">每週進度</div>
            <ol className="ol-weeks">
              {outline.weeks.map((w) => (
                <li key={w.week}>
                  <span className="wk">第 {w.week} 週</span>
                  {w.topic}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Block({ k, v }: { k: string; v: string }) {
  return (
    <div className="ol-block">
      <div className="field-k">{k}</div>
      <div className="ol-text">{v}</div>
    </div>
  );
}
