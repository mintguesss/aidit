/**
 * 轉圈圈。按鈕裡、勾選框旁邊、整頁載入都用這一個，外觀一致。
 * 純 CSS，伺服器端也畫得出來。
 */
export function Spinner({ label, size = 14 }: { label?: string; size?: number }) {
  return (
    <span className="spin-wrap" role="status" aria-live="polite">
      <span className="spin" style={{ width: size, height: size }} aria-hidden />
      {label ? <span className="spin-label">{label}</span> : <span className="sr-only">載入中</span>}
    </span>
  );
}
