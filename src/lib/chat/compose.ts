import type { Citation } from "@/lib/types";
import { FORBIDDEN_REPLY, type ForbiddenTopic, type Reply } from "./types";

/**
 * 回答格式（docs/CONVERSATION.md §3）。
 *
 * 三種回答各有固定形狀，而且都**短** ——
 * 長篇大論會讓人以為系統在掩飾不確定。
 *
 * 這裡是唯一組出回覆文字的地方；LLM 不參與，因此不可能在文字裡冒出
 * 引擎沒算過的數字。
 */

export function decided(args: {
  headline: string;
  detail?: string;
  citations: Citation[];
  uncountedHolds?: number;
}): Reply {
  // §0.3 無依據不作答：沒有引用就不能是「決定」
  if (args.citations.length === 0 && !args.detail) {
    return {
      kind: "不確定",
      headline: args.headline,
      searched: [],
      citations: [],
    };
  }
  return { kind: "決定", ...args };
}

export function uncertain(args: {
  headline: string;
  detail?: string;
  searched: string[];
  contact: string;
}): Reply {
  return { kind: "不確定", citations: [], ...args };
}

export function outOfScope(headline: string, contact: string): Reply {
  return { kind: "超出範圍", headline, contact, citations: [] };
}

export function forbidden(topic: ForbiddenTopic): Reply {
  const f = FORBIDDEN_REPLY[topic];
  return { kind: "超出範圍", headline: f.headline, contact: f.contact, citations: [] };
}

export function clarify(question: string): Reply {
  return { kind: "不確定", headline: question, searched: [], citations: [] };
}

/** 把 Reply 轉成單一字串（trace 與測試用；UI 直接讀結構） */
export function render(r: Reply): string {
  const parts: string[] = [r.headline];
  if (r.detail) parts.push(r.detail);
  if (r.kind === "不確定" && r.searched && r.searched.length > 0) {
    parts.push(`已查詢：${r.searched.join("、")}`);
  }
  if (r.contact) parts.push(`建議洽詢：${r.contact}`);
  if (r.citations.length > 0) {
    parts.push(`依據：${r.citations.map((c) => `${c.docTitle} ${c.locator}`).join("；")}`);
  }
  if (r.uncountedHolds) parts.push(`本結果未計入 ${r.uncountedHolds} 項待確認事項。`);
  return parts.join("\n");
}
