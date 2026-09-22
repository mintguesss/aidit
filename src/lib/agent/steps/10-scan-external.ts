import type { Discussion } from "@/lib/types";
import type { Step } from "./types";
import { safetyScan, toDiscussions } from "../tools";

/**
 * 步驟 10：外部內容注入檢查。
 *
 * 命中指令樣式即丟棄該筆並記入 trace，原文與來源可供查閱。
 * 通過檢查者僅作為呈現資訊，不參與任何學分或採計判定。
 */
export const scanExternalStep: Step = {
  name: "scanExternal",
  label: "外部內容安全檢查",
  async run({ trace, state }) {
    const posts = state.rawPosts;
    if (posts.length === 0) {
      return { status: "skipped", summary: "無外部內容須檢查" };
    }

    const { data, call } = await trace.tool("safety.scan", { items: posts.length }, async () => {
      const r = safetyScan(posts.map((p) => ({ text: p.text, sourceUrl: p.sourceUrl })));
      return {
        data: r,
        status: r.blocked.length > 0 ? ("partial" as const) : ("ok" as const),
        output: {
          safe: r.safe.length,
          blocked: r.blocked.length,
          patterns: r.blocked.map((b) => b.patternMatched),
        },
      };
    });

    trace.pushBlocked(data.blocked);
    state.blocked = data.blocked;

    const safeUrls = new Set(data.safe.map((s) => s.sourceUrl));
    const byCourse = new Map<string, Discussion[]>();
    for (const p of posts) {
      if (!safeUrls.has(p.sourceUrl)) continue;
      const list = byCourse.get(p.courseCode) ?? [];
      list.push(...toDiscussions([p]));
      byCourse.set(p.courseCode, list);
    }
    state.discussions = byCourse;

    // 討論資料掛回選課建議；未取得者明確標示，不留白讓人以為是系統漏掉
    for (const plan of state.plans) {
      for (const c of plan.courses) c.discussions = byCourse.get(c.code) ?? [];
    }

    return {
      status: data.blocked.length > 0 ? "ok" : "ok",
      summary:
        data.blocked.length > 0
          ? `攔截 ${data.blocked.length} 則含指令樣式之外部內容（${[...new Set(data.blocked.map((b) => b.patternMatched))].join("、")}），未進入推論`
          : `檢查 ${posts.length} 則外部內容，未發現指令樣式`,
      toolCalls: [call],
    };
  },
};
