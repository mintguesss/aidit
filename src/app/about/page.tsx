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

  return (
    <Shell session={session} fixture={fixture} term={term}>
      <PageHead
        title="資料來源與免責聲明"
        lead="這套系統做什麼、不做什麼、資料從哪裡來、留存多久。"
      />

      <section className="panel">
        <div className="panel-hd">
          <h2>效力</h2>
        </div>
        <div className="panel-bd">
          <p className="notice-strong">本頁資料僅供修業規劃參考，不作為畢業資格證明。</p>
          <p className="lead">
            實際畢業資格以教務處審查結果為準。如對審查結果有疑義，請洽系辦公室或教務處註冊組。
            本系統<b>不代為執行選課、申請或任何校務系統寫入操作</b>，也不會儲存你的帳號密碼或代為登入。
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2>資料來源與時間</h2>
        </div>
        <div className="panel-bd">
          <div className="fieldgrid">
            <div className="field">
              <div className="field-k">修課紀錄</div>
              <div className="field-v">{audit ? fmt(audit.fetchedAt) : "—"}</div>
            </div>
            <div className="field">
              <div className="field-k">開課資料</div>
              <div className="field-v">{fmt(fetchedAt())}</div>
            </div>
            <div className="field">
              <div className="field-k">判定依據</div>
              <div className="field-v">
                {audit ? `${audit.student.admissionYear} 學年度規劃表 rev.${audit.rulePack.version}` : "—"}
              </div>
            </div>
            <div className="field">
              <div className="field-k">規則包來源</div>
              <div className="field-v">
                {audit?.rulePack.provenance === "approved"
                  ? "已人工校對並鎖版"
                  : audit?.rulePack.provenance === "synthetic"
                    ? "合成規則包（評測用）"
                    : "未校對草稿"}
              </div>
            </div>
          </div>
          <p className="panel-foot">
            版本不對可到 <Link href={`/rulepack${search}`}>適用規劃表</Link> 上傳你手上的那一版。
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2>個人資料的處理</h2>
        </div>
        <div className="panel-bd">
          <p className="lead">
            修課紀錄經學生本人授權後讀取，<b>僅於本次查詢期間處理，不留存於系統</b>。
            執行紀錄只保存去識別化的內容：學號以雜湊值取代，輸入與輸出經過個資清洗。
            你在「選課傾向」填的設定只存在這台裝置的瀏覽器裡（localStorage），不會上傳。
          </p>
          <p className="panel-foot">
            完整的執行過程可在 <Link href={`/trace${search}`}>執行紀錄</Link> 逐步查核。
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2>本站資料為合成內容</h2>
        </div>
        <div className="panel-bd">
          <p className="lead">
            這是評測與展示用的環境：學號、姓名、課程、教師與規章原文<b>均屬虛構</b>，
            規則包標示為「合成規則包」。任何畫面上的數字都不對應真實學生。
          </p>
        </div>
      </section>
    </Shell>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
