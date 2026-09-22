import type { Step } from "./types";
import { ruleResolve } from "../tools";

/**
 * 步驟 2：以學籍入學學年綁定規則包。
 *
 * admissionYear !== actualAdmissionYear（轉系、轉學、復學）→ 全案轉人工，
 * **除非**修課紀錄裡帶有已核定的學分採計認定結果。那份認定就是規劃表要求的
 * 人工程序，做完了系統就沒有理由再停一次；沒做完則一律停止，
 * 因為在認定之前「哪一門課採計為什麼」沒有任何規則可以推導。
 */
export const resolveRuleVersionStep: Step = {
  name: "resolveRuleVersion",
  label: "判定適用規則版本",
  async run({ trace, state }) {
    const student = state.record!.student;
    const transfer = state.record!.transferApproval;
    const { data, call } = await trace.tool(
      "rule.resolve",
      {
        dept: student.dept,
        admissionYear: student.admissionYear,
        actualAdmissionYear: student.actualAdmissionYear,
        program: student.program,
        transferApproval: transfer ? transfer.documentNo : null,
      },
      async () => {
        const outcome = ruleResolve(student, transfer);
        return {
          data: outcome,
          status: outcome.ok ? ("ok" as const) : ("partial" as const),
          output: outcome.ok
            ? { packId: outcome.pack.id, version: outcome.pack.version, provenance: outcome.pack.provenance }
            : { reason: outcome.reason, detail: outcome.detail },
        };
      },
    );

    if (!data.ok) {
      const isMismatch = data.reason === "admission_year_mismatch";
      return {
        status: isMismatch ? "held" : "failed",
        summary: data.detail,
        toolCalls: [call],
        control: isMismatch
          ? { type: "all-hold", reason: data.detail }
          : { type: "abort", reason: data.detail },
      };
    }

    state.pack = data.pack;
    const label = `${data.pack.admissionYear} 學年度 ${data.pack.dept}（${data.pack.program === "day" ? "日" : "夜"}）rev.${data.pack.version}`;
    return {
      status: "ok",
      summary:
        `${label}` +
        (data.pack.provenance === "synthetic" ? "（合成規則包，僅供 Demo 與評測）" : "") +
        (transfer
          ? `；本案為轉系生，依 ${transfer.approvedAt} ${transfer.approvedBy} 核定之學分採計認定（${transfer.documentNo}）判定`
          : ""),
      toolCalls: [call],
    };
  },
};
