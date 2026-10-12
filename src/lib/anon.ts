/**
 * 匿名展示模式（初賽匿名審查用）。
 *
 * 競賽辦法：初賽的簡報、影片、檔名不得出現學校、系所、指導教師或可辨識隊伍身分的標誌。
 * 系統用的是真實學校的真實資料 —— 匿名模式不換資料，只在畫面顯示前把會洩漏身分的字換掉，
 * 截圖與錄影就不用逐格打碼。
 *
 * 預設開啟（公開網站、公開 repo 一律匿名）；網址加 ?anon=0 關閉（記在 cookie，換頁維持），?anon=1 再打開。
 * 替換只發生在瀏覽器顯示層；伺服器、資料庫、trace 都不受影響。
 * 會帶出真名的連結（學校網站、/api 下的原始資料）在匿名模式下停用。
 */

export const ANON_COOKIE = "aidit-anon";

/** 依序替換：長的先換，避免「輔仁大學」先被「輔仁」吃掉一半 */
export const ANON_REPLACEMENTS: [string, string][] = [
  ["輔仁大學", "A 大學"],
  ["輔大", "A 大學"],
  ["輔仁", "A 大學"],
  // 校內建築與所在地也認得出學校（2026-10-12 原文出處截圖出現「利瑪竇大樓LM306」）
  ["利瑪竇大樓", "行政大樓"],
  ["利瑪竇", "行政大樓"],
  ["新莊好學", "在地好學"],
  ["全人教育課程中心", "共同課程中心"],
  ["全人教育", "共同教育"],
  ["全人課程", "共同課程"],
  // 系所代碼：trace 上寫「111 學年度 IM（日）」
  [" IM（", " B（"],
  [" PH（", " D（"],
  ["資訊管理學系", "B 學系"],
  ["資訊管理研究所", "B 研究所"],
  ["資訊管理", "B 學系"],
  ["資管系", "B 系"],
  ["資管", "B 系"],
  ["管理學院", "C 學院"],
  ["物理學系", "D 學系"],
  ["物理系", "D 系"],
  ["光電物理組", "甲組"],
  ["理工學院", "E 學院"],
  ["fju-phoe-112", "school-a-d-112"],
  ["fju-im-111", "school-a-111"],
  ["FJU", "A"],
  ["fju", "school-a"],
];

/** 匿名模式下停用的連結：學校網站（網址帶校名）、/api 下的原始資料（JSON、原文，不經顯示層替換） */
// 原文下載（/api/corpus）放行：伺服器端依同一個 cookie 遮好再給（app/api/corpus）
export const ANON_BLOCKED_HREF = /fju\.edu\.tw|\/api\/(?!corpus\/)/i;

/** 網址裡的示範學生代號改用別名（lib/ui/params.ts 收到時換回來） */
export const anonUrl = (s: string) => s.replace(/([?&]fixture=)fju-/g, "$1school-a-");

/** 教師姓名一律換成這個 */
export const ANON_TEACHER = "○老師";

/** 前置腳本：在第一次繪製前決定要不要先藏起畫面，避免真名閃一下 */
export const ANON_BOOT_SCRIPT = `(function(){try{
var q=new URLSearchParams(location.search).get("anon");
if(q==="0")document.cookie="${ANON_COOKIE}=0;path=/;max-age=31536000;samesite=lax";
if(q==="1")document.cookie="${ANON_COOKIE}=;path=/;max-age=0;samesite=lax";
if(!/(?:^|; )${ANON_COOKIE}=0/.test(document.cookie))document.documentElement.setAttribute("data-anon","");
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
