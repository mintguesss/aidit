"use client";

import { useCallback, useEffect, useState } from "react";
import type { Step, TaskId, TrialMod, TrialModeratorView } from "@/lib/trial/session";

const STEP_LABEL: Record<Step, string> = {
  consent: "等待同意",
  declined: "不同意",
  "manual-intro": "準備手算",
  manual: "手算中",
  orientation: "看系統",
  system: "系統任務",
  survey: "填問卷",
  done: "完成",
};

const TASKS: TaskId[] = ["t1", "t2", "t3"];
const needsJudging = (r: TrialModeratorView) =>
  (Boolean(r.session.tasks.t2.endedAt) && r.mod.t2Ok === null) || (Boolean(r.session.tasks.t3.endedAt) && r.mod.t3Ok === null);
const counted = (r: TrialModeratorView) => !r.session.practice && r.session.consent?.agreed !== false && !r.mod.excluded;
const linkOf = (id: string) => `${window.location.origin}/trial/s/${id}`;

/** 主持人後台：每 5 秒更新清單。判定按「儲存判定」才寫入，紀錄不能在這裡刪，只能標記排除並寫理由 */
export function TrialDashboard() {
  const [rows, setRows] = useState<TrialModeratorView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trial", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `讀取失敗（${res.status}）。`);
      else {
        setRows(data.rows);
        setError(null);
        setLoaded(true);
      }
    } catch {
      setError("連不上伺服器，清單可能不是最新的。");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  // 有沒存的判定就離開頁面，先問一下
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const select = (id: string) => {
    if (id === selected) return;
    if (dirty && !window.confirm("這位的判定還沒儲存，確定要切換嗎？")) return;
    setDirty(false);
    setSelected(id);
  };

  const create = async (practice: boolean) => {
    if (dirty && !window.confirm("這位的判定還沒儲存，確定要切換嗎？")) return;
    const res = await fetch("/api/trial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ practice }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? `新增失敗（${res.status}）。`);
      return;
    }
    await load();
    setDirty(false);
    setSelected(data.id);
  };

  const real = rows.filter(counted);
  const current = rows.find((r) => r.session.id === selected) ?? null;

  return (
    <>
      <header className="ad-head">
        <div>
          <h1>學生試用後台</h1>
          <p>每來一位按「新增受試者」，把連結開在學生的電腦上。學生做完後，在這裡判定 T2、T3 並儲存。</p>
        </div>
        <div className="tr-actions">
          <button className="tr-btn primary" onClick={() => void create(false)}>
            新增受試者
          </button>
          <button className="tr-btn" onClick={() => void create(true)}>
            新增練習
          </button>
          <a className="tr-btn" href="/api/trial/export">
            匯出 CSV
          </a>
        </div>
      </header>

      <div className="ad-stats">
        <Stat label="正式受試者" value={real.length} hint="目標 8 位，最少 5 位" />
        <Stat label="已完成" value={real.filter((r) => r.step === "done").length} />
        <Stat label="進行中" value={real.filter((r) => r.step !== "done").length} />
        <Stat label="待判定" value={real.filter(needsJudging).length} tone={real.some(needsJudging) ? "warn" : undefined} hint="T2、T3 要你判定" />
      </div>

      {error ? (
        <p className="tr-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ad-grid">
        <section className="tr-card ad-list" aria-label="受試者清單">
          {rows.length === 0 ? (
            <p className="tr-pad tr-hint">{loaded ? "還沒有受試者。正式開始前，先按「新增練習」走一遍。" : "載入中…"}</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.session.id}>
                  <button className={r.session.id === selected ? "on" : undefined} onClick={() => select(r.session.id)}>
                    <b className="mono">{r.session.code}</b>
                    <span className="ad-tag">{r.session.group} 組</span>
                    <span className="ad-state">
                      {r.session.practice ? "練習・" : ""}
                      {r.mod.excluded ? "已排除" : STEP_LABEL[r.step]}
                    </span>
                    {needsJudging(r) ? <span className="ad-flag">待判定</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {current ? (
          <Detail key={current.session.id} row={current} onDirty={setDirty} onSaved={() => void load()} />
        ) : (
          <section className="tr-card tr-pad ad-empty">
            <p className="tr-hint">從左邊選一位，看結果並做判定。</p>
          </section>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <div className={tone === "warn" ? "ad-stat warn" : "ad-stat"}>
      <span>{label}</span>
      <b>{value}</b>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function Verdict({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return <span className={ok === null ? "ad-mark" : ok ? "ad-mark ok" : "ad-mark bad"}>{children}</span>;
}

function Detail({ row, onDirty, onSaved }: { row: TrialModeratorView; onDirty: (d: boolean) => void; onSaved: () => void }) {
  const s = row.session;
  const [mod, setMod] = useState<TrialMod>(row.mod);
  const [saved, setSaved] = useState<TrialMod>(row.mod);
  const [state, setState] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const dirty = JSON.stringify(mod) !== JSON.stringify(saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // 另一位主持人存了判定：這邊沒有在改的時候才跟著更新，不蓋掉正在填的內容
  const incoming = JSON.stringify(row.mod);
  useEffect(() => {
    const next = JSON.parse(incoming) as TrialMod;
    setSaved(next);
    setMod((m) => (JSON.stringify(m) === JSON.stringify(saved) ? next : m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const change = (patch: Partial<TrialMod>) => {
    setState(null);
    setMod((m) => ({ ...m, ...patch }));
  };

  const save = async () => {
    if (mod.excluded && !mod.excludeReason.trim()) {
      setState({ kind: "err", text: "排除任何一筆都要寫明理由。" });
      return;
    }
    setBusy(true);
    setState(null);
    const res = await fetch(`/api/trial/${s.id}/mod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mod),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setState({ kind: "err", text: data.error ?? "儲存失敗，內容還在，請再按一次。" });
      return;
    }
    setSaved(mod);
    setState({ kind: "ok", text: `已儲存 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` });
    onSaved();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkOf(s.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const a = s.manual.answer;
  const g = row.manualGrade;
  const t1 = row.t1Grade;

  return (
    <section className="tr-card ad-detail">
      <header className="tr-card-hd">
        <h2>
          <span className="mono">{s.code}</span>・{s.group} 組{s.practice ? "・練習（不計入）" : ""}
        </h2>
        <span className="ad-state">{STEP_LABEL[row.step]}</span>
        <div className="ad-link">
          <a className="tr-btn small" href={`/trial/s/${s.id}`} target="_blank" rel="noreferrer">
            開啟受試者頁
          </a>
          <button className="tr-btn small" onClick={() => void copy()}>
            {copied ? "已複製" : "複製連結"}
          </button>
        </div>
      </header>

      <div className="tr-pad tr-stack">
        <div>
          <h3 className="ad-sec">自動紀錄</h3>
          <dl className="ad-dl">
            <dt>手算・題目{row.manualSheet === 1 ? "一" : "二"}</dt>
            <dd>
              {s.manual.endedAt && g ? (
                <>
                  <span className="ad-line">
                    {row.manualMinutes} 分鐘，合計作答 {a?.total ?? "未填"}
                    {s.manual.gaveUp ? "，放棄" : ""}
                    {s.manual.timedOut ? "，超時" : ""}
                    {a?.uncertain ? "，標註不確定" : ""}
                  </span>
                  <span className="ad-marks">
                    <Verdict ok={g.allCategories}>各類別{g.allCategories ? "全對" : "有錯"}</Verdict>
                    <Verdict ok={g.domains}>通識領域{g.domains ? "對" : "錯"}</Verdict>
                    <Verdict ok={g.graduate}>畢業判斷{g.graduate ? "對" : "錯"}</Verdict>
                  </span>
                  {a?.note ? <span className="ad-quote">備註：{a.note}</span> : null}
                </>
              ) : (
                <span className="ad-wait">未完成</span>
              )}
            </dd>
            <dt>熟悉系統</dt>
            <dd>{row.seconds.orientation !== null ? `${row.seconds.orientation} 秒（不算進任務）` : <span className="ad-wait">未完成</span>}</dd>
            <dt>T1・題目{row.systemSheet === 1 ? "一" : "二"}</dt>
            <dd>
              {s.tasks.t1.endedAt && t1 ? (
                <>
                  <span className="ad-line">
                    {row.seconds.t1} 秒，作答 {s.tasks.t1.total ?? "未填"}（正確 {row.expectedTotal}）
                    {s.tasks.t1.gaveUp ? "，跳過" : ""}
                  </span>
                  <span className="ad-marks">
                    <Verdict ok={t1.total}>合計{t1.total ? "對" : "錯"}</Verdict>
                    <Verdict ok={t1.categories}>類別{t1.categories ? "對" : "錯"}</Verdict>
                  </span>
                </>
              ) : (
                <span className="ad-wait">未完成</span>
              )}
            </dd>
            <dt>問卷</dt>
            <dd>{s.survey ? `${s.survey.scores.join("、")}${s.survey.open ? `；${s.survey.open}` : ""}` : <span className="ad-wait">未完成</span>}</dd>
            <dt>對話紀錄</dt>
            <dd>
              {s.traceIds.length === 0 ? (
                <span className="ad-wait">尚無</span>
              ) : (
                <span className="ad-marks">
                  {s.traceIds.map((t) => (
                    <a key={t} className="mono" href={`/api/trace/${t}`} target="_blank" rel="noreferrer">
                      {t.slice(0, 8)}
                    </a>
                  ))}
                </span>
              )}
            </dd>
          </dl>
        </div>

        <div className="ad-judge">
          <h3 className="ad-sec">主持人判定</h3>
          <Judge
            label="T2 不確定事項與該問誰"
            hint="說得出待確認的畢業條件、原因是修課紀錄看不出來、要找系辦"
            seconds={row.seconds.t2}
            answer={s.tasks.t2.endedAt ? s.tasks.t2.text || "（未填）" : null}
            skipped={s.tasks.t2.gaveUp}
            value={mod.t2Ok}
            name={`${s.id}-t2`}
            onChange={(v) => change({ t2Ok: v })}
          />
          <Judge
            label="T3 星期五不要排課"
            hint="星期五真的沒課，並說得出改了哪門課"
            seconds={row.seconds.t3}
            answer={s.tasks.t3.endedAt ? s.tasks.t3.text || "（未填）" : null}
            skipped={s.tasks.t3.gaveUp}
            value={mod.t3Ok}
            name={`${s.id}-t3`}
            onChange={(v) => change({ t3Ok: v })}
          />
          <div className="ad-row">
            <span className="ad-label">你有協助的任務</span>
            <div className="tr-choices">
              {TASKS.map((t) => (
                <label key={t} className={mod.help[t] ? "tr-choice on" : "tr-choice"}>
                  <input type="checkbox" checked={mod.help[t]} onChange={(e) => change({ help: { ...mod.help, [t]: e.target.checked } })} />
                  {t.toUpperCase()}
                </label>
              ))}
            </div>
          </div>
          <label className="tr-text">
            主持人備註
            <textarea rows={2} maxLength={2000} value={mod.note} onChange={(e) => change({ note: e.target.value })} />
          </label>
          <div className="ad-row">
            <label className={mod.excluded ? "tr-choice danger" : "tr-choice"}>
              <input type="checkbox" checked={mod.excluded} onChange={(e) => change({ excluded: e.target.checked })} />
              排除這筆，不計入統計
            </label>
            {mod.excluded ? (
              <input
                className="ad-reason"
                placeholder="排除理由（必填）"
                maxLength={500}
                value={mod.excludeReason}
                onChange={(e) => change({ excludeReason: e.target.value })}
              />
            ) : null}
          </div>
        </div>
      </div>

      <footer className={dirty ? "ad-save dirty" : "ad-save"}>
        <span className={state?.kind === "err" ? "err" : undefined} role="status">
          {state?.text ?? (dirty ? "有尚未儲存的變更" : "判定都已儲存")}
        </span>
        <button className="tr-btn primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "儲存中…" : "儲存判定"}
        </button>
      </footer>
    </section>
  );
}

function Judge({
  label,
  hint,
  seconds,
  answer,
  skipped,
  value,
  name,
  onChange,
}: {
  label: string;
  hint: string;
  seconds: number | null;
  answer: string | null;
  skipped?: boolean;
  value: boolean | null;
  name: string;
  onChange: (v: boolean | null) => void;
}) {
  const options: { v: boolean | null; text: string }[] = [
    { v: true, text: "正確" },
    { v: false, text: "不正確" },
    { v: null, text: "未判定" },
  ];
  return (
    <div className="ad-j">
      <div className="ad-j-hd">
        <b>{label}</b>
        {seconds !== null ? <span className="mono">{seconds} 秒</span> : null}
        {skipped ? <span className="ad-flag">跳過</span> : null}
      </div>
      <p className="tr-hint">{hint}</p>
      {answer === null ? <p className="ad-wait">受試者還沒做到這裡</p> : <p className="ad-quote">{answer}</p>}
      <div className="tr-choices">
        {options.map((o) => (
          <label key={o.text} className={value === o.v ? "tr-choice on" : "tr-choice"}>
            <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)} />
            {o.text}
          </label>
        ))}
      </div>
    </div>
  );
}
