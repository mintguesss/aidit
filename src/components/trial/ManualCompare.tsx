import type { ManualAnswer, ManualKey } from "@/lib/trial/session";

const shown = (v: number | null | undefined) => (v === null || v === undefined ? "未填" : String(v));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const yesNo = (v: boolean | null) => (v === null ? "未填" : v ? "是" : "否");

/** 手算作答和標準答案逐項對照，錯的那一格標出來 */
export function ManualCompare({ answer, answerKey }: { answer: ManualAnswer | undefined; answerKey: ManualKey }) {
  const rows = [
    ...answerKey.categories.map((c) => ({ label: c.name, mine: shown(answer?.categories[c.name]), right: String(c.unmet), ok: answer?.categories[c.name] === c.unmet })),
    { label: "合計還差", mine: shown(answer?.total), right: String(answerKey.total), ok: answer?.total === answerKey.total },
    {
      label: "通識還缺的領域",
      mine: answer ? answer.missingDomains.join("、") || "（沒勾）" : "未填",
      right: answerKey.domains.join("、") || "（不缺）",
      ok: !!answer && sameSet(answer.missingDomains, answerKey.domains),
    },
    { label: "已符合畢業學分", mine: yesNo(answer?.canGraduate ?? null), right: yesNo(answerKey.canGraduate), ok: answer?.canGraduate === answerKey.canGraduate },
  ];
  return (
    <table className="tr-compare">
      <thead>
        <tr>
          <th>項目</th>
          <th>作答</th>
          <th>正確答案</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={r.ok ? undefined : "wrong"}>
            <td>{r.label}</td>
            <td>
              {r.mine}
              {r.ok ? "" : " ✗"}
            </td>
            <td>{r.right}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
