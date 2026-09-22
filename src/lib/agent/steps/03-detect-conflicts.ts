import type { Step } from "./types";
import { ruleConflict } from "../tools";

/** 步驟 3：比對規則包與公告庫，找出版本／適用對象衝突。 */
export const detectConflictsStep: Step = {
  name: "detectConflicts",
  label: "偵測規則衝突",
  async run({ trace, state }) {
    const { data, call } = await trace.tool("rule.conflict", { packId: state.pack!.id }, async () => {
      const conflicts = ruleConflict(state.pack!);
      return {
        data: conflicts,
        output: conflicts.map((c) => ({
          id: c.id,
          target: c.target,
          kind: c.kind,
          announcement: c.announcement.title,
          appliesToYears: c.announcement.appliesToYears,
        })),
      };
    });

    state.conflicts = data;
    if (data.length === 0) {
      return { status: "ok", summary: "公告庫比對完成，未發現衝突", toolCalls: [call] };
    }
    return {
      status: "ok",
      summary: `發現 ${data.length} 處：${data.map((c) => c.targetName).join("、")}`,
      toolCalls: [call],
    };
  },
};
