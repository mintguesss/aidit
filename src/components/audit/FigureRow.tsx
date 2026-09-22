import type { AuditResult } from "@/lib/types";

/**
 * 五格數字。用 gap:1px + background:line 做框線，欄數變動也不會破版。
 */
export function FigureRow({ audit }: { audit: AuditResult }) {
  const shortBy = audit.categories
    .filter((c) => c.unmet > 0)
    .map((c) => `${c.name} ${c.unmet}`)
    .join("、");

  const subOnly = audit.categories.filter((c) => c.status === "unmet" && c.unmet === 0);

  return (
    <div className="figs">
      <div className="fig">
        <div className="n">{audit.minCredits}</div>
        <div className="lb">畢業最低學分</div>
        <div className="sub">
          {audit.rulePack.id} rev.{audit.rulePack.version}
        </div>
      </div>
      <div className="fig">
        <div className="n">{audit.totalEarned}</div>
        <div className="lb">已修得</div>
        <div className="sub">
          {audit.overflow > 0
            ? `可採計 ${audit.countable}，超修 ${audit.overflow} 不採計`
            : "全數可採計"}
        </div>
      </div>
      <div className="fig">
        <div className="n">{audit.inProgress}</div>
        <div className="lb">本學期修課中</div>
        <div className="sub">成績登錄後計入</div>
      </div>
      <div className={`fig${audit.unmet > 0 ? " unmet" : ""}`}>
        <div className="n">{audit.unmet}</div>
        <div className="lb">尚須補修</div>
        <div className="sub">
          {shortBy || (subOnly.length > 0 ? `${subOnly.map((c) => c.name).join("、")}另有分布未達` : "各類別學分均已完成")}
        </div>
      </div>
      <div className={`fig${audit.holds.length > 0 ? " hold" : ""}`}>
        <div className="n">
          {audit.holds.length}
          <em>項</em>
        </div>
        <div className="lb">待人工確認</div>
        <div className="sub">未計入上列判定</div>
      </div>
    </div>
  );
}
