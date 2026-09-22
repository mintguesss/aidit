import type { ProviderKind, StudentRecord } from "@/lib/types";

/**
 * 三種資料來源實作同一個介面（SPEC.md §4）。
 * 上層不得知道自己拿到的是哪一種 —— 這讓 Demo、評測與真實資料走完全相同的程式路徑。
 */
export interface CourseRecordProvider {
  readonly kind: ProviderKind;
  fetch(input?: unknown): Promise<StudentRecord>;
  capabilities(): Capabilities;
}

export type Capabilities = {
  /** 是否含抵免資料 */
  hasWaivers: boolean;
  /** 是否含目前修課中 */
  hasEnrollment: boolean;
  hasCertPrograms: boolean;
  /** 是否含畢業條件佐證（語言檢定、服務學習） */
  hasGraduationEvidence: boolean;
};

/**
 * capabilities() 缺哪一項，對應的判定就進 holds，不得猜測。
 * 回傳的是「因資料來源能力不足而無法判定的項目說明」。
 */
export function capabilityGaps(cap: Capabilities): { id: string; title: string; body: string }[] {
  const gaps: { id: string; title: string; body: string }[] = [];
  if (!cap.hasWaivers) {
    gaps.push({
      id: "cap-waivers",
      title: "資料來源未含抵免紀錄",
      body: "本次資料來源不提供抵免資料，若學生有抵免學分，其採計結果將與實際不符。系統不就抵免部分作任何推測。",
    });
  }
  if (!cap.hasEnrollment) {
    gaps.push({
      id: "cap-enrollment",
      title: "資料來源未含本學期修課中科目",
      body: "本次資料來源不提供修課中資料，修課中學分一律以 0 計，判定結果會偏保守。",
    });
  }
  if (!cap.hasGraduationEvidence) {
    gaps.push({
      id: "cap-evidence",
      title: "資料來源未含畢業條件佐證",
      body: "語言能力、資訊能力與服務學習之佐證不在本次資料來源內，相關畢業條件一律列為待確認。",
    });
  }
  return gaps;
}
