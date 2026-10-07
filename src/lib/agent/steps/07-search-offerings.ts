import type { Step } from "./types";
import { courseSearch } from "../tools";
import { fetchedAt } from "@/lib/offerings";
import { requirementsFrom } from "@/lib/solver/schedule";
import { schoolOf } from "@/lib/schools";

/** 步驟 7：查下學期開課。查無 → 略過求解，僅輸出審查結果。 */
export const searchOfferingsStep: Step = {
  name: "searchOfferings",
  label: "查詢下學期開課資料",
  async run({ trace, state }) {
    const reqs = requirementsFrom(state.audit!);
    const categories = [...new Set(reqs.map((r) => r.categoryId))];

    if (categories.length === 0) {
      return {
        status: "skipped",
        summary: "各類別學分均已滿足或修課中，無須推薦下學期課程",
        control: { type: "skip", steps: ["solveSchedule"] },
      };
    }

    // 學期原本寫死成 1：下學期是第 2 學期的學生永遠搜不到課。
    // 合成示範學生的下學期剛好是 115-1，所以從沒出事
    const nextHalf: 1 | 2 = state.nextTerm.endsWith("-2") ? 2 : 1;
    const school = schoolOf(state.record!.student);
    const { data, call } = await trace.tool(
      "course.search",
      { year: state.nextYear, term: nextHalf, categories, school },
      async () => {
        const offerings = courseSearch(state.nextYear, nextHalf, categories, school, state.pack);
        return {
          data: offerings,
          status: offerings.length > 0 ? ("ok" as const) : ("partial" as const),
          output: {
            count: offerings.length,
            slotsUnknown: offerings.filter((o) => o.slotsUnknown).length,
            dataFetchedAt: fetchedAt(),
          },
        };
      },
    );

    state.offerings = data;

    if (data.length === 0) {
      return {
        status: "partial",
        summary: `${state.nextTerm} 查無符合未修類別之開課`,
        toolCalls: [call],
        control: { type: "skip", steps: ["solveSchedule"] },
      };
    }

    const unknown = data.filter((o) => o.slotsUnknown).length;
    return {
      status: unknown > 0 ? "partial" : "ok",
      summary:
        `${state.nextTerm} 符合未修類別者 ${data.length} 門` +
        (unknown > 0 ? `，其中 ${unknown} 門時段字串無法解析，已標記為時段未知` : ""),
      toolCalls: [call],
    };
  },
};
