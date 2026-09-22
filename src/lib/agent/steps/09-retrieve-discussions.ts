import type { Step } from "./types";
import { webRetrieve, WEB_TIMEOUT_MS } from "../tools";
import type { RetrievedPost } from "../tools/web";

/**
 * 步驟 9：檢索課程公開討論。
 *
 * 必須非阻塞：逾時 3s 即放棄並標記 partial，主結果照常輸出。
 * 本步驟的結果不參與任何學分或採計判定。
 */
export const retrieveDiscussionsStep: Step = {
  name: "retrieveDiscussions",
  label: "檢索課程公開討論",
  async run({ trace, state }) {
    const codes = [...new Set(state.plans.flatMap((p) => p.courses.map((c) => c.code)))];
    if (codes.length === 0) {
      return { status: "skipped", summary: "無建議課程，略過討論檢索" };
    }

    const { data, call } = await trace.tool("web.retrieve", { codes, timeoutMs: WEB_TIMEOUT_MS }, async () => {
      const r = await withTimeout(webRetrieve(codes), WEB_TIMEOUT_MS);
      if (r === TIMEOUT) {
        return {
          data: { posts: [] as RetrievedPost[], partial: true, missing: codes, timedOut: true },
          status: "partial" as const,
          output: { timedOut: true },
        };
      }
      return {
        data: { ...r, timedOut: false },
        status: r.partial ? ("partial" as const) : ("ok" as const),
        output: { posts: r.posts.length, missing: r.missing, source: r.source },
      };
    });

    // 尚未過安全檢查，先暫存於 state，由步驟 10 決定哪些可以呈現
    state.rawPosts = data.posts;

    const got = new Set(data.posts.map((p) => p.courseCode)).size;
    return {
      status: data.partial || data.timedOut ? "partial" : "ok",
      summary: data.timedOut
        ? `逾時 ${WEB_TIMEOUT_MS}ms 放棄，主結果不受影響`
        : `${codes.length} 門課程中 ${got} 門取得資料`,
      toolCalls: [call],
    };
  },
};

const TIMEOUT = Symbol("timeout");

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    p,
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}
