/** 內部頁的頂條：品牌、規則校對與學生試用的切換、登入的人與登出 */
export function ReviewTopbar({ reviewer, packId, current }: { reviewer?: string; packId?: string; current?: "review" | "trial" }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a href="/" className="brand-mark" title="回到系統首頁">
          Aidit
        </a>
        {reviewer ? (
          <nav className="ad-topnav" aria-label="內部頁面">
            <a href="/review" className="ad-navlink" aria-current={current === "review" ? "page" : undefined}>
              規則校對
            </a>
            <a href="/trial" className="ad-navlink" aria-current={current === "trial" ? "page" : undefined}>
              學生試用
            </a>
          </nav>
        ) : null}
        <span className="topbar-right">
          {packId ? <span className="term">{packId}</span> : null}
          {reviewer ? (
            <>
              <span className="who">{reviewer}</span>
              <form action="/api/review/logout" method="post" style={{ display: "inline" }}>
                <button type="submit" className="linkbtn">
                  登出
                </button>
              </form>
            </>
          ) : null}
        </span>
      </div>
    </header>
  );
}
