"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 彈出視窗。用原生 <dialog>：焦點鎖定、Esc 關閉、背景不可互動都由瀏覽器處理。
 *
 * 關閉的方式跟裝置走：
 *   桌機  右上角的圓形關閉鍵（滑過時 × 會轉一圈）、Esc、點視窗外的暗處
 *   手機  視窗從底部滑上來，像抽屜；抓住頂端的把手往下拉就關，或點把手
 */
export function Modal({
  open,
  onClose,
  title,
  sub,
  actions,
  children,
  size = "wide",
}: {
  /** wide：課表這種寬內容；narrow：信件這種窄內容 */
  size?: "wide" | "narrow";
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 標題旁的小字（學期、版本） */
  sub?: ReactNode;
  /** 標題列右側的動作（匯出、切換檢視） */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) setDrag(0);
  }, [open]);

  // 往下拉的手勢：只看垂直位移，拉超過 90px 放開就關，不到就彈回去
  const onDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    setDrag(Math.max(0, e.clientY - startY.current));
  };
  const onUp = () => {
    if (startY.current === null) return;
    const moved = drag;
    startY.current = null;
    if (moved > 90) onClose();
    else if (moved < 6) onClose(); // 單純點一下把手
    setDrag(0);
  };

  return (
    <dialog
      ref={ref}
      className={`modal ${size}`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // 內層填滿整個視窗框，點到 dialog 本身就是點到外面的暗處
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div
          className={`modal-in${drag > 0 ? " dragging" : ""}`}
          style={drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
        >
          <button
            type="button"
            className="modal-grip"
            aria-label="往下拉或點一下關閉"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => {
              startY.current = null;
              setDrag(0);
            }}
          >
            <span />
          </button>
          <div className="modal-hd">
            <h2>{title}</h2>
            {sub ? <span className="modal-sub">{sub}</span> : null}
            <span className="modal-act">{actions}</span>
            <button type="button" className="modal-x" aria-label="關閉" onClick={onClose}>
              <span className="modal-x-ic" aria-hidden />
              <kbd className="modal-x-key" aria-hidden>
                Esc
              </kbd>
            </button>
          </div>
          <div className="modal-bd">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
