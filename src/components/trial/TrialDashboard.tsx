"use client";

import { useCallback, useEffect, useState } from "react";
import type { Step, TaskId, TrialMod, TrialModeratorView } from "@/lib/trial/session";

const STEP_LABEL: Record<Step, string> = {
  consent: "等待同意",
  declined: "不同意",
  "manual-intro": "準備手算",
  manual: "手算中",
  system: "用系統中",
  survey: "填問卷",
  done: "完成",
};

const yn = (b: boolean) => (b ? "對" : "錯");

/** 主持人後台：每 5 秒更新。代號與組別依新增順序自動給，紀錄不能在這裡刪，只能標記排除並寫理由 */
export function TrialDashboard() {
  const [rows, setRows] = useState<TrialModeratorView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trial", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `讀取失敗（${res.status}）。`);
      else {
        setRows(data.rows);
        setError(null);
      }
    } catch {
      setError("連不上伺服器。");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const create = async (practice: boolean) => {
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
    setCreated(data.id);
    await load();
  };

  const real = rows.filter((r) => !r.session.practice && r.session.consent?.agreed !== false);
  const done = real.filter((r) => r.step === "done").length;

  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <h2>學生試用後台</h2>
          <span className="hint">
            正式受試者 {real.length} 位，完成 {done} 位
          </span>
        </div>
        <div className="panel-bd trial-form">
          <div className="trial-actions">
            <button className="btn btn-primary" onClick={() => void create(false)}>
              新增受試者
            </button>
            <button className="btn" onClick={() => void create(true)}>
              新增練習（不計入）
            </button>
            <a className="btn" href="/api/trial/export">
              匯出 CSV
            </a>
          </div>
          {created ? (
            <p>
              受試者連結：<a href={`/trial/s/${created}`} target="_blank" rel="noreferrer">{`/trial/s/${created}`}</a>
            </p>
          ) : null}
          {error ? (
            <p className="rv-err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      {rows.map((r) => (
        <Row key={r.session.id} row={r} />
      ))}
    </>
  );
}

function Row({ row }: { row: TrialModeratorView }) {
  const { session: s } = row;
  const [mod, setMod] = useState<TrialMod>(row.mod);
  const [state, setState] = useState<string | null>(null);

  const save = async (next: TrialMod) => {
    setMod(next);
    if (next.excluded && !next.excludeReason.trim()) {
      setState("排除要寫理由，寫完才會儲存。");
      return;
    }
    const res = await fetch(`/api/trial/${s.id}/mod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setState(res?.ok ? "已儲存" : (data.error ?? "儲存失敗，請再試一次。"));
  };
  const toggleHelp = (t: TaskId, v: boolean) => void save({ ...mod, help: { ...mod.help, [t]: v } });
  const a = s.manual.answer;

  return (
    <div className="panel trial-row">
      <div className="panel-hd">
        <h2>
          {s.code}・{s.group} 組{s.practice ? "・練習" : ""}
        </h2>
        <span className="hint">{STEP_LABEL[row.step]}</span>
        <a href={`/trial/s/${s.id}`} target="_blank" rel="noreferrer" className="trial-link">
          受試者連結
        </a>
      </div>
      <div className="panel-bd trial-form">
        <dl className="trial-dl">
          <dt>手算（題目{row.manualSheet === 1 ? "一" : "二"}）</dt>
          <dd>
            {s.manual.endedAt ? (
              <>
                {row.manualMinutes} 分鐘，合計作答 {a?.total ?? "未填"}；各類別 {row.manualGrade ? yn(row.manualGrade.allCategories) : ""}、通識領域{" "}
                {row.manualGrade ? yn(row.manualGrade.domains) : ""}、畢業判斷 {row.manualGrade ? yn(row.manualGrade.graduate) : ""}
                {s.manual.gaveUp ? "；放棄" : ""}
                {s.manual.timedOut ? "；超時" : ""}
                {a?.uncertain ? "；標註不確定" : ""}
                {a?.note ? `；備註：${a.note}` : ""}
              </>
            ) : (
              "未完成"
            )}
          </dd>
          <dt>T1（題目{row.systemSheet === 1 ? "一" : "二"}，正確合計 {row.expectedTotal}）</dt>
          <dd>
            {s.tasks.t1.endedAt ? (
              <>
                {row.seconds.t1} 秒，作答 {s.tasks.t1.total ?? "未填"}；合計 {yn(row.t1Grade?.total ?? false)}、類別 {yn(row.t1Grade?.categories ?? false)}
                {s.tasks.t1.gaveUp ? "；跳過" : ""}
              </>
            ) : (
              "未完成"
            )}
          </dd>
          <dt>T2</dt>
          <dd>{s.tasks.t2.endedAt ? `${row.seconds.t2} 秒${s.tasks.t2.gaveUp ? "；跳過" : ""}：${s.tasks.t2.text || "（未填）"}` : "未完成"}</dd>
          <dt>T3</dt>
          <dd>{s.tasks.t3.endedAt ? `${row.seconds.t3} 秒${s.tasks.t3.gaveUp ? "；跳過" : ""}：${s.tasks.t3.text || "（未填）"}` : "未完成"}</dd>
          <dt>對話紀錄</dt>
          <dd>
            {s.traceIds.length === 0
              ? "尚無"
              : s.traceIds.map((t) => (
                  <a key={t} href={`/api/trace/${t}`} target="_blank" rel="noreferrer" className="trial-link">
                    {t.slice(0, 8)}
                  </a>
                ))}
          </dd>
        </dl>

        <div className="trial-opts">
          {(["t1", "t2", "t3"] as TaskId[]).map((t) => (
            <label key={t}>
              <input type="checkbox" checked={mod.help[t]} onChange={(e) => toggleHelp(t, e.target.checked)} /> {t.toUpperCase()} 有協助
            </label>
          ))}
          <Judge label="T2 完成且正確" value={mod.t2Ok} onChange={(v) => void save({ ...mod, t2Ok: v })} />
          <Judge label="T3 完成且正確" value={mod.t3Ok} onChange={(v) => void save({ ...mod, t3Ok: v })} />
        </div>
        <label className="trial-block">
          主持人備註
          <textarea rows={2} maxLength={2000} value={mod.note} onChange={(e) => setMod({ ...mod, note: e.target.value })} onBlur={() => void save(mod)} />
        </label>
        <div className="trial-opts">
          <label>
            <input type="checkbox" checked={mod.excluded} onChange={(e) => void save({ ...mod, excluded: e.target.checked })} /> 排除這筆
          </label>
          {mod.excluded ? (
            <label className="trial-grow">
              排除理由（必填）
              <input maxLength={500} value={mod.excludeReason} onChange={(e) => setMod({ ...mod, excludeReason: e.target.value })} onBlur={() => void save(mod)} />
            </label>
          ) : null}
          {state ? <span className="rv-hint">{state}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Judge({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <label>
      {label}{" "}
      <select value={value === null ? "" : value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}>
        <option value="">未判定</option>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    </label>
  );
}
