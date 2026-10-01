import Link from "next/link";
import type { PlanCourse, TimeSlot } from "@/lib/types";
import { periodScheme, periodRow } from "@/lib/offerings/period-scheme";

/**
 * 週課表格線。
 *
 * 建議清單是「系統算出了什麼」，週課表是「這學期實際長什麼樣」——
 * 學生真正要判斷的是有沒有連著四堂、哪一天空、跟已登記的時段會不會撞，
 * 那些在表格清單裡看不出來。
 *
 * 已登記時段（實習、專題）一併畫進去並標示來源，否則畫面會漏掉一半的真實負擔。
 *
 * 週六日在桌機固定顯示 —— 沒課是一個要看得到的事實。
 * 但在手機上，七天擠進 390px 只能靠橫捲，而**要捲才看得到的欄位等於不存在**：
 * 使用者會以為星期四之後就沒課了。所以週六日沒排到課時，窄螢幕就把那兩欄收掉，
 * 讓一到五完整顯示；真的排到週末課時則照常顯示（此時橫捲是必要的代價）。
 */

type Block = {
  key: string;
  name: string;
  code?: string;
  credits?: number;
  category?: string;
  teacher?: string;
  kind: "plan" | "reserved";
};

const DAY_LABEL = ["一", "二", "三", "四", "五", "六", "日"];

export function Timetable({
  courses,
  reserved,
  search = "",
  school,
}: {
  courses: PlanCourse[];
  reserved: { label: string; slots: TimeSlot[] }[];
  search?: string;
  /** 學校：節次名稱與鐘點依各校作息（輔大的內部第 6 節是 D5） */
  school?: string;
}) {
  const scheme = periodScheme(school);
  const grid = new Map<string, Block>();
  const at = (d: number, p: number) => `${d}-${p}`;
  let maxPeriod = scheme.defaultLast;
  let minPeriod = 1;

  for (const c of courses) {
    for (const s of c.slots) {
      for (const p of s.periods) {
        maxPeriod = Math.max(maxPeriod, p);
        minPeriod = Math.min(minPeriod, p);
        grid.set(at(s.day, p), {
          key: c.code,
          name: c.name,
          code: c.code,
          credits: c.credits,
          category: c.categoryLabel,
          teacher: c.teacher,
          kind: "plan",
        });
      }
    }
  }
  for (const r of reserved) {
    for (const s of r.slots) {
      for (const p of s.periods) {
        maxPeriod = Math.max(maxPeriod, p);
        minPeriod = Math.min(minPeriod, p);
        if (!grid.has(at(s.day, p))) {
          grid.set(at(s.day, p), { key: `r-${r.label}`, name: r.label, kind: "reserved" });
        }
      }
    }
  }

  const days = [1, 2, 3, 4, 5, 6, 7];
  const usesWeekend = [...grid.keys()].some((k) => k.startsWith("6-") || k.startsWith("7-"));
  // 一般從第 1 節畫起；排到輔大特早節（內部第 0 節）才往上延伸
  const periods = Array.from({ length: maxPeriod - minPeriod + 1 }, (_, i) => i + minPeriod);
  // 沒畫進格線的課分兩種：時段字串看不懂的（未參與衝堂判定），
  // 和本來就沒有固定上課時間的（專題、實習：「時間另訂」）—— 後者學分照算，不能因為格線上看不到就忘了
  const unknown = courses.filter((c) => c.slots.length === 0 && c.slotText.startsWith("時段未知"));
  const noTime = courses.filter((c) => c.slots.length === 0 && !c.slotText.startsWith("時段未知"));
  const skip = new Map<number, number>();

  return (
    <div className="tt-wrap">
      <table className="tt" data-weekend={usesWeekend ? "used" : "empty"}>
        <thead>
          <tr>
            <th className="tt-corner">節次</th>
            {days.map((d) => (
              <th key={d} className={d >= 6 ? "wk" : undefined}>
                星期{DAY_LABEL[d - 1]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const t = periodRow(scheme, p);
            return (
              <tr key={p}>
                <th className="tt-p">
                  <span className="n">{t?.label ?? p}</span>
                  {t ? (
                    <span className="hm">
                      {t.start}
                      <br />
                      {t.end}
                    </span>
                  ) : null}
                </th>
                {days.map((d) => {
                  const left = skip.get(d) ?? 0;
                  if (left > 0) {
                    skip.set(d, left - 1);
                    return null;
                  }
                  const b = grid.get(at(d, p));
                  if (!b) return <td key={d} className={`tt-empty${d >= 6 ? " wk" : ""}`} />;
                  let span = 1;
                  while (grid.get(at(d, p + span))?.key === b.key) span += 1;
                  if (span > 1) skip.set(d, span - 1);
                  return (
                    <td key={d} rowSpan={span} className={`tt-cell ${b.kind}${d >= 6 ? " wk" : ""}`}>
                      <Cell b={b} search={search} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="tt-legend">
        點課程格可看課綱。節次時間：{scheme.source}（{scheme.asOf}）。
      </p>

      {noTime.length > 0 ? (
        <div className="tt-notime">
          <b>沒有固定上課時間（學分照算）</b>
          <ul>
            {noTime.map((c) => (
              <li key={c.code}>
                {c.name}（{c.code}，{c.credits} 學分，{c.teacher}）　{c.slotText}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unknown.length > 0 ? (
        <p className="tt-note">
          {unknown.map((c) => `${c.name}（${c.code}）`).join("、")}
          　時段字串無法解析，未畫入格線，也未參與衝堂判定。
        </p>
      ) : null}
    </div>
  );
}

function Cell({ b, search }: { b: Block; search: string }) {
  const body = (
    <>
      <span className="tt-name">{b.name}</span>
      {b.code ? (
        <span className="tt-sub">
          <span className="tt-code">{b.code}</span>
          {b.credits !== undefined ? `・${b.credits} 學分` : ""}
        </span>
      ) : null}
      {b.category ? <span className="tt-sub">{b.category}</span> : null}
      {b.teacher ? <span className="tt-sub">{b.teacher}</span> : null}
      {b.kind === "reserved" ? <span className="tt-sub">已登記時段</span> : null}
    </>
  );
  if (b.kind === "reserved" || !b.code) return <div className="tt-in">{body}</div>;
  return (
    <Link className="tt-in tt-link" href={`/syllabus/${b.code}${search}`}>
      {body}
    </Link>
  );
}
