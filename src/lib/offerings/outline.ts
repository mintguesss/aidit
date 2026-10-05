import type { Offering } from "@/lib/types";

/**
 * 課程大綱（TODO C6）。
 *
 * 來源：輔大課程大綱系統（outline.fju.edu.tw）的「大綱檢視」，不需登入（前端路由的免登入白名單有它），
 * 兩台主機都沒有 robots.txt（2026-10-05 查過）。前端呼叫的是
 * travellerlink.fju.edu.tw/Outline/api/OutlineMaintain/{CourseInfoAndBook, CourseCP, CourseMethods}。
 *
 * **打開課綱頁時才抓那一門**，結果快取一天：六個學期幾千班全部預抓，照每次間隔 2 秒要好幾個小時，
 * 而且大多沒人看。快取用 Next 的資料快取（fetch 的 revalidate），跨執行個體共用，不必建表。
 *
 * 教師的電話、信箱、辦公時間不收：課綱頁用不到，也不轉存別人的聯絡資料。
 */

const API = "https://travellerlink.fju.edu.tw/Outline/api/OutlineMaintain";
const UA = "AiditCourseFetcher/0.1 (+https://aidit-weld.vercel.app/about)";
const DAY = 86_400;
const TIMEOUT_MS = 8_000;

export type Outline = {
  objective: string;
  /** 大綱上寫的先修課程（自然語言，只作提示，不據以排除課程） */
  prerequisite: string;
  textbook: string;
  references: string;
  weeks: { week: number; topic: string }[];
  teaching: { name: string; percent: number }[];
  grading: { name: string; percent: number }[];
  /** 學校大綱頁的網址，讓學生看原文 */
  url: string;
};

/** 學校大綱頁的網址（不用抓也給得出來） */
export function outlineUrl(o: Pick<Offering, "outline">): string | null {
  return o.outline ? `https://outline.fju.edu.tw/#/outlineSearch/outlineView/${o.outline.id}/1028` : null;
}

/** 抓不到（老師還沒填、學校主機掛了、逾時）回 null，課綱頁照樣顯示開課欄位 */
export async function fetchOutline(o: Pick<Offering, "outline">): Promise<Outline | null> {
  if (!o.outline) return null;
  const q = new URLSearchParams({
    jonCouSn: String(o.outline.id),
    tchNo: o.outline.tchNo,
    lcid: "1028",
    fromStu: "true",
  }).toString();
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`${API}/${path}?${q}`, {
      headers: { "User-Agent": UA, Referer: "https://outline.fju.edu.tw/" },
      next: { revalidate: DAY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  };
  try {
    const [info, cp, methods] = await Promise.all([get("CourseInfoAndBook"), get("CourseCP"), get("CourseMethods")]);
    return parseOutline(info, cp, methods, outlineUrl(o)!);
  } catch (e) {
    console.warn(`[aidit][outline] 抓不到大綱 ${o.outline.id}：${String(e)}`);
    return null;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/** 把學校的回應整理成課綱頁要的形狀。純函式，測試用 */
export function parseOutline(info: unknown, cp: unknown, methods: unknown, url: string): Outline | null {
  const i = (info ?? {}) as Record<string, unknown>;
  const weeks = (((cp ?? {}) as { weeklyCP?: { cweek: number; unit?: string; theme?: string }[] }).weeklyCP ?? [])
    .map((w) => ({ week: w.cweek, topic: text(w.theme) || text(w.unit) }))
    .filter((w) => w.topic);
  const groups = (Array.isArray(methods) ? methods : []) as {
    mType: number;
    methodsDetails?: { methodName: string; percent: number }[];
  }[];
  const pick = (type: number) =>
    (groups.find((g) => g.mType === type)?.methodsDetails ?? [])
      .filter((d) => d.percent > 0)
      .map((d) => ({ name: d.methodName, percent: d.percent }));

  const out: Outline = {
    objective: text(i.obj),
    prerequisite: text(i.preCourse),
    textbook: text(i.book),
    references: text(i.refBook),
    weeks,
    teaching: pick(1),
    grading: pick(2),
    url,
  };
  // 老師還沒填：什麼都沒有就當作沒有大綱
  const empty = !out.objective && !out.textbook && out.weeks.length === 0 && out.grading.length === 0;
  return empty ? null : out;
}
