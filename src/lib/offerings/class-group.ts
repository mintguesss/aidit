/**
 * 開課班級：這一班開給誰（TODO C7）。
 *
 * 輔大的開課資料每一班都有「開課班級」（avaDptCNa），實際寫法（2026-10 對 111-2～115-1 的資料看過）：
 *   資管二甲、資管二乙      本系的甲乙班。學生只能修自己那一班
 *   資管三、資管四          本系不分班
 *   資管系專倫、資管系人哲  開給某一系的全人課程；中文系專倫、行銷組專倫、企管專倫、
 *   資管系入門              金融國企專倫、智慧資安人哲…是別系的（有的寫「系」「組」，有的沒有）
 *   CT-管理學院、FT-理工學院  國文、外國語文依學院指定的班
 *   FT-大二英文、FT-非英文    全校開放（大二英文、第二外語）
 *
 * 看不懂的寫法一律當成開放：寧可多排一班讓學生自己確認，也不要因為猜錯把能修的課排除掉。
 */

export type ClassProfile = {
  /** 系的簡稱，與開課班級的前綴相同，如「資管」 */
  deptLabel?: string;
  /** 學院全名，如「管理學院」 */
  college?: string;
  /** 甲／乙班。不知道時排課會讓同一份課表的本系課都在同一班 */
  section?: "甲" | "乙";
};

/** 系所代號 → 開課班級用的簡稱；學院代號 → 全名（輔大） */
const DEPT_LABEL: Record<string, string> = { IM: "資管" };
const COLLEGE_NAME: Record<string, string> = { MGT: "管理學院" };

export function classProfileOf(student: { dept: string; classSection?: "甲" | "乙" }, college?: string): ClassProfile {
  return {
    deptLabel: DEPT_LABEL[student.dept],
    college: college ? COLLEGE_NAME[college] : undefined,
    ...(student.classSection ? { section: student.classSection } : {}),
  };
}

/** 本系分甲乙班的班：回傳甲／乙；其他回傳 undefined */
export function sectionLetter(classGroup: string | undefined, profile: ClassProfile): "甲" | "乙" | undefined {
  if (!classGroup || !profile.deptLabel) return undefined;
  const m = new RegExp(`^${profile.deptLabel}[一二三四]([甲乙])$`).exec(classGroup);
  return m ? (m[1] as "甲" | "乙") : undefined;
}

/**
 * 學生能不能修這一班。不能修時附上原因（給「為什麼沒排這門課」的回答用）。
 * 開課班級缺漏（合成資料、系上課表抽出的）一律可以。
 */
export function classAllows(classGroup: string | undefined, profile: ClassProfile): { ok: true } | { ok: false; reason: string } {
  if (!classGroup) return { ok: true };

  // 開給某一系的全人課程：「資管系專倫」「行銷組專倫」「中文系人哲」
  const reserved = /^(.+?)(?:專倫|人哲|入門)$/.exec(classGroup);
  if (reserved) {
    if (!profile.deptLabel) return { ok: true };
    const who = reserved[1]!.replace(/[系組]$/, "");
    return who === profile.deptLabel ? { ok: true } : { ok: false, reason: `開給${reserved[1]}的班` };
  }

  // 國文、外國語文依學院指定：「CT-管理學院」「FT-理工學院」
  const byCollege = /^(?:CT|FT)-(.+學院)$/.exec(classGroup);
  if (byCollege) {
    if (!profile.college) return { ok: true };
    return byCollege[1] === profile.college ? { ok: true } : { ok: false, reason: `開給${byCollege[1]}的班` };
  }

  // 本系甲乙班：知道學生是哪一班才排除另一班；不知道時由排課讓整份課表同一班
  const letter = sectionLetter(classGroup, profile);
  if (letter && profile.section && letter !== profile.section) {
    return { ok: false, reason: `開給${profile.deptLabel}${profile.section === "甲" ? "乙" : "甲"}班` };
  }
  return { ok: true };
}
