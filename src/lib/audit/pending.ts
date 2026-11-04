import type { AuditResult, GraduationCheck, HoldItem } from "@/lib/types";

/**
 * 待確認的畢業條件（英檢、機測…）：成績單看不出是否通過，所以不在 audit.holds 裡。
 * 已經另外開成待確認卡片的條件不重複算，否則同一件事會列兩次。
 */
export function pendingGraduationChecks(audit: AuditResult): GraduationCheck[] {
  const carded = new Set(audit.holds.map((h) => h.id));
  return audit.graduationChecks.filter((g) => g.status === "hold" && !carded.has(`hold-check-${g.id}`));
}

/** 換成待確認卡片的格式，畫面、找誰、詢問信都和其他待確認事項相同 */
export function pendingChecksAsHolds(audit: AuditResult): HoldItem[] {
  return pendingGraduationChecks(audit).map((g) => ({
    id: `check-${g.id}`,
    title: `${g.name}待確認`,
    body: `${g.name}：${g.detail}`,
    reason: g.detail,
    citations: g.citations,
    impact: "畢業條件之一，修課紀錄看不出是否通過。",
    contact: g.contact ?? "承辦單位",
  }));
}
