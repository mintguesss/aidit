/**
 * 匿名展示模式（初賽匿名審查用）。
 *
 * 競賽辦法：初賽的簡報、影片、檔名不得出現學校、系所、指導教師或可辨識隊伍身分的標誌。
 * 系統用的是真實學校的真實資料 —— 匿名模式不換資料，只在畫面顯示前把會洩漏身分的字換掉，
 * 截圖與錄影就不用逐格打碼。
 *
 * 開關：網址加 ?anon=1 開啟（記在 cookie，換頁維持），?anon=0 關閉。
 * 替換只發生在瀏覽器顯示層；伺服器、資料庫、trace 都不受影響。
 */

export const ANON_COOKIE = "aidit-anon";

/** 依序替換：長的先換，避免「輔仁大學」先被「輔仁」吃掉一半 */
export const ANON_REPLACEMENTS: [string, string][] = [
  ["輔仁大學", "A 大學"],
  ["輔大", "A 大學"],
  ["輔仁", "A 大學"],
  ["全人教育課程中心", "共同課程中心"],
  ["全人教育", "共同教育"],
  ["資訊管理學系", "B 學系"],
  ["資訊管理研究所", "B 研究所"],
  ["資訊管理", "B 學系"],
  ["資管系", "B 系"],
  ["資管", "B 系"],
  ["管理學院", "C 學院"],
  ["fju-im-111", "school-a-111"],
  ["FJU", "A"],
  ["fju", "school-a"],
];

/** 教師姓名一律換成這個 */
export const ANON_TEACHER = "○老師";

/** 前置腳本：在第一次繪製前決定要不要先藏起畫面，避免真名閃一下 */
export const ANON_BOOT_SCRIPT = `(function(){try{
var q=new URLSearchParams(location.search).get("anon");
if(q==="1")document.cookie="${ANON_COOKIE}=1;path=/;max-age=31536000;samesite=lax";
if(q==="0")document.cookie="${ANON_COOKIE}=;path=/;max-age=0;samesite=lax";
if(/(?:^|; )${ANON_COOKIE}=1/.test(document.cookie))document.documentElement.setAttribute("data-anon","");
}catch(e){}})();`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 把替換表與教師名單編成一個函式；教師名單長，用一個正規式一次比對 */
export function makeAnonymizer(teachers: string[]): (s: string) => string {
  const names = [...new Set(teachers.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  const teacherRe = names.length ? new RegExp(names.map(escape).join("|"), "g") : null;
  return (s: string) => {
    let out = s;
    for (const [from, to] of ANON_REPLACEMENTS) if (out.includes(from)) out = out.split(from).join(to);
    if (teacherRe) out = out.replace(teacherRe, ANON_TEACHER);
    return out;
  };
}
