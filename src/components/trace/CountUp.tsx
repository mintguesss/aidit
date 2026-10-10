"use client";

import { useEffect, useState } from "react";

/** 數字從 0 滾到目標值。伺服器端與減少動態偏好時直接顯示終值 */
export function CountUp({ to, decimals = 0, ms = 700 }: { to: number; decimals?: number; ms?: number }) {
  const [v, setV] = useState(to);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || to === 0) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    setV(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);

  return <>{v.toFixed(decimals)}</>;
}
