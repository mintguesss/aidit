"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TRIAL_CHANNEL } from "@/lib/trial/channel";
import type { ManualAnswer, TaskId, TrialAction, TrialPublicView } from "@/lib/trial/session";

const IDENTITIES = ["大一", "大二", "大三", "大四", "碩士班", "其他"];
const LAST_CHECK = ["沒確認過", "10 分鐘內", "10–30 分鐘", "30–60 分鐘", "超過 1 小時"];
const SURVEY = [
  "系統比手算更快知道還差什麼",
  "我看得懂系統算出來的結果",
  "系統附上依據，讓我更相信結果",
  "系統說「不確定、請問承辦單位」時，我可以接受",
  "如果學校提供，我下學期選課前會使用",
];

/** 受試者的流程。每一步的狀態都在伺服器，重新整理或斷線後會回到同一步、時間照算 */
export function TrialRunner({ id }: { id: string }) {
  const [view, setView] = useState<TrialPublicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/trial/${id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? `讀取失敗（${res.status}）。`);
    else setView(data);
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError("連不上伺服器，請檢查網路後重新整理。"));
  }, [load]);

  const send = useCallback(
    async (action: TrialAction): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/trial/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? `送出失敗（${res.status}）。`);
          return false;
        }
        setView(data);
        return true;
      } catch {
        setError("送出失敗，請檢查網路後再按一次，作答內容還在。");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  // 系統分頁的對話一回來，就記下 traceId
  const step = view?.step;
  useEffect(() => {
    if (step !== "system" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(TRIAL_CHANNEL);
    ch.onmessage = (e: MessageEvent<{ traceId?: string }>) => {
      if (e.data?.traceId) {
        void fetch(`/api/trial/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "trace", traceId: e.data.traceId }),
        }).catch(() => undefined);
      }
    };
    return () => ch.close();
  }, [step, id]);

  if (!view) return <div className="panel panel-bd">{error ?? "載入中…"}</div>;

  return (
    <>
      <p className="trial-meta">代號 {view.code}</p>
      {error ? (
        <p className="rv-err trial-error" role="alert">
          {error}
        </p>
      ) : null}
      {view.step === "consent" ? <Consent busy={busy} send={send} /> : null}
      {view.step === "declined" ? <Message title="謝謝你" text="你選擇不參與，紀錄到此結束。" /> : null}
      {view.step === "manual-intro" ? <ManualIntro busy={busy} send={send} /> : null}
      {view.step === "manual" ? <Manual id={id} view={view} busy={busy} send={send} /> : null}
      {view.step === "system" ? <SystemTasks view={view} busy={busy} send={send} /> : null}
      {view.step === "survey" ? <Survey busy={busy} send={send} /> : null}
      {view.step === "done" ? <Message title="試用完成，謝謝你" text="紀錄已送出，可以把裝置交回給主持人。" /> : null}
    </>
  );
}

type Send = (a: TrialAction) => Promise<boolean>;

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>{title}</h2>
      </div>
      <div className="panel-bd">{text}</div>
    </div>
  );
}

function Consent({ busy, send }: { busy: boolean; send: Send }) {
  const [identity, setIdentity] = useState("");
  const [minor, setMinor] = useState<boolean | null>(null);
  const [lastCheck, setLastCheck] = useState("");
  const ready = identity && minor !== null && lastCheck;
  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>參與同意與基本資料</h2>
      </div>
      <div className="panel-bd trial-form">
        <p>
          這是學生競賽作品的試用，約 25 分鐘。我們會記錄你的作答與操作時間，只用於競賽文件，以代號呈現，不記姓名與學號，也不會用到你自己的成績。
          你可以隨時退出；決賽結束後，原始紀錄會刪除，只保留去識別的統計。系統結果僅供參考，不是學校的正式審查。
        </p>
        <fieldset>
          <legend>身分</legend>
          <div className="trial-opts">
            {IDENTITIES.map((v) => (
              <label key={v}>
                <input type="radio" name="identity" checked={identity === v} onChange={() => setIdentity(v)} /> {v}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>是否正在修或打算修學程、輔系、雙主修</legend>
          <div className="trial-opts">
            <label>
              <input type="radio" name="minor" checked={minor === true} onChange={() => setMinor(true)} /> 是
            </label>
            <label>
              <input type="radio" name="minor" checked={minor === false} onChange={() => setMinor(false)} /> 否
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>上次確認自己的畢業進度，大約花多久</legend>
          <div className="trial-opts">
            {LAST_CHECK.map((v) => (
              <label key={v}>
                <input type="radio" name="lastCheck" checked={lastCheck === v} onChange={() => setLastCheck(v)} /> {v}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="trial-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !ready}
            onClick={() =>
              void send({ type: "consent", agreed: true, profile: { identity, minorProgram: minor === true, lastCheck } })
            }
          >
            我同意參與
          </button>
          <button className="btn" disabled={busy} onClick={() => void send({ type: "consent", agreed: false })}>
            我不同意
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualIntro({ busy, send }: { busy: boolean; send: Send }) {
  return (
    <div className="panel" data-anon-keep>
      <div className="panel-hd">
        <h2>第一部分：手算</h2>
      </div>
      <div className="panel-bd trial-form">
        <ul>
          <li>下一頁是一位 111 學年度入學、資訊管理學系學生的修課紀錄（皆已及格）。</li>
          <li>請只用主持人提供的課程規劃表與修業規則計算，不要使用本系統或任何 AI。</li>
          <li>寫出各類別還差幾學分、合計、通識還缺哪些領域，以及是否已符合畢業學分。</li>
          <li>超過應修學分的部分不能補到其他類別（請依修業規則判斷）。</li>
          <li>資料不足無法判斷的地方，請寫在備註，不要硬猜。</li>
          <li>上限 15 分鐘，時間到會自動交卷。算不完或想放棄都沒關係，這也是有用的資料。</li>
        </ul>
        <button className="btn btn-primary" disabled={busy} onClick={() => void send({ type: "manual.start" })}>
          開始手算並計時
        </button>
      </div>
    </div>
  );
}

const formatClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Draft = {
  categories: Record<string, string>;
  total: string;
  missingDomains: string[];
  canGraduate: boolean | null;
  note: string;
  uncertain: boolean;
};
const EMPTY_DRAFT: Draft = { categories: {}, total: "", missingDomains: [], canGraduate: null, note: "", uncertain: false };

const num = (s: string) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 300 ? n : null;
};

function Manual({ id, view, busy, send }: { id: string; view: TrialPublicView; busy: boolean; send: Send }) {
  const key = `trial-draft-${id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return { ...EMPTY_DRAFT, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<Draft>) };
    } catch {
      return EMPTY_DRAFT;
    }
  });
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 存不了草稿就算了：只差在重新整理時要重填
      }
      return next;
    });

  // 用伺服器時間倒數，受試者裝置的時鐘不準也不影響
  const offset = useRef(view.now - Date.now());
  const deadline = (view.manual.startedAt ?? view.now) + view.manual.limitMs;
  const [left, setLeft] = useState(deadline - view.now);

  const answer = (): ManualAnswer => ({
    categories: Object.fromEntries(view.categories.map((c) => [c.name, num(draft.categories[c.name] ?? "")])),
    total: num(draft.total),
    missingDomains: draft.missingDomains,
    canGraduate: draft.canGraduate,
    note: draft.note,
    uncertain: draft.uncertain,
  });
  const submit = (gaveUp: boolean) => send({ type: "manual.submit", answer: answer(), gaveUp });

  const latest = useRef(submit);
  latest.current = submit;
  const timedOut = useRef(false);
  useEffect(() => {
    const tick = () => {
      const remaining = deadline - (Date.now() + offset.current);
      setLeft(remaining);
      if (remaining <= 0 && !timedOut.current) {
        timedOut.current = true;
        void latest.current(false);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);

  return (
    // 手算對照的是紙本規劃表，畫面用字要和紙本相同，不做匿名替換
    <div className="panel" data-anon-keep>
      <div className="panel-hd trial-timer-hd">
        <h2>手算題目</h2>
        <span className={left < 60_000 ? "trial-timer urgent" : "trial-timer"} role="timer">
          剩 {formatClock(left)}
        </span>
      </div>
      <div className="panel-bd trial-form">
        <div className="trial-sheet">
          <table>
            <thead>
              <tr>
                <th>學年-學期</th>
                <th>課名</th>
                <th>學分</th>
                <th>選別</th>
                <th>通識領域</th>
                <th>開課單位</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {view.rows?.map((r, i) => (
                <tr key={i}>
                  <td>{r.term}</td>
                  <td>{r.name}</td>
                  <td>{r.credits}</td>
                  <td>{r.type}</td>
                  <td>{r.domain}</td>
                  <td>{r.dept}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rv-hint">選別：必＝必修、選＝選修、通＝通識。開課單位「外系」表示非本系開設。</p>

        <h3>各類別還差幾學分</h3>
        <div className="trial-grid">
          {view.categories.map((c) => (
            <label key={c.name}>
              {c.name}（應修 {c.required}）
              <input
                inputMode="numeric"
                value={draft.categories[c.name] ?? ""}
                onChange={(e) => update({ categories: { ...draft.categories, [c.name]: e.target.value } })}
              />
            </label>
          ))}
          <label>
            合計還差
            <input inputMode="numeric" value={draft.total} onChange={(e) => update({ total: e.target.value })} />
          </label>
        </div>

        <fieldset>
          <legend>通識還缺的領域（各至少 4 學分）</legend>
          <div className="trial-opts">
            {view.domains.map((d) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={draft.missingDomains.includes(d)}
                  onChange={(e) =>
                    update({
                      missingDomains: e.target.checked
                        ? [...draft.missingDomains, d]
                        : draft.missingDomains.filter((x) => x !== d),
                    })
                  }
                />{" "}
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>已符合畢業學分？</legend>
          <div className="trial-opts">
            <label>
              <input type="radio" name="grad" checked={draft.canGraduate === true} onChange={() => update({ canGraduate: true })} /> 是
            </label>
            <label>
              <input type="radio" name="grad" checked={draft.canGraduate === false} onChange={() => update({ canGraduate: false })} /> 否
            </label>
          </div>
        </fieldset>
        <label className="trial-block">
          備註（無法判斷的地方）
          <textarea rows={3} maxLength={2000} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={draft.uncertain} onChange={(e) => update({ uncertain: e.target.checked })} /> 有部分我無法判斷
        </label>
        <div className="trial-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit(false)}>
            交卷
          </button>
          <button className="btn" disabled={busy} onClick={() => void submit(true)}>
            放棄
          </button>
        </div>
      </div>
    </div>
  );
}

const TASK_TEXT: Record<TaskId, string> = {
  t1: "這位學生還差幾學分？缺哪幾類？",
  t2: "系統有不確定的事項嗎？原因是什麼、該問誰？",
  t3: "用對話把課表改成「星期五不要排課」，並說出改了什麼。",
};

function SystemTasks({ view, busy, send }: { view: TrialPublicView; busy: boolean; send: Send }) {
  const [total, setTotal] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [text, setText] = useState("");
  const current = (["t1", "t2", "t3"] as TaskId[]).find((t) => !view.tasks[t].endedAt) ?? "t3";
  const started = Boolean(view.tasks[current].startedAt);
  const index = ["t1", "t2", "t3"].indexOf(current) + 1;

  const start = () => {
    // 要在點擊當下開分頁才不會被瀏覽器擋；之後的任務沿用同一個分頁
    if (current === "t1" && view.systemUrl) window.open(view.systemUrl, "aidit-trial-system");
    void send({ type: "task.start", task: current });
  };
  const finish = async (gaveUp: boolean) => {
    const ok = await send(
      current === "t1"
        ? { type: "task.submit", task: current, gaveUp, total: num(total), categories: cats }
        : { type: "task.submit", task: current, gaveUp, text },
    );
    if (ok) setText("");
  };

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>
          第二部分：用系統（任務 {index}／3）
        </h2>
      </div>
      <div className="panel-bd trial-form">
        <p className="trial-task">{TASK_TEXT[current]}</p>
        {!started ? (
          <>
            <p className="rv-hint">
              {current === "t1"
                ? "按下開始後會開啟系統分頁並計時。在系統裡找到答案，再回到這一頁填寫。"
                : "按下開始後計時，到系統分頁操作，完成後回到這一頁。"}
            </p>
            <button className="btn btn-primary" disabled={busy} onClick={start}>
              開始任務 {index}
            </button>
          </>
        ) : (
          <>
            {current === "t1" ? (
              <>
                <label className="trial-block">
                  合計還差幾學分
                  <input inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
                </label>
                <fieldset>
                  <legend>缺哪幾類</legend>
                  <div className="trial-opts">
                    {view.categories.map((c) => (
                      <label key={c.name}>
                        <input
                          type="checkbox"
                          checked={cats.includes(c.name)}
                          onChange={(e) =>
                            setCats(e.target.checked ? [...cats, c.name] : cats.filter((x) => x !== c.name))
                          }
                        />{" "}
                        {c.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : (
              <label className="trial-block">
                {current === "t2" ? "原因與該問誰" : "改了什麼"}
                <textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            <div className="trial-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => void finish(false)}>
                完成，下一步
              </button>
              <button className="btn" disabled={busy} onClick={() => void finish(true)}>
                做不出來，跳過
              </button>
            </div>
            {view.systemUrl ? (
              <p className="rv-hint">
                系統分頁不見了？
                <a href={view.systemUrl} target="aidit-trial-system">
                  重新開啟
                </a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Survey({ busy, send }: { busy: boolean; send: Send }) {
  const [scores, setScores] = useState<(number | null)[]>([null, null, null, null, null]);
  const [open, setOpen] = useState("");
  const ready = scores.every((s) => s !== null);
  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>回饋</h2>
        <span className="hint">1＝非常不同意，5＝非常同意</span>
      </div>
      <div className="panel-bd trial-form">
        {SURVEY.map((q, i) => (
          <fieldset key={q}>
            <legend>{q}</legend>
            <div className="trial-opts">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n}>
                  <input
                    type="radio"
                    name={`q${i}`}
                    checked={scores[i] === n}
                    onChange={() => setScores(scores.map((s, j) => (j === i ? n : s)))}
                  />{" "}
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="trial-block">
          哪裡讓你最困惑，或最希望它多做什麼？
          <textarea rows={4} maxLength={4000} value={open} onChange={(e) => setOpen(e.target.value)} />
        </label>
        <button
          className="btn btn-primary"
          disabled={busy || !ready}
          onClick={() =>
            void send({ type: "survey", scores: scores as [number, number, number, number, number], open })
          }
        >
          送出
        </button>
      </div>
    </div>
  );
}
