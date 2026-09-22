import type { Step } from "./types";
import { creditAudit } from "../tools";
import { InvariantError } from "@/lib/audit/engine";
import { ToolFailure } from "../trace";
import { activeCourseCodes } from "@/lib/offerings";

/**
 * 步驟 5：比對各類別學分。
 *
 * 本步驟不得呼叫 LLM。學分加總是確定性運算，這是不幻覺的保證。
 * 不變式檢查失敗 → 中止並記錄，絕不輸出可能錯誤的結果。
 */
export const auditCreditsStep: Step = {
  name: "auditCredits",
  label: "比對各類別學分",
  async run({ trace, state }) {
    try {
      const { data, call } = await trace.tool(
        "credit.audit",
        { packId: state.pack!.id, courses: state.record!.courses.length },
        async () => {
          const result = creditAudit({
            record: state.record!,
            pack: state.pack!,
            traceId: trace.id,
            currentTerm: state.currentTerm,
            nextTerm: state.nextTerm,
            conflictNotes: state.conflictNotes,
            deptDefinedResolutions: state.deptDefinedResolutions,
            activeCourseCodes: activeCourseCodes(),
          });
          return {
            data: result,
            output: {
              minCredits: result.minCredits,
              countable: result.countable,
              inProgress: result.inProgress,
              unmet: result.unmet,
              overflow: result.overflow,
              categories: result.categories.map((c) => ({
                id: c.id,
                required: c.required,
                earned: c.earned,
                inProgress: c.inProgress,
                unmet: c.unmet,
                overflow: c.overflow,
                status: c.status,
              })),
              holds: result.holds.length,
            },
          };
        },
      );

      // 資料來源能力不足造成的待確認事項，在此併入
      data.holds = [...data.holds, ...state.capabilityHolds];
      state.audit = data;

      const unmetCats = data.categories.filter((c) => c.status === "unmet");
      return {
        status: "ok",
        summary:
          `${data.categories.length} 類別，${unmetCats.length} 類未達，尚須補修 ${data.unmet} 學分` +
          (data.overflow > 0 ? `；超修 ${data.overflow} 學分不得流用` : ""),
        toolCalls: [call],
      };
    } catch (err) {
      const failure = err instanceof ToolFailure ? err : null;
      const original = failure ? failure.original : err;
      const reason =
        original instanceof InvariantError
          ? `不變式檢查失敗：${original.message}（${JSON.stringify(original.detail)}）`
          : `學分比對失敗：${String(original instanceof Error ? original.message : original)}`;
      return {
        status: "failed",
        summary: reason,
        toolCalls: failure ? [failure.call] : [],
        control: { type: "abort", reason },
      };
    }
  },
};
