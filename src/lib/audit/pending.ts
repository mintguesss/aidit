import type { AuditResult, GraduationCheck } from "@/lib/types";

/**
 * 待確認的畢業條件（英檢、機測…）：成績單看不出是否通過，所以不在 audit.holds 裡。
 * 已經另外開成待確認卡片的條件不重複算，否則同一件事會列兩次。
 */
export function pendingGraduationChecks(audit: AuditResult): GraduationCheck[] {
  const carded = new Set(audit.holds.map((h) => h.id));
  return audit.graduationChecks.filter((g) => g.status === "hold" && !carded.has(`hold-check-${g.id}`));
}
