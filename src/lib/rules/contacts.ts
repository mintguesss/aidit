/**
 * 承辦窗口通訊錄。
 *
 * 待確認事項只告訴學生「請洽系辦公室」，他還是得自己找信箱、自己想怎麼寫。
 * 這張表讓系統可以直接把信寫好 —— 但它是**資料**，不是模型生成的：
 * 查不到對應窗口時就不給寄信按鈕，不會猜一個信箱出來。
 *
 * 本表為合成資料，網域 example.edu.tw 不存在，對應本專案其他虛構資料。
 */
export type Contact = {
  /** 比對 HoldItem.contact 用的關鍵字 */
  match: string[];
  unit: string;
  email: string;
  phone?: string;
  hours?: string;
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

/** 查不到就回 undefined —— 不猜信箱 */
export function contactOf(text: string | undefined): Contact | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s/g, "");
  return CONTACTS.find((c) => c.match.some((m) => t.includes(m)));
}
