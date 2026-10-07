import type { ToolCall } from "@/lib/types";
import type { Step } from "./types";
import { ruleReconcile, toConflictNotes, toDeptDefinedResolutions, withAnnouncedEffects } from "../tools";
import { LlmBudgetExceeded } from "@/lib/llm/client";

/**
 * 步驟 4：檢索公告並判斷是否適用本學籍（唯一在執行期做規則判斷的 LLM 呼叫）。
 * 解不掉的衝突不會被硬解 —— 直接落到 HoldItem，該項不計入學分判定。
 */
export const reconcileConflictsStep: Step = {
  name: "reconcileConflicts",
  label: "檢索補充依據並重新判定",
  async run({ trace, state, budget }) {
    if (state.conflicts.length === 0) {
      return { status: "skipped", summary: "無待解消之衝突", toolCalls: [] };
    }

    const calls: ToolCall[] = [];
    let resolved = 0;
    let held = 0;
    let offline = 0;

    for (const conflict of state.conflicts) {
      try {
        const { data, call } = await trace.tool(
          "rule.reconcile",
          { conflictId: conflict.id, announcement: conflict.announcement.title },
          async () => {
            const r = await ruleReconcile(conflict, state.record!.student, budget);
            return {
              data: r,
              status: r.resolved ? ("ok" as const) : ("partial" as const),
              output: {
                resolved: r.resolved,
                appliesToStudent: r.appliesToStudent,
                reason: r.reason,
                quote: r.citation?.quote ?? null,
                mode: r.mode,
                costUsd: r.costUsd,
              },
            };
          },
        );
        calls.push(call);
        state.reconciled.push(data);
        if (data.mode === "offline") offline++;
        if (data.resolved) resolved++;
        else held++;
      } catch (err) {
        if (err instanceof LlmBudgetExceeded) {
          return {
            status: "failed",
            summary: err.message,
            toolCalls: calls,
            control: { type: "abort", reason: err.message },
          };
        }
        // 解不掉就是解不掉：轉待確認，不重試到看起來像有答案
        held++;
        state.reconciled.push({
          conflict,
          resolved: false,
          appliesToStudent: null,
          reason: `檢索補充依據時發生錯誤：${String(err instanceof Error ? err.message : err)}`,
          citation: null,
          mode: "offline",
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        });
      }
    }

    state.conflictNotes = toConflictNotes(state.reconciled);
    state.deptDefinedResolutions = toDeptDefinedResolutions(state.reconciled);
    // 適用的公告若改變採計方式（例：舊生修新領域的課），之後的審查與排課都要照著用
    state.pack = withAnnouncedEffects(state.pack!, state.reconciled);

    const detail = state.reconciled
      .map((r) => `${r.conflict.announcement.title}：${!r.resolved ? "無法解消" : r.appliesToStudent ? "適用" : "不適用"}`)
      .join("；");

    return {
      status: held > 0 ? "held" : "ok",
      summary:
        `${detail}` +
        (offline > 0 ? `（${offline} 件以離線規則替身判定）` : "") +
        `；合計 ${resolved} 解消、${held} 轉人工`,
      toolCalls: calls,
    };
  },
};
