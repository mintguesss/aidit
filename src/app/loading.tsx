import { Spinner } from "@/components/shell/Spinner";

/**
 * 換頁時的載入畫面（導覽列切換、點課表上的課程到課綱頁、切換案例…）。
 *
 * 每一頁都要在伺服器重算審查，冷啟動或換案例時要等幾秒。以前這段時間畫面完全沒反應，
 * 使用者會以為沒點到、再點一次。Next 會在點下連結的當下顯示這個畫面，算好再換成真正的頁面。
 */
export default function Loading() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <span className="brand-mark">Aidit</span>
        </div>
      </header>
      <main className="page-loading">
        <Spinner label="載入中，正在依修課紀錄重新計算…" size={22} />
        <div className="skel">
          <i style={{ width: "38%" }} />
          <i style={{ width: "92%", height: 84 }} />
          <i style={{ width: "92%", height: 160 }} />
        </div>
      </main>
    </>
  );
}
