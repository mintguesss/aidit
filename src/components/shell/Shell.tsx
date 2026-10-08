import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { Nav, type NavItem } from "./Nav";
import { FixtureSwitch } from "./FixtureSwitch";
import { PrefLifecycle } from "./PrefLifecycle";
import type { AuditSession } from "@/lib/audit/session";
import type { FixtureId } from "@/lib/providers/fixtures";

/**
 * 全站外殼：頂條（品牌＋導覽＋次要入口）→ 內容 → 頁尾。
 *
 * **橫條只剩一條。** 先前依序是頂條、導覽列、身分列、資料列，再加每一頁自己的
 * 標題卡，等於在內容之前疊了五層裝置 —— 每一層都有邊框與底色，看起來就是亂。
 *
 * 現在的作法：
 *   1. 導覽直接長在品牌條裡（`.topnav`），不另外佔一條橫列；
 *   2. 學籍資料不在每一頁重複：頂條只放**姓名**（點進去就是個人資料頁），
 *      學號、系級、學制、適用規劃表版本都在 /profile；
 *   3. 判定依據的規劃表版本與評測案例切換放在頁尾 ——
 *      前者是稽核資訊、後者是評測工具，兩者都不該在每一頁的正上方跟內容搶位置；
 *   4. 頁面標題（`PageHead`）不再是一張卡片，就是標題與導言本身。
 *
 * 於是使用者看到的是「一條深色列 → 這一頁叫什麼 → 內容」。
 */
export function Shell({
  session,
  fixture,
  term,
  children,
}: {
  session: AuditSession;
  fixture: FixtureId;
  term: string;
  children: ReactNode;
}) {
  const { outcome } = session;
  const audit = outcome.ok ? outcome.audit : null;
  const student = outcome.ok ? outcome.audit.student : outcome.state.record?.student;
  const search = `?fixture=${fixture}&term=${term}`;

  // 導覽只留五項主要功能。執行紀錄與個人資料屬於次要入口，
  // 放在身分列與頁尾即可 —— 導覽列塞滿八個項目，等於每一項都不重要。
  const items: NavItem[] = [
    { href: "/", label: "首頁" },
    { href: "/audit", label: "修業明細" },
    { href: "/holds", label: "待確認", count: audit?.holds.length ?? 0, tone: "hold" },
    { href: "/plan", label: "選課建議" },
    { href: "/assistant", label: "修業問答" },
    { href: "/scenario", label: "情境試算" },
  ];

  return (
    <>
      <PrefLifecycle status={student?.status} />
      <header className="topbar">
        <div className="topbar-in">
          <Link className="brand-mark" href={`/${search}`}>
            Aidit
          </Link>
          <Suspense fallback={<nav className="topnav" aria-hidden />}>
            <Nav
              items={items}
              // 個人資料（右上角姓名）、執行紀錄（右上角）、資料與隱私（頁尾）都有固定入口，不再重複。
              // 適用規劃表與原文出處都是「判定依據的文件」，合成一個入口，兩頁互相連結
              more={[
                { href: "/rulepack", label: "規劃表與原文" },
                // 內部作業：規則包的人工校對與鎖版，要登入
                { href: "/review", label: "規則校對" },
              ]}
            />
          </Suspense>
          <span className="topbar-right">
            <span className="term">{audit?.currentTerm ?? term}</span>
            <Link href={`/profile${search}`} className="who">
              {student?.displayName ?? "個人資料"}
            </Link>
            <Link href={`/trace${search}`}>執行紀錄</Link>
          </span>
        </div>
      </header>

      <div className="wrap">
        <div className="content">{children}</div>
      </div>

      {/* 免責與資料來源集中在 /about。每一頁都鋪滿四行小字，只會讓人一行都不看 */}
      {/* 每一頁都鋪四段小字，等於一段都不會被看。時間戳與完整聲明都在 /about */}
      <div className="foot">
        <hr />
        <span className="warn">僅供修業規劃參考，不作為畢業資格證明。</span>
        <Link href={`/about${search}`}>資料來源與免責聲明</Link>
        <Link href={`/privacy${search}`}>資料與隱私</Link>
      </div>
      <div className="foot-tools">
        <Suspense fallback={null}>
          <FixtureSwitch current={fixture} />
        </Suspense>
      </div>

    </>
  );
}

/** 各功能頁共用的標題列 */
export function PageHead({
  title,
  stamp,
  lead,
}: {
  title: string;
  stamp?: string;
  lead?: ReactNode;
}) {
  return (
    <div className="pagehead">
      <div className="head-top">
        <h1>{title}</h1>
        {stamp ? <span className="stamp">{stamp}</span> : null}
      </div>
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  );
}

