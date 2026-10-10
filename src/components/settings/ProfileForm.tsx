"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CoursePreferences, ExtraGoal, GraduationCheck, Student } from "@/lib/types";
import { EMPTY_OPTIONAL, type OptionalPreferences } from "@/lib/ui/prefs";
import { erase, fetchPreferences, pushPreferences } from "@/lib/ui/sync";
import { Spinner } from "@/components/shell/Spinner";

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

/** 選填偏好的快選字。比對的是課名裡有沒有這幾個字，所以都是課名常見的短詞 */
const CAREER_PRESETS = ["資料分析", "軟體開發", "資訊安全", "行銷", "財務"];
const INTEREST_PRESETS = ["資料", "程式", "人工智慧", "雲端", "行銷", "設計"];
const AVOID_PRESETS = ["實驗", "專題", "英語", "體育"];

const XGOALS: [ExtraGoal["kind"], string, string][] = [
  ["minor", "輔系", "修另一系的指定科目"],
  ["double-major", "雙主修", "兩系都畢業，兩張學位"],
  ["cert-program", "學分學程", "跨系模組，另發證明"],
  ["transfer", "轉系", "換到另一系的規定"],
];
const XGOAL_LABEL: Record<ExtraGoal["kind"], string> = {
  minor: "輔系",
  "double-major": "雙主修",
  "cert-program": "學分學程",
  transfer: "轉系",
};

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
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "fail">("idle");
  const [hydrated, setHydrated] = useState(false);
  const [opt, setOptRaw] = useState<OptionalPreferences>(EMPTY_OPTIONAL);
  const setOpt = (o: OptionalPreferences) => {
    setOptRaw(o);
    setSaved("idle");
  };

  useEffect(() => {
    void fetchPreferences(fixture, term, defaults).then((s) => {
      setPrefs(s.required);
      setOptRaw(s.optional);
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
    setSaved("saving");
    void pushPreferences(fixture, term, prefs, opt).then((ok) => setSaved(ok ? "ok" : "fail"));
  };

  const addGoal = (kind: ExtraGoal["kind"]) => {
    setPrefs((p) => ({ ...p, extraGoals: [...(p.extraGoals ?? []), { kind, target: "" }] }));
    setSaved("idle");
  };

  const updateGoal = (i: number, patch: Partial<ExtraGoal>) => {
    setPrefs((p) => ({
      ...p,
      extraGoals: (p.extraGoals ?? []).map((g, k) => (k === i ? { ...g, ...patch } : g)),
    }));
    setSaved("idle");
  };

  const removeGoal = (i: number) => {
    setPrefs((p) => ({ ...p, extraGoals: (p.extraGoals ?? []).filter((_, k) => k !== i) }));
    setSaved("idle");
  };

  const tasteFilled =
    (opt.careerDirection ? 1 : 0) + (opt.interestAreas.length > 0 ? 1 : 0) + (opt.avoidCourseTypes.length > 0 ? 1 : 0);

  // 右側摘要：把設定翻成一句一句的白話
  const summary = [
    GOALS.find(([v]) => v === prefs.goal)?.[1] ?? "",
    prefs.avoidEarly ? "不排早八" : "",
    prefs.preferCompactDays ? "課程盡量集中" : "",
    prefs.avoidDays.length > 0 ? `空出星期${prefs.avoidDays.map((d) => DAYS.find(([x]) => x === d)?.[1]).join("、")}` : "",
    prefs.targetCourseCount ? `期望 ${prefs.targetCourseCount} 堂` : "",
    prefs.maxCredits ? `最多 ${prefs.maxCredits} 學分` : "",
    tasteFilled > 0 ? `口味偏好 ${tasteFilled} 項` : "",
    ...(prefs.extraGoals ?? []).filter((g) => g.target).map((g) => `${XGOAL_LABEL[g.kind]}：${g.target}`),
  ].filter(Boolean);

  const reset = () => {
    void erase(fixture, term, "preferences");
    setPrefs(defaults);
    setOptRaw(EMPTY_OPTIONAL);
    setSaved("idle");
  };

  return (
    <>
      {/* 學籍資料做成一張學生證：左邊是「你是誰」，右邊是「哪些事實決定了你的判定」 */}
      <section className="idcard">
        <div className="idcard-hd">
          <h2>學籍資料</h2>
          <span className="idcard-lock">唯讀・由校務系統提供</span>
        </div>
        <div className="idcard-bd">
          <div className="idcard-who">
            <span className="idcard-av" aria-hidden>
              {(student.displayName ?? "？").slice(0, 1)}
            </span>
            <div className="idcard-name">{student.displayName ?? "（未提供姓名）"}</div>
            <div className="idcard-id">{student.maskedId ?? student.id}</div>
            <div className="idcard-tags">
              <span className={`idcard-st ${student.status}`}>
                {{ enrolled: "在學", leave: "休學", graduated: "已畢業" }[student.status]}
              </span>
              <span>{student.program === "day" ? "日間部" : "進修部"}</span>
            </div>
          </div>

          <dl className="idcard-facts">
            <div className="wide">
              <dt>系級</dt>
              <dd>{student.className ?? student.dept}</dd>
            </div>
            <div>
              <dt>學籍入學學年</dt>
              <dd className="num">
                {student.admissionYear}
                <small>決定適用的規劃表</small>
              </dd>
            </div>
            <div>
              <dt>實際入學學年</dt>
              <dd className="num">
                {student.actualAdmissionYear}
                {student.actualAdmissionYear !== student.admissionYear ? (
                  <small className="diff">與學籍學年不同（轉系／轉學）</small>
                ) : (
                  <small>與學籍學年相同</small>
                )}
              </dd>
            </div>
            {rulePack ? (
              <div className="wide">
                <dt>適用規劃表</dt>
                <dd>
                  <Link className="idcard-plan" href={`/rulepack${search}`}>
                    <b>{student.admissionYear} 學年度</b>
                    <code>rev.{rulePack.version}</code>
                    {rulePack.provenance !== "approved" ? (
                      <span className="idcard-prov">
                        {rulePack.provenance === "synthetic" ? "合成規則包" : "未校對草稿"}
                      </span>
                    ) : null}
                  </Link>
                </dd>
              </div>
            ) : null}
            {commitments.length > 0 ? (
              <div className="wide">
                <dt>下學期已登記時段</dt>
                <dd className="idcard-chips">
                  {commitments.map((c) => (
                    <span key={c.label}>
                      {c.label}
                      <em>{c.slotText}</em>
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        <p className="idcard-foot">
          資料有誤請洽教務處註冊組。
        </p>
      </section>

      {/* 選課傾向：左邊一組一組設定，右邊固定一張「目前的設定」摘要＋儲存。
          改什麼，右邊立刻看得到結果，不必捲到最下面找儲存鍵 */}
      <div className="pf">
        <div className="pf-main">
          <div className="pf-hd">
            <h2>選課傾向</h2>
            <span>選課建議會照這裡排課</span>
          </div>

          <section className="pf-card">
            <SecHead n={1} icon="goal" title="這學期想怎麼修？" sub="決定這學期的修課份量" />
            <div className="goalpick" role="radiogroup" aria-label="修課目標">
              {GOALS.map(([value, label, desc]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={prefs.goal === value}
                  className={prefs.goal === value ? "on" : undefined}
                  onClick={() => update({ goal: value })}
                >
                  <span className="goalpick-ic" aria-hidden>
                    <GoalIcon kind={value} />
                  </span>
                  <b>{label}</b>
                  <small>{desc}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="pf-card">
            <SecHead n={2} icon="time" title="時段" sub="哪些時間不要排課" />
            <Switch
              on={prefs.avoidEarly}
              onChange={(v) => update({ avoidEarly: v })}
              label="不排早八"
              desc="第 1 節。做不到時會照排並標示"
            />
            <Switch
              on={prefs.preferCompactDays}
              onChange={(v) => update({ preferCompactDays: v })}
              label="課程盡量集中"
              desc="排在少數幾天，少跑幾趟學校"
            />
            <div className="weekpick">
              <div className="weekpick-lb">
                點選要<b>完全空出</b>的星期<small>一定做到，這幾天不排任何課</small>
              </div>
              <div className="weekpick-days">
                {DAYS.map(([d, label]) => {
                  const on = prefs.avoidDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={on ? "on" : undefined}
                      onClick={() =>
                        update({
                          avoidDays: on
                            ? prefs.avoidDays.filter((x) => x !== d)
                            : [...prefs.avoidDays, d].sort((a, b) => a - b),
                        })
                      }
                    >
                      <span className="weekpick-d">{label}</span>
                      <span className="weekpick-s">{on ? "空出" : "可排"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="pf-card">
            <SecHead n={3} icon="load" title="份量" sub="堂數、學分上限與備註" />
            <div className="steppers">
              <Stepper
                label="期望堂數"
                value={prefs.targetCourseCount}
                min={1}
                max={12}
                unit="堂"
                empty="不指定"
                hint="做不到時會照排並說明"
                onChange={(v) => update({ targetCourseCount: v })}
              />
              <Stepper
                label="學期學分上限"
                value={prefs.maxCredits}
                min={1}
                max={30}
                unit="學分"
                empty="依學則"
                hint="不會超過學則上限"
                onChange={(v) => update({ maxCredits: v })}
              />
            </div>
            <label className="pf-note">
              <span>備註</span>
              <textarea
                rows={2}
                maxLength={200}
                placeholder="例如：下學期有校外實習，希望課不要排太散"
                value={prefs.note ?? ""}
                onChange={(e) => update({ note: e.target.value })}
              />
              <small>不參與排課，只顯示在選課建議頁給你自己看。</small>
            </label>
          </section>

          {/* 口味：三列，左邊是問題、右邊是快選字；自訂輸入收在「＋ 自訂」裡，不常駐 */}
          <section className="pf-card taste">
            <SecHead
              n={4}
              icon="taste"
              title="讓推薦更合你的口味"
              sub="選填・只影響條件一樣好時誰排前面"
              aside={
                <span className="taste-meter" aria-label={`已填 ${tasteFilled} 項，共 3 項`}>
                  {[0, 1, 2].map((k) => (
                    <i key={k} className={k < tasteFilled ? "on" : undefined} />
                  ))}
                  <em>{tasteFilled}/3</em>
                </span>
              }
            />
            <div className="taste-rows">
              <PickField
                label="想往哪個方向發展"
                hint="選一個"
                single
                values={opt.careerDirection ? [opt.careerDirection] : []}
                presets={CAREER_PRESETS}
                onChange={(v) => setOpt({ ...opt, careerDirection: v[0] ?? "" })}
              />
              <PickField
                label="有興趣的領域"
                hint="可多選"
                values={opt.interestAreas}
                presets={INTEREST_PRESETS}
                onChange={(v) => setOpt({ ...opt, interestAreas: v })}
              />
              <PickField
                label="想避開的課"
                hint="可多選"
                tone="avoid"
                values={opt.avoidCourseTypes}
                presets={AVOID_PRESETS}
                onChange={(v) => setOpt({ ...opt, avoidCourseTypes: v })}
              />
            </div>
            <p className="pf-fine">
              用課名比對這些字。與其他設定分開存放，可在 <Link href={`/privacy${search}`}>資料與隱私</Link> 單獨刪除。
            </p>
          </section>

          <section className="pf-card">
            <SecHead n={5} icon="extra" title="打算加修什麼？" sub="還沒申請、正在考慮的目標，幫你算還差多少" />
            <div className="xgoal-add">
              {XGOALS.map(([kind, label, desc]) => (
                <button
                  key={kind}
                  type="button"
                  disabled={(prefs.extraGoals ?? []).length >= 4}
                  onClick={() => addGoal(kind)}
                >
                  <span className="xgoal-ic" aria-hidden>
                    <XGoalIcon kind={kind} />
                  </span>
                  <b>{label}</b>
                  <small>{desc}</small>
                  <span className="xgoal-plus" aria-hidden>
                    ＋
                  </span>
                </button>
              ))}
            </div>
            {(prefs.extraGoals ?? []).length > 0 ? (
              <ul className="xgoal-list">
                {(prefs.extraGoals ?? []).map((g, i) => (
                  <li key={i}>
                    <span className="xgoal-ic sm" aria-hidden>
                      <XGoalIcon kind={g.kind} />
                    </span>
                    <span className="xgoal-kind">{XGOAL_LABEL[g.kind]}</span>
                    <input
                      type="text"
                      value={g.target}
                      autoFocus={g.target === ""}
                      placeholder={g.kind === "cert-program" ? "學程名稱，例如：資訊安全" : "系所名稱，例如：財金"}
                      aria-label={`${XGOAL_LABEL[g.kind]}名稱`}
                      onChange={(e) => updateGoal(i, { target: e.target.value })}
                    />
                    <button type="button" className="xgoal-x" aria-label="移除" onClick={() => removeGoal(i)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        {/* 右側摘要：目前設定一覽＋儲存，捲動時跟著走 */}
        <aside className="pf-side">
          <div className="pf-sum">
            <div className="pf-sum-k">目前的設定</div>
            <ul className="pf-sum-list">
              {summary.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <button className="btn btn-primary pf-save" type="button" onClick={submit} disabled={!hydrated || saved === "saving"}>
              {saved === "saving" ? <Spinner label="儲存中…" /> : saved === "ok" ? "已儲存 ✓" : "儲存設定"}
            </button>
            {saved === "ok" ? <p className="pf-ok">選課建議頁會照這些條件重新排課。</p> : null}
            {saved === "fail" ? (
              <p className="pf-fail">無法寫入儲存空間（可能是私密視窗）。這次瀏覽仍有效，關掉分頁後會回到預設值。</p>
            ) : null}
            <Link className="pf-go" href={`/plan${search}`}>
              看依此排出的課表 →
            </Link>
            <button className="pf-reset" type="button" onClick={reset} disabled={!hydrated}>
              回到預設值
            </button>
            <p className="pf-fine">
              設定以不可逆的雜湊值為鍵存在伺服器（不含學號），可在 <Link href={`/privacy${search}`}>資料與隱私</Link> 刪除。
            </p>
          </div>
        </aside>
      </div>

      {/* 畢業條件的檢核結果與依據在修業明細，這裡不重複一份 */}
      <p className="lead">
        畢業條件的檢核結果見 <Link href={`/audit${search}`}>修業明細</Link>；
        判不出來的項目見 <Link href={`/holds${search}`}>待確認事項</Link>。
      </p>
    </>
  );
}

/** 開關：整列可點，右邊一顆滑動開關 */
function Switch({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`sw-row${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span className="sw-txt">
        <b>{label}</b>
        <small>{desc}</small>
      </span>
      <span className="sw-track" aria-hidden>
        <i />
      </span>
    </button>
  );
}

/** 加減鈕。到最小值再按減號就回到「不指定」 */
function Stepper({
  label,
  value,
  min,
  max,
  unit,
  empty,
  hint,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  unit: string;
  empty: string;
  hint: string;
  onChange: (v: number | undefined) => void;
}) {
  const dec = () => onChange(value === undefined ? undefined : value <= min ? undefined : value - 1);
  const inc = () => onChange(value === undefined ? min : Math.min(max, value + 1));
  return (
    <div className="stepper">
      <span className="stepper-lb">{label}</span>
      <div className="stepper-ctl">
        <button type="button" onClick={dec} disabled={value === undefined} aria-label={`${label}減少`}>
          −
        </button>
        <output className={value === undefined ? "none" : undefined} key={value ?? "none"}>
          {value === undefined ? (
            empty
          ) : (
            <>
              <b>{value}</b>
              {unit}
            </>
          )}
        </output>
        <button type="button" onClick={inc} disabled={value !== undefined && value >= max} aria-label={`${label}增加`}>
          ＋
        </button>
      </div>
      <small>{hint}</small>
    </div>
  );
}

/**
 * 快選字＋自訂。左邊是問題、右邊一排字；點字加入、再點取消。
 * 自訂輸入不常駐（常駐的虛線框讓整塊看起來很亂），按「＋ 自訂」才展開，Enter 加入後收起。
 */
function PickField({
  label,
  hint,
  values,
  presets,
  onChange,
  single,
  tone,
}: {
  label: string;
  hint: string;
  values: string[];
  presets: string[];
  onChange: (v: string[]) => void;
  single?: boolean;
  tone?: "avoid";
}) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const toggle = (t: string) => {
    if (values.includes(t)) onChange(values.filter((x) => x !== t));
    else onChange(single ? [t] : values.length >= 8 ? values : [...values, t]);
  };
  const add = () => {
    const t = draft.trim();
    if (t && !values.includes(t)) toggle(t);
    setDraft("");
    setTyping(false);
  };
  const custom = values.filter((v) => !presets.includes(v));
  return (
    <div className={`pick${tone ? ` ${tone}` : ""}`}>
      <div className="pick-q">
        <b>{label}</b>
        <small>{hint}</small>
      </div>
      <div className="pick-chips">
        {[...presets, ...custom].map((t) => (
          <button key={t} type="button" aria-pressed={values.includes(t)} onClick={() => toggle(t)}>
            {t}
          </button>
        ))}
        {typing ? (
          <input
            type="text"
            autoFocus
            placeholder="輸入後按 Enter"
            value={draft}
            aria-label={`${label}（自訂）`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                setDraft("");
                setTyping(false);
              }
            }}
            onBlur={add}
          />
        ) : (
          <button type="button" className="pick-add" onClick={() => setTyping(true)}>
            ＋ 自訂
          </button>
        )}
      </div>
    </div>
  );
}

/** 區塊標題：編號、圖示、標題、一句說明；右側可放額外元件 */
function SecHead({
  n,
  icon,
  title,
  sub,
  aside,
}: {
  n: number;
  icon: "goal" | "time" | "load" | "taste" | "extra";
  title: string;
  sub: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="sec-hd">
      <span className={`sec-ic ${icon}`} aria-hidden>
        <SecIcon kind={icon} />
        <em>{n}</em>
      </span>
      <span className="sec-t">
        <h3>{title}</h3>
        <small>{sub}</small>
      </span>
      {aside}
    </header>
  );
}

function SecIcon({ kind }: { kind: "goal" | "time" | "load" | "taste" | "extra" }) {
  if (kind === "goal")
    return (
      <svg {...ic}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.6" />
      </svg>
    );
  if (kind === "time")
    return (
      <svg {...ic}>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </svg>
    );
  if (kind === "load")
    return (
      <svg {...ic}>
        <path d="M4 18h16M6 14h12M8 10h8M10 6h4" />
      </svg>
    );
  if (kind === "taste")
    return (
      <svg {...ic}>
        <circle cx="12" cy="12" r="8" />
        <path d="M15 9l-2 4-4 2 2-4z" />
      </svg>
    );
  return (
    <svg {...ic}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

const ic = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function GoalIcon({ kind }: { kind: CoursePreferences["goal"] }) {
  if (kind === "asap")
    return (
      <svg {...ic}>
        <path d="M4 6l7 6-7 6zM13 6l7 6-7 6z" />
      </svg>
    );
  if (kind === "light")
    return (
      <svg {...ic}>
        <path d="M20 4C11 4 6 9 5 19M5 19l7-7M9 15h5c3 0 5-3 6-11" />
      </svg>
    );
  return (
    <svg {...ic}>
      <path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z" />
    </svg>
  );
}

function XGoalIcon({ kind }: { kind: ExtraGoal["kind"] }) {
  if (kind === "minor")
    return (
      <svg {...ic}>
        <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />
      </svg>
    );
  if (kind === "double-major")
    return (
      <svg {...ic}>
        <path d="M3 5h7v15H3zM14 5h7v15h-7zM6 9h1M17 9h1" />
      </svg>
    );
  if (kind === "cert-program")
    return (
      <svg {...ic}>
        <circle cx="12" cy="9" r="5" />
        <path d="M9 13.5L8 21l4-2 4 2-1-7.5" />
      </svg>
    );
  return (
    <svg {...ic}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}
