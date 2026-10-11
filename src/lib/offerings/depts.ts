/**
 * 系所／單位對照。
 *
 * 開課資料與修課紀錄裡存的是代碼（IM、FN…），使用者說的是「財金」「財務金融系」。
 * 沒有這張表，「申請財金系輔系」就對不到任何一門課 —— 而對不到的結果不是報錯，
 * 是**安靜地算成 0 學分**，那比報錯危險。
 *
 * 本表為合成資料，與本專案其他資料一致。真實資料到位時須一併更新（見 SPEC-CHANGES §D5）。
 */
export type Dept = { code: string; name: string; short: string; college: string };

export const DEPTS: Dept[] = [
  { code: "IM", name: "資訊管理學系", short: "資管", college: "管理學院" },
  { code: "BA", name: "企業管理學系", short: "企管", college: "管理學院" },
  { code: "FN", name: "財務金融學系", short: "財金", college: "管理學院" },
  { code: "AC", name: "會計學系", short: "會計", college: "管理學院" },
  { code: "EC", name: "經濟學系", short: "經濟", college: "管理學院" },
  { code: "ST", name: "統計學系", short: "統計", college: "管理學院" },
  { code: "ME", name: "機械工程學系", short: "機械", college: "工學院" },
  { code: "GE", name: "通識教育中心", short: "通識", college: "共同教育" },
  // 輔大：物理系三組在轉換開課資料時合併成 PH；心理系沿用課程系統的開課單位代碼
  { code: "PH", name: "物理學系", short: "物理", college: "理工學院" },
  { code: "39", name: "心理學系", short: "心理", college: "社會科學院" },
];

/** 查不到就回 undefined —— 不做模糊猜測，猜錯等於把別系的課算進來 */
export function resolveDept(q: string | undefined): Dept | undefined {
  if (!q) return undefined;
  const t = q.replace(/\s|學系|系所|系$/g, "").toUpperCase();
  if (!t) return undefined;
  return DEPTS.find(
    (d) =>
      d.code === t ||
      d.short === q.replace(/\s/g, "") ||
      d.name === q.replace(/\s/g, "") ||
      d.short === t ||
      d.name.includes(t) ||
      (t.length >= 2 && d.name.replace("學系", "").includes(t)),
  );
}

export function deptLabel(code: string): string {
  return DEPTS.find((d) => d.code === code)?.name ?? code;
}
