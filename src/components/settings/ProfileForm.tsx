"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CoursePreferences, ExtraGoal, GraduationCheck, Student } from "@/lib/types";
import { EMPTY_OPTIONAL, type OptionalPreferences } from "@/lib/ui/prefs";
import { erase, fetchPreferences, pushPreferences } from "@/lib/ui/sync";

/**
 * 個人資料與選課傾向。
 *
 * 兩者的性質不同，畫面上要分開：
 *   - 學籍資料由校務系統提供，學生**不能**在這裡改（改了也不會改變事實，只會做出假的判定）
 *   - 選課傾向是學生自己的偏好，可以隨時改，存在自己的瀏覽器裡，不上傳伺服器
 */

const DAYS: [number, string][] = [
  [1, "一"],
  [2, "二"],
  [3, "三"],
  [4, "四"],
  [5, "五"],
];

const GOALS: [CoursePreferences["goal"], string, string][] = [
  ["asap", "最快畢業", "願意修滿學分上限，把未修的補光"],
  ["balanced", "正常進度", "兼顧負擔與時段，維持一般修課量"],
  ["light", "輕量修課", "這學期想輕一點，堂數越少越好"],
];

export function ProfileForm({
  fixture,
  term,
  student,
  rulePack,
  defaults,
  checks,
  commitments,
  search,
}: {
  fixture: string;
  term: string;
  student: Student;
  /** 適用的規劃表版本 —— 這是判定的依據，屬於學籍資料的一部分 */
  rulePack?: { version: string; provenance: string };
  defaults: CoursePreferences;
  checks: GraduationCheck[];
  commitments: { label: string; slotText: string }[];
  search: string;
}) {
  const [prefs, setPrefs] = useState<CoursePreferences>(defaults);
  const [saved, setSaved] = useState<"idle" | "ok" | "fail">("idle");
  const [opt, setOpt] = useState<OptionalPreferences>(EMPTY_OPTIONAL);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void fetchPreferences(fixture, term, defaults).then((s) => {
      setPrefs(s.required);
      setOpt(s.optional);
      setHydrated(true);
    });
    // defaults 由伺服器算出且在同一個案例下固定，不需要重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<CoursePreferences>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setSaved("idle");
  };

  const submit = () => {
    void pushPreferences(fixture, term, prefs, opt).then((ok) => setSaved(ok ? "ok" : "fail"));
  };

  const addGoal = () =>
    setPrefs((p) => ({ ...p, extraGoals: [...(p.extraGoals ?? []), { kind: "minor", target: "" }] }));

  const updateGoal = (i: number, patch: Partial<ExtraGoal>) =>
    setPrefs((p) => ({
      ...p,
      extraGoals: (p.extraGoals ?? []).map((g, k) => (k === i ? { ...g, ...patch } : g)),
    }));

  const removeGoal = (i: number) =>
    setPrefs((p) => ({ ...p, extraGoals: (p.extraGoals ?? []).filter((_, k) => k !== i) }));

  const reset = () => {
    void erase(fixture, term, "preferences");
    setPrefs(defaults);
    setOpt(EMPTY_OPTIONAL);
    setSaved("idle");
  };

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <h2>學籍資料</h2>
          <span className="hint">由校務系統提供，此處僅供檢視</span>
        </div>
        <div className="panel-bd">
          <div className="fieldgrid">
            <Field k="代號" v={student.maskedId ?? student.id} mono />
            <Field k="姓名" v={student.displayName ?? "（未提供）"} />
            <Field k="系級" v={student.className ?? student.dept} />
            <Field k="學制" v={student.program === "day" ? "日間部" : "進修部"} />
            <Field k="學籍入學學年" v={String(student.admissionYear)} />
            <Field k="實際入學學年" v={String(student.actualAdmissionYear)} />
            <Field
              k="學籍狀態"
              v={{ enrolled: "在學", leave: "休學", graduated: "已畢業" }[student.status]}
            />
            {commitments.length > 0 ? (
              <Field
                k="下學期已登記時段"
                v={commitments.map((c) => `${c.label} ${c.slotText}`).join("、")}
              />
            ) : null}
            {rulePack ? (
              <Field
                k="適用規劃表"
                v={`${student.admissionYear} 學年度 rev.${rulePack.version}${
                  rulePack.provenance === "approved"
                    ? ""
                    : rulePack.provenance === "synthetic"
                      ? "（合成規則包）"
                      : "（未校對草稿）"
                }`}
                mono
              />
            ) : null}
          </div>
          <p className="panel-foot">
            此處僅供檢視，資料有誤請洽教務處註冊組。版本不對可到{" "}
            <Link href={`/rulepack${search}`}>適用規劃表</Link> 上傳。
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2>選課傾向</h2>
          <span className="hint">下學期選課建議會依這裡的設定排課</span>
        </div>
        <div className="panel-bd">
          <details className="fset" open>
            <summary>這學期的修課目標</summary>
            <div className="optlist">
              {GOALS.map(([value, label, desc]) => (
                <label key={value} className="opt">
                  <input
                    type="radio"
                    name="goal"
                    checked={prefs.goal === value}
                    onChange={() => update({ goal: value })}
                  />
                  <span>
                    <b>{label}</b>
                    <small>{desc}</small>
                  </span>
                </label>
              ))}
            </div>
          </details>

          <details className="fset">
            <summary>時段</summary>
            <label className="opt inline">
              <input
                type="checkbox"
                checked={prefs.avoidEarly}
                onChange={(e) => update({ avoidEarly: e.target.checked })}
              />
              <span>
                <b>不排早八</b>
                <small>第 1 節。做不到時會照排並標示</small>
              </span>
            </label>
            <label className="opt inline">
              <input
                type="checkbox"
                checked={prefs.preferCompactDays}
                onChange={(e) => update({ preferCompactDays: e.target.checked })}
              />
              <span>
                <b>課程盡量集中</b>
                <small>盡量把課排在少數幾天，減少跑學校的次數</small>
              </span>
            </label>

            <div className="subfield">
              <div className="sublabel">完全空出的星期（硬性條件，這幾天不會排任何課）</div>
              <div className="daypick">
                {DAYS.map(([d, label]) => {
                  const on = prefs.avoidDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className="chip"
                      aria-pressed={on}
                      onClick={() =>
                        update({
                          avoidDays: on
                            ? prefs.avoidDays.filter((x) => x !== d)
                            : [...prefs.avoidDays, d].sort((a, b) => a - b),
                        })
                      }
                    >
                      星期{label}
                    </button>
                  );
                })}
              </div>
            </div>
          </details>

          <details className="fset">
            <summary>堂數</summary>
            <div className="numgrid">
              <label className="numfield">
                <span>期望堂數</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={prefs.targetCourseCount ?? ""}
                  placeholder="不指定"
                  onChange={(e) =>
                    update({ targetCourseCount: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                />
                <small>做不到時會照排並說明原因</small>
              </label>
              <label className="numfield">
                <span>學期學分上限</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={prefs.maxCredits ?? ""}
                  placeholder="依學則上限"
                  onChange={(e) =>
                    update({ maxCredits: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                />
                <small>不會超過學則規定的上限</small>
              </label>
            </div>
          </details>

          <details className="fset">
            <summary>備註</summary>
            <textarea
              rows={2}
              maxLength={200}
              placeholder="例如：下學期有校外實習，希望課不要排太散"
              value={prefs.note ?? ""}
              onChange={(e) => update({ note: e.target.value })}
            />
            <small className="hintline">
              <b>不參與求解</b>，只顯示在選課建議頁供你自己參考。
            </small>
          </details>

          <details className="fset">
            <summary>
              課程排序偏好
              <span className="opt-badge">選填</span>
            </summary>
            <small className="opt-note">
              不填不影響審查結果與課表可行性，僅影響課程排序。
              兩份課表在未修學分、堂數、時段上完全相同時，才會用這裡的偏好決定誰排前面。
            </small>

            <div className="optrow">
              <label htmlFor="career">職涯方向</label>
              <input
                id="career"
                type="text"
                placeholder="例如：資料分析"
                value={opt.careerDirection ?? ""}
                onChange={(e) => setOpt({ ...opt, careerDirection: e.target.value })}
              />
            </div>

            <TagField
              id="interest"
              label="興趣領域"
              placeholder="輸入後按 Enter，例如：機器學習"
              values={opt.interestAreas}
              onChange={(v) => setOpt({ ...opt, interestAreas: v })}
            />

            <TagField
              id="avoidtype"
              label="想避開的課程類型"
              placeholder="輸入後按 Enter，例如：大量程式作業"
              values={opt.avoidCourseTypes}
              onChange={(v) => setOpt({ ...opt, avoidCourseTypes: v })}
            />

            <p className="opt-foot">
              這些欄位與必填分開存放，可在{" "}
              <Link href={`/privacy${search}`}>資料與隱私</Link> 單獨刪除。
            </p>
          </details>

          <details className="fset">
            <summary>額外修業目標</summary>
            <small>
              校務系統已註冊的輔系、雙主修、學分學程會自動顯示，不必在這裡填。
              這裡填的是<b>還沒註冊但打算修</b>的目標。
            </small>
            <div className="goalrows">
              {(prefs.extraGoals ?? []).map((g, i) => (
                <div className="goalrow" key={i}>
                  <select
                    value={g.kind}
                    aria-label="目標種類"
                    onChange={(e) => updateGoal(i, { kind: e.target.value as ExtraGoal["kind"] })}
                  >
                    <option value="minor">輔系</option>
                    <option value="double-major">雙主修</option>
                    <option value="cert-program">學分學程</option>
                    <option value="transfer">轉系</option>
                  </select>
                  <input
                    type="text"
                    value={g.target}
                    placeholder={g.kind === "cert-program" ? "學程名稱，例如：資訊安全" : "系所名稱，例如：財金"}
                    aria-label="目標名稱"
                    onChange={(e) => updateGoal(i, { target: e.target.value })}
                  />
                  <button type="button" className="btn" onClick={() => removeGoal(i)}>
                    移除
                  </button>
                </div>
              ))}
              {(prefs.extraGoals ?? []).length < 4 ? (
                <button type="button" className="btn" onClick={addGoal}>
                  ＋ 新增目標
                </button>
              ) : null}
            </div>
          </details>

          <div className="formactions">
            <button className="btn btn-primary" type="button" onClick={submit} disabled={!hydrated}>
              儲存設定
            </button>
            <button className="btn" type="button" onClick={reset} disabled={!hydrated}>
              回到預設值
            </button>
            <Link className="btn" href={`/plan${search}`}>
              去看依此排出的課表 →
            </Link>
          </div>

          {saved === "ok" ? (
            <div className="note inset">
              已儲存。選課建議頁會依這些條件重新排課。
            </div>
          ) : saved === "fail" ? (
            <div className="note warn">
              無法寫入瀏覽器儲存空間（可能是私密視窗或已停用站台資料）。
              設定在本次瀏覽期間仍然有效，但關掉分頁後會回到預設值。
            </div>
          ) : null}

          <p className="panel-foot">
            設定存在伺服器（以不可逆的雜湊值為鍵，不含學號），換裝置也看得到；
            本機另留一份供離線使用。可在 <Link href={`/privacy${search}`}>資料與隱私</Link> 查閱或刪除。
          </p>
        </div>
      </section>

      {/* 畢業條件的檢核結果與依據在修業明細，這裡不重複一份 */}
      <p className="lead">
        畢業條件的檢核結果見 <Link href={`/audit${search}`}>修業明細</Link>；
        判不出來的項目見 <Link href={`/holds${search}`}>待確認事項</Link>。
      </p>
    </>
  );
}

/** 標籤式輸入：Enter 新增、點 ✕ 移除。選填欄位是自由文字，用標籤比逗號分隔好收拾 */
function TagField({
  id,
  label,
  placeholder,
  values,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || values.includes(t) || values.length >= 8) return;
    onChange([...values, t]);
    setDraft("");
  };
  return (
    <div className="optrow">
      <label htmlFor={id}>{label}</label>
      <div className="tagfield">
        {values.length > 0 ? (
          <div className="tagchips">
            {values.map((v) => (
              <span className="tagchip" key={v}>
                {v}
                <button type="button" aria-label={`移除 ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="field">
      <div className="field-k">{k}</div>
      <div className={`field-v${mono ? " mono" : ""}`}>{v}</div>
    </div>
  );
}
