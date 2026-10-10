import Link from "next/link";
import { getAuditSession } from "@/lib/audit/session";
import { parsePageParams } from "@/lib/ui/params";
import { Shell, PageHead } from "@/components/shell/Shell";
import { fetchedAt } from "@/lib/offerings";

export const dynamic = "force-dynamic";

/**
 * 資料來源與免責聲明。
 *
 * 這些話每一句都必須說，但不必每一頁都說一次 ——
 * 擠在每一頁的頁尾只會讓人一句都不看。集中一頁，頁尾留一行連過來。
 */
export default async function AboutPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; term?: string }>;
}) {
  const { fixture, term } = parsePageParams(await searchParams);
  const session = await getAuditSession(fixture, term);
  const { outcome } = session;
  const search = `?fixture=${fixture}&term=${term}`;
  const audit = outcome.ok ? outcome.audit : null;

  const prov =
    audit?.rulePack.provenance === "approved"
      ? "已人工校對並鎖版"
      : audit?.rulePack.provenance === "synthetic"
        ? "合成規則包（評測用）"
        : "未校對草稿";

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead title="資料來源與免責聲明" lead="本系統的效力範圍、資料來源、個人資料之處理方式。" />

      {/* 最重要的一句單獨成塊，放在最上面 */}
      <div className="decl">
        <span className="decl-ic" aria-hidden>
          !
        </span>
        <div>
          <p className="decl-h">本系統之結果僅供修業規劃參考，不作為畢業資格證明。</p>
          <p className="decl-p">實際畢業資格以教務處審查結果為準。</p>
        </div>
      </div>

      <div className="legal">
        {/* 條文索引：桌機固定在左側 */}
        <nav className="legal-toc" aria-label="條文索引">
          <a href="#art-1">
            <span>一</span>效力
          </a>
          <a href="#art-2">
            <span>二</span>系統不做的事
          </a>
          <a href="#art-3">
            <span>三</span>資料來源與時間
          </a>
          <a href="#art-4">
            <span>四</span>個人資料之處理
          </a>
          <a href="#art-5">
            <span>五</span>本站資料性質
          </a>
        </nav>

        <div className="legal-body">
          <article className="art" id="art-1">
            <h2>
              <span className="art-no">第一條</span>效力
            </h2>
            <p className="art-key">本系統之判定不具行政效力。</p>
            <p>
              畫面上的學分計算、類別判定與選課建議，皆依規則包與修課紀錄推算，僅供修業規劃參考。
              如對審查結果有疑義，請洽系辦公室或教務處註冊組。
            </p>
          </article>

          <article className="art" id="art-2">
            <h2>
              <span className="art-no">第二條</span>系統不做的事
            </h2>
            <p className="art-key">本系統只提供資訊，不代替你做任何操作。</p>
            <ul className="art-list no">
              <li>不代為執行選課、加退選或任何申請</li>
              <li>不寫入任何校務系統</li>
              <li>不儲存你的帳號密碼，也不代為登入</li>
              <li>不預測成績、被當機率或錄取機會</li>
            </ul>
          </article>

          <article className="art" id="art-3">
            <h2>
              <span className="art-no">第三條</span>資料來源與時間
            </h2>
            <p className="art-key">每一項判定都能對應到下列資料與其取得時間。</p>
            <table className="art-table">
              <tbody>
                <tr>
                  <th>修課紀錄</th>
                  <td className="mono">{audit ? fmt(audit.fetchedAt) : "—"}</td>
                  <td>校務系統，經學生本人授權讀取</td>
                </tr>
                <tr>
                  <th>開課資料</th>
                  <td className="mono">{fmt(fetchedAt())}</td>
                  <td>下學期開課時段、教師與名額</td>
                </tr>
                <tr>
                  <th>判定依據</th>
                  <td className="mono">
                    {audit ? `${audit.student.admissionYear} 學年度 rev.${audit.rulePack.version}` : "—"}
                  </td>
                  <td>依學籍入學學年選用之課程規劃表</td>
                </tr>
                <tr>
                  <th>規則包狀態</th>
                  <td>{audit ? prov : "—"}</td>
                  <td>
                    版本不符可至 <Link href={`/rulepack${search}`}>適用規劃表</Link> 上傳
                  </td>
                </tr>
              </tbody>
            </table>
          </article>

          <article className="art" id="art-4">
            <h2>
              <span className="art-no">第四條</span>個人資料之處理
            </h2>
            <p className="art-key">修課紀錄只在本次查詢期間處理，不留存於系統。</p>
            <dl className="art-dl">
              <div>
                <dt>修課紀錄</dt>
                <dd>經學生本人授權後讀取，查詢結束即不再保留。</dd>
              </div>
              <div>
                <dt>執行紀錄</dt>
                <dd>
                  只保存去識別化內容：學號以雜湊值取代，輸入與輸出經個資清洗，保留 90 天。可於{" "}
                  <Link href={`/trace${search}`}>執行紀錄</Link> 逐步查核。
                </dd>
              </div>
              <div>
                <dt>選課傾向</dt>
                <dd>只存在這台裝置的瀏覽器（localStorage），不會上傳；可於個人資料頁隨時刪除。</dd>
              </div>
            </dl>
          </article>

          <article className="art" id="art-5">
            <h2>
              <span className="art-no">第五條</span>本站資料性質
            </h2>
            <p className="art-key">本站為評測與展示環境，資料均屬虛構。</p>
            <p>
              學號、姓名、課程、教師與規章原文均為合成內容，規則包標示為「合成規則包」。
              畫面上的任何數字都不對應真實學生。
            </p>
          </article>
        </div>
      </div>
    </Shell>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
