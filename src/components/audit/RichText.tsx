import { Fragment } from "react";

/**
 * 判定結論句中的 <b> 強調。
 *
 * 刻意不用 dangerouslySetInnerHTML：結論句由引擎組出，
 * 但其中夾帶的課名與類別名來自資料，不該有機會變成標記。
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(<b>[\s\S]*?<\/b>)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^<b>([\s\S]*)<\/b>$/.exec(p);
        return m ? <b key={i}>{m[1]}</b> : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
