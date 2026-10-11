import type { AuditResult } from "@/lib/types";

/**
 * 總學分的拆解。原本是首頁一整列五格數字，現在收進進度總數的滑過說明：
 * 這些數字與進度條講的是同一件事，常駐只會讓同一個數字出現三次。
 */
export function FigureList({ audit }: { audit: AuditResult }) {
  const shortBy = audit.categories
    .filter((c) => c.unmet > 0)
    .map((c) => `${c.name} ${c.unmet}`)
    .join("、");

  const subOnly = audit.categories.filter((c) => c.status === "unmet" && c.unmet === 0);

  const rows: { lb: string; n: string; sub: string; tone?: "unmet" | "hold" }[] = [
    {
      lb: "畢業最低學分",
      n: String(audit.minCredits),
      sub: `${audit.rulePack.id} rev.${audit.rulePack.version}`,
    },
    {
      lb: "已修得",
      n: String(audit.totalEarned),
      sub:
        audit.overflow > 0
          ? `可採計 ${audit.countable}，超修 ${audit.overflow} 不採計`
          : "全數可採計",
    },
    { lb: "本學期修課中", n: String(audit.inProgress), sub: "成績登錄後計入" },
    {
      lb: "尚須補修",
      n: String(audit.unmet),
      sub:
        shortBy ||
        (subOnly.length > 0
          ? `${subOnly.map((c) => c.name).join("、")}另有分布未達`
          : "各類別學分均已完成"),
      tone: audit.unmet > 0 ? "unmet" : undefined,
    },
    {
      lb: "待人工確認",
      n: `${audit.holds.length} 項`,
      sub: "未計入上列判定",
      tone: audit.holds.length > 0 ? "hold" : undefined,
    },
  ];

  return (
    <span className="figlist">
      {rows.map((r) => (
        <span className="fl-row" key={r.lb}>
          <span className="fl-lb">{r.lb}</span>
          <span className={`fl-n${r.tone ? ` ${r.tone}` : ""}`}>{r.n}</span>
          <span className="fl-sub">{r.sub}</span>
        </span>
      ))}
    </span>
  );
}
