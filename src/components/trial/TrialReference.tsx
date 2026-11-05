import { PLAN_GROUPS, PLAN_REMARKS, PLAN_TITLE, RULE_ARTICLES, RULES_TITLE } from "@/lib/trial/reference";

/** 手算時對照的課程規劃表 */
export function PlanReference() {
  return (
    <div className="tr-ref">
      <h2>{PLAN_TITLE}</h2>
      <p className="tr-hint">選別：必＝必修、選＝選修、通＝通識。</p>
      {PLAN_GROUPS.map((g) => (
        <section key={g.category}>
          <h3>
            {g.category}
            <span>{g.required > 0 ? `應修 ${g.required} 學分` : "0 學分"}</span>
          </h3>
          {g.notes?.map((n) => (
            <p key={n} className="tr-hint">
              {n}
            </p>
          ))}
          <table>
            <thead>
              <tr>
                <th>科目名稱</th>
                <th>選別</th>
                <th>學分</th>
              </tr>
            </thead>
            <tbody>
              {g.courses.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{c.type}</td>
                  <td className="mono">{c.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <section>
        <h3>畢業規定</h3>
        <ul className="tr-list">
          {PLAN_REMARKS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** 手算時對照的修業規則（學士班） */
export function RulesReference() {
  return (
    <div className="tr-ref">
      <h2>{RULES_TITLE}</h2>
      {RULE_ARTICLES.map((a) => (
        <section key={a.title}>
          <h3>{a.title}</h3>
          <ul className="tr-list">
            {a.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
