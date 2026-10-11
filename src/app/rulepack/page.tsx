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

  const prov = audit?.rulePack.provenance;
  // 圓裡放不下長句，拆成主詞＋小字兩行
  const provLabel: [string, string] =
    prov === "approved" ? ["已校對", "人工鎖版"] : prov === "synthetic" ? ["合成規則包", "評測用"] : ["草稿", "尚未校對"];

  return (
    <Shell session={session} fixture={fixture} term={term}>
      {/* 標題也放進同一欄置中，跟下面的內容對齊 */}
      <div className="rp">
        <PageHead title="適用規劃表" lead="你的學分是照哪一版規定算的，以及版本不對時怎麼換。" />
        {/* 重點只有一個：現在用的是哪一版 —— 正中央最大的圓。
            其他資訊是繞著它的小圓，大小不一、不排成一直線，各自輕輕浮動。
            圓只放資訊、不放連結，連結在下面一列 */}
        {audit ? (
          <section className="orbit" aria-label="你的學分判定依據">
            <div className="orbit-canvas">
              <span className="orbit-ring r1" aria-hidden />
              <span className="orbit-ring r2" aria-hidden />
              <div className="ob ob-main">
                <span className="ob-k">你的學分判定依據</span>
                <span className="ob-year">
                  <b>{audit.student.admissionYear}</b>學年度
                </span>
                <span className="ob-dept">{audit.student.dept}課程規劃表</span>
                <span className="ob-why">依入學學年自動選用</span>
              </div>
              <div className="ob ob-min">
                <span>畢業最低</span>
                <b>{audit.minCredits}</b>
                <span>學分</span>
              </div>
              <div className={`ob ob-prov ${prov}`}>
                <b>{provLabel[0]}</b>
                <span>{provLabel[1]}</span>
              </div>
              <div className="ob ob-ver">
                <code>{audit.rulePack.id}</code>
                <code>rev.{audit.rulePack.version}</code>
              </div>
              {/* 純裝飾的小點，讓構圖不只是四個圓 */}
              <span className="ob-dot d1" aria-hidden />
              <span className="ob-dot d2" aria-hidden />
              <span className="ob-dot d3" aria-hidden />
            </div>
            {/* 可以點的東西不放在圓裡：圓是「資訊」，這一列才是「連結」，兩者外觀分開 */}
            <nav className="rp-jump" aria-label="相關頁面">
              <span className="rp-jump-lb">相關頁面</span>
              <Link href={`/sources${search}`}>
                <b>原文出處</b>
                <span>每條規定的原文</span>
              </Link>
              <Link href={`/audit${search}`}>
                <b>修業明細</b>
                <span>每一類怎麼判定的</span>
              </Link>
              <Link href={`/trace${search}`}>
                <b>執行紀錄</b>
                <span>完整的判定過程</span>
              </Link>
            </nav>
          </section>
        ) : (
          <section className="rp-hero">
            <div className="rp-k">你的學分判定依據</div>
            <p className="rp-why">本案已轉人工審查，未套用任何規劃表版本。</p>
          </section>
        )}

        <section className="rp-up">
          <h2>版本不對？</h2>
          <p className="rp-up-lead">上傳你手上的規劃表。它要走完下面四步才會拿來判定學分。</p>
          <ol className="rp-steps">
            <li className="you">
              <span className="n">1</span>
              <b>上傳</b>
              <span>你在這裡做</span>
            </li>
            <li className="you">
              <span className="n">2</span>
              <b>結構檢查</b>
              <span>上傳後馬上告訴你</span>
            </li>
            <li>
              <span className="n">3</span>
              <b>人工校對鎖版</b>
              <span>承辦人逐條對原文</span>
            </li>
            <li className="go">
              <span className="n">4</span>
              <b>開始生效</b>
              <span>之前一律不參與判定</span>
            </li>
          </ol>
          <RulePackUpload />
        </section>
      </div>
    </Shell>
  );
}
