/**
 * 承辦窗口通訊錄。
 *
 * 待確認事項只告訴學生「請洽系辦公室」，他還是得自己找信箱、自己想怎麼寫。
 * 這張表讓系統可以直接把信寫好 —— 但它是**資料**，不是模型生成的：
 * 查不到對應窗口時就不給寄信按鈕，不會猜一個信箱出來。
 *
 * CONTACTS 是合成資料，網域 example.edu.tw 不存在，只給合成案例用；真實學校的案例絕不能用這張表，
 * 否則會顯示假的信箱和電話。真實學校的窗口放 REAL_CONTACTS，只放系網公開的職務電話：
 * 示範案例不是真的學生，不提供信箱，避免有人真的寄信打擾承辦人。
 */
export type Contact = {
  /** 比對 HoldItem.contact 用的關鍵字 */
  match: string[];
  unit: string;
  email?: string;
  phone?: string;
  hours?: string;
  /** 顯示在聯絡方式旁邊的提醒 */
  note?: string;
};

export const CONTACTS: Contact[] = [
  {
    match: ["系辦", "課務承辦", "資訊管理學系"],
    unit: "資訊管理學系系辦公室（課務）",
    email: "im-course@example.edu.tw",
    phone: "(0X) 1234-5678 分機 2101",
    hours: "週一至週五 09:00–12:00、13:30–17:00",
  },
  {
    match: ["註冊組", "教務處註冊"],
    unit: "教務處註冊組",
    email: "registrar@example.edu.tw",
    phone: "(0X) 1234-5678 分機 1201",
    hours: "週一至週五 08:30–17:00",
  },
  {
    match: ["課務組", "教務處課務"],
    unit: "教務處課務組",
    email: "curriculum@example.edu.tw",
    phone: "(0X) 1234-5678 分機 1231",
    hours: "週一至週五 08:30–17:00",
  },
  {
    match: ["通識", "通識教育中心"],
    unit: "通識教育中心",
    email: "ge-center@example.edu.tw",
    phone: "(0X) 1234-5678 分機 3301",
  },
  {
    match: ["語言中心", "英文能力", "外語"],
    unit: "語言教學中心",
    email: "language@example.edu.tw",
    phone: "(0X) 1234-5678 分機 3401",
  },
  {
    match: ["學務", "服務學習"],
    unit: "學務處課外活動組",
    email: "service-learning@example.edu.tw",
    phone: "(0X) 1234-5678 分機 1501",
  },
];

/** 取自系網「行政同仁」頁（2026-11-05 查閱） */
const REAL_CONTACTS: Record<string, Contact[]> = {
  fju: [
    {
      match: ["資訊管理學系"],
      unit: "資訊管理學系辦公室（大學部秘書）",
      phone: "(02) 2905-2666",
      note: "示範案例，請勿實際聯絡",
    },
  ],
};

/** 查不到就回 undefined —— 不猜信箱。school 未填是合成資料 */
export function contactOf(text: string | undefined, school?: string): Contact | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s/g, "");
  const list = !school || school === "demo" ? CONTACTS : (REAL_CONTACTS[school] ?? []);
  return list.find((c) => c.match.some((m) => t.includes(m)));
}
