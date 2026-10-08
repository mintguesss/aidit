/** 校對頁的頂條：品牌、目前的草稿、登入的校對人與登出 */
export function ReviewTopbar({ reviewer, packId }: { reviewer?: string; packId?: string }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a href="/" className="brand-mark" title="回到系統首頁">
          Aidit
        </a>
        <span className="topbar-right">
          {packId ? <span className="term">{packId}</span> : null}
          {reviewer ? (
            <>
              <span className="who">校對人 {reviewer}</span>
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
