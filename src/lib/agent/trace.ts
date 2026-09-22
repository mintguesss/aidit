import type { BlockedContent, StepResult, StepStatus, ToolCall, ToolStatus, Trace } from "@/lib/types";
import { scrub } from "@/lib/util/scrub";

/**
 * Trace 收集器（SPEC.md §6「每一步都要寫 trace，包含失敗與重試」）。
 *
 * 寫入前一律過 scrubber：trace 儲存去識別後內容，不得含姓名、學號。
 * 課程名稱與成績可以留 —— 那是判定依據，且無法單獨識別個人。
 */
export class TraceCollector {
  readonly steps: StepResult[] = [];
  readonly blockedContent: BlockedContent[] = [];
  private startedAt = Date.now();

  constructor(readonly id: string) {}

  /** 包住一次工具呼叫，統一記錄輸入、輸出、耗時與狀態 */
  async tool<T>(
    name: string,
    input: unknown,
    fn: () => Promise<{ output: unknown; data: T; status?: ToolStatus }>,
  ): Promise<{ data: T; call: ToolCall }> {
    const t0 = Date.now();
    try {
      const r = await fn();
      const call: ToolCall = {
        name,
        input: scrub(input),
        output: scrub(r.output),
        ms: Date.now() - t0,
        status: r.status ?? "ok",
      };
      return { data: r.data, call };
    } catch (err) {
      const call: ToolCall = {
        name,
        input: scrub(input),
        output: null,
        ms: Date.now() - t0,
        status: "failed",
        error: String(err instanceof Error ? err.message : err),
      };
      throw new ToolFailure(call, err);
    }
  }

  pushStep(step: Omit<StepResult, "idx">): StepResult {
    const s: StepResult = { ...step, idx: this.steps.length + 1, summary: scrubSummary(step.summary) };
    this.steps.push(s);
    return s;
  }

  pushBlocked(items: BlockedContent[]): void {
    this.blockedContent.push(...items.map((b) => scrub(b)));
  }

  finish(args: {
    studentHash: string;
    rulePackId: string;
    rulePackVersion: string;
    status: Trace["status"];
    llm: Trace["llm"];
    abortReason?: string;
  }): Trace {
    return {
      id: this.id,
      createdAt: new Date(this.startedAt).toISOString(),
      totalMs: Date.now() - this.startedAt,
      steps: this.steps,
      blockedContent: this.blockedContent,
      ...args,
    };
  }
}

export class ToolFailure extends Error {
  constructor(
    readonly call: ToolCall,
    readonly original: unknown,
  ) {
    super(call.error ?? "tool failed");
    this.name = "ToolFailure";
  }
}

function scrubSummary(s: string): string {
  return scrub(s);
}

export const STATUS_LABEL: Record<StepStatus, string> = {
  ok: "成功",
  partial: "部分成功",
  retried: "重試後成功",
  held: "轉人工",
  failed: "失敗",
  skipped: "略過",
};
