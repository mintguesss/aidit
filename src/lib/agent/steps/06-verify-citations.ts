import type { CategoryResult, Citation, HoldItem } from "@/lib/types";
import type { Step } from "./types";
import { citationVerify, collectCitations } from "../tools";

/**
 * 步驟 6：每條結論的 quote 回查原文。
 *
 * 驗證的是規則引用，不是敘述 —— 目的是抓出被幻覺出來的規則。
 * 對不上 → 重試 1 次 → 仍失敗則該條降級為 HoldItem，
 * 絕不以未驗證的依據輸出結論。
 */
export const verifyCitationsStep: Step = {
  name: "verifyCitations",
  label: "查核結論引用來源",
  async run({ trace, state }) {
    const audit = state.audit!;
    const citations = collectCitations(audit);

    const first = await trace.tool("citation.verify", { count: citations.length }, async () => {
      const r = citationVerify(citations);
      return {
        data: r,
        status: r.failed.length > 0 ? ("partial" as const) : ("ok" as const),
        output: {
          verified: r.verified.length,
          failed: r.failed.length,
          fuzzy: r.fuzzyCount,
          failures: r.failed.map((f) => ({
            docId: f.citation.docId,
            locator: f.citation.locator,
            reason: f.reason,
            bestRatio: f.ratio,
          })),
        },
      };
    });

    const calls = [first.call];
    let report = first.data;
    let retries = 0;

    if (report.failed.length > 0) {
      // 重試一次：以正規化後的引用重新比對，排除單純的空白／全半形差異
      retries = 1;
      const retry = await trace.tool(
        "citation.verify",
        { retry: true, count: report.failed.length },
        async () => {
          const r = citationVerify(report.failed.map((f) => f.citation));
          return {
            data: r,
            status: r.failed.length > 0 ? ("partial" as const) : ("ok" as const),
            output: { verified: r.verified.length, failed: r.failed.length, fuzzy: r.fuzzyCount },
          };
        },
      );
      calls.push(retry.call);
      report = {
        verified: [...report.verified, ...retry.data.verified],
        failed: retry.data.failed,
        fuzzyCount: report.fuzzyCount + retry.data.fuzzyCount,
      };
    }

    if (report.failed.length > 0) {
      const failedKeys = new Set(report.failed.map(keyOf));
      audit.categories = audit.categories.map((c) => downgrade(c, failedKeys));
      audit.holds = [
        ...audit.holds,
        ...report.failed.map<HoldItem>((f, i) => ({
          id: `hold-citation-${i}`,
          title: `結論引用之依據無法回查原文：${f.citation.docTitle} ${f.citation.locator}`,
          body:
            `系統於輸出前將每一條結論的引用原文回查來源文件，本條比對未通過` +
            `（原因：${reasonLabel(f.reason)}${f.ratio !== undefined ? `，最佳相似度 ${(f.ratio * 100).toFixed(1)}%` : ""}）。` +
            `依規定不得以未經驗證的依據作成判定，該條結論已自動降級為待確認事項。`,
          citations: [f.citation],
          impact: "本條依據未計入上方判定。",
          contact: "系辦公室課務承辦人",
        })),
      ];
    }

    const total = report.verified.length + report.failed.length;
    return {
      status: report.failed.length > 0 ? "held" : retries > 0 ? "retried" : "ok",
      summary:
        `${total} 條結論引用中 ${report.verified.length} 條通過` +
        (report.fuzzyCount > 0 ? `（其中 ${report.fuzzyCount} 條以模糊比對通過）` : "") +
        (report.failed.length > 0 ? `，${report.failed.length} 條無對應依據，改列待確認` : ""),
      retries,
      toolCalls: calls,
    };
  },
};

function keyOf(v: { citation: Citation }): string {
  return `${v.citation.docId}|${v.citation.locator}|${v.citation.quote ?? ""}`;
}

function downgrade(cat: CategoryResult, failed: Set<string>): CategoryResult {
  const keep = cat.citations.filter((c) => !failed.has(`${c.docId}|${c.locator}|${c.quote ?? ""}`));
  if (keep.length === cat.citations.length) return cat;
  return {
    ...cat,
    citations: keep,
    notes: [...cat.notes, "本類別部分依據未通過原文回查，已移除並改列待確認事項。"],
  };
}

function reasonLabel(reason?: string): string {
  switch (reason) {
    case "document_missing":
      return "來源文件不存在";
    case "quote_missing":
      return "該欄位抽取時未留下原文片段";
    default:
      return "原文中查無相符片段";
  }
}
