import type {
  AuditResult,
  BlockedContent,
  Discussion,
  HoldItem,
  Offering,
  Plan,
  ProviderKind,
  SolveResult,
  StepStatus,
  StudentRecord,
  ToolCall,
} from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import type { Capabilities } from "@/lib/providers";
import type { TraceCollector } from "../trace";
import type { LlmBudget } from "@/lib/llm/client";
import type { FixtureId } from "@/lib/providers/fixtures";
import type { ConflictNote, DeptDefinedResolution } from "@/lib/audit/engine";
import type { Conflict, ReconcileOutcome } from "../tools/rule";

export type AuditRequest = {
  providerKind: ProviderKind;
  payload?: unknown;
  fixture?: FixtureId;
  /** 本次判定的當前學期，如 "114-2" */
  currentTerm?: string;
};

/** 步驟之間共享的可變狀態。每個步驟只寫自己負責的欄位。 */
export type AgentState = {
  request: AuditRequest;
  record?: StudentRecord;
  capabilities?: Capabilities;
  pack?: RulePack;
  conflicts: Conflict[];
  reconciled: ReconcileOutcome[];
  conflictNotes: ConflictNote[];
  deptDefinedResolutions: Record<string, DeptDefinedResolution>;
  capabilityHolds: HoldItem[];
  audit?: AuditResult;
  offerings: Offering[];
  solve?: SolveResult;
  plans: Plan[];
  /** 步驟 9 取回、尚未通過安全檢查的外部內容 */
  rawPosts: { courseCode: string; text: string; sourceUrl: string; postedAt: string }[];
  /** 步驟 10 檢查通過後才可呈現 */
  discussions: Map<string, Discussion[]>;
  blocked: BlockedContent[];
  currentTerm: string;
  nextTerm: string;
  nextYear: number;
};

export type StepCtx = {
  trace: TraceCollector;
  state: AgentState;
  budget: LlmBudget;
};

/**
 * 步驟的控制訊號 —— 對應 SPEC.md §6 的狀態機分支。
 * 沒有這些訊號，狀態圖就只是一條單向箭頭，會被判為固定流程。
 */
export type StepControl =
  | { type: "continue" }
  | { type: "abort"; reason: string }
  /** 整案轉人工：不做任何學分判定 */
  | { type: "all-hold"; reason: string }
  /** 查無開課 → 略過求解與討論檢索 */
  | { type: "skip"; steps: string[] };

export type StepOutcome = {
  status: StepStatus;
  summary: string;
  retries?: number;
  toolCalls?: ToolCall[];
  control?: StepControl;
};

export type Step = {
  name: string;
  label: string;
  run(ctx: StepCtx): Promise<StepOutcome>;
};
