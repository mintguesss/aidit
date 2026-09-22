import type { Step } from "./types";
import { recordFetch } from "../tools";
import { capabilityGaps } from "@/lib/providers";

/** 步驟 1：讀取修課紀錄。失敗即中止並回錯誤頁，不顯示部分結果。 */
export const fetchRecordStep: Step = {
  name: "fetchRecord",
  label: "讀取修課紀錄",
  async run({ trace, state }) {
    const { providerKind, payload, fixture } = state.request;
    const { data, call } = await trace.tool(
      "record.fetch",
      { providerKind, fixture },
      async () => {
        const r = await recordFetch(providerKind, payload, fixture);
        return {
          data: r,
          output: {
            courses: r.record.courses.length,
            waivers: r.record.courses.filter((c) => c.status === "waived").length,
            inProgress: r.record.courses.filter((c) => c.status === "in_progress").length,
            capabilities: r.capabilities,
          },
        };
      },
    );

    state.record = data.record;
    state.capabilities = data.capabilities;

    // capabilities() 缺哪一項，對應的判定就進 holds，不得猜測
    state.capabilityHolds = capabilityGaps(data.capabilities).map((g) => ({
      id: g.id,
      title: g.title,
      body: g.body,
      citations: [],
      impact: "相關判定未計入上方結果。",
      contact: "教務處註冊組",
    }));

    const n = data.record.courses.length;
    const waivers = data.record.courses.filter((c) => c.status === "waived").length;
    const doing = data.record.courses.filter((c) => c.status === "in_progress").length;

    return {
      status: state.capabilityHolds.length > 0 ? "partial" : "ok",
      summary:
        `取得 ${n} 筆修課、${waivers} 筆抵免、${doing} 筆修課中` +
        (state.capabilityHolds.length > 0
          ? `；資料來源缺 ${state.capabilityHolds.length} 項能力，已列為待確認`
          : ""),
      toolCalls: [call],
    };
  },
};
