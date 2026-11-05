"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { resetSystemState, TRIAL_CHANNEL } from "@/lib/trial/channel";
import type { ManualAnswer, SheetRow, Step, TaskId, TrialAction, TrialPublicView } from "@/lib/trial/session";
import { PlanReference, RulesReference } from "./TrialReference";

const IDENTITIES = ["大一", "大二", "大三", "大四", "碩士班", "其他"];
const LAST_CHECK = ["沒確認過", "10 分鐘內", "10–30 分鐘", "30–60 分鐘", "超過 1 小時"];
const SURVEY = [
  "系統比手算更快知道還差什麼",
  "我看得懂系統算出來的結果",
  "系統附上依據，讓我更相信結果",
  "系統說「不確定、請問承辦單位」時，我可以接受",
  "如果學校提供，我下學期選課前會使用",
];
const SYSTEM_WINDOW = "aidit-trial-system";
const STAGES: { label: string; steps: Step[] }[] = [
  { label: "同意", steps: ["consent", "declined"] },
  { label: "手算", steps: ["manual-intro", "manual"] },
  { label: "看看系統", steps: ["orientation"] },
  { label: "系統任務", steps: ["system"] },
  { label: "回饋", steps: ["survey"] },
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

  // 伺服器是讀出、修改、寫回，兩個請求重疊時後寫的會蓋掉先寫的（例如交卷和 traceId 同時到）。
  // 這一頁的寫入一個接一個送
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const patch = useCallback(
    (action: TrialAction) => {
      const run = () =>
        fetch(`/api/trial/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [id],
  );

  const send = useCallback(
    async (action: TrialAction): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await patch(action);
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
    [patch],
  );

  // 系統分頁的對話一回來，就記下 traceId。熟悉系統時的對話不記，那不是任務
  const step = view?.step;
  useEffect(() => {
    if (step !== "system" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(TRIAL_CHANNEL);
    ch.onmessage = (e: MessageEvent<{ traceId?: string }>) => {
      if (e.data?.traceId) void patch({ type: "trace", traceId: e.data.traceId }).catch(() => undefined);
    };
    return () => ch.close();
  }, [step, patch]);

  if (!view) return <div className="tr-card tr-pad">{error ?? "載入中…"}</div>;

  return (
    <>
      <Stepper step={view.step} code={view.code} />
      {error ? (
        <p className="tr-alert" role="alert">
          {error}
        </p>
      ) : null}
      {view.step === "consent" ? <Consent busy={busy} send={send} /> : null}
      {view.step === "declined" ? <Message title="謝謝你" text="你選擇不參與，紀錄到此結束。" /> : null}
      {view.step === "manual-intro" ? <ManualIntro busy={busy} send={send} /> : null}
      {view.step === "manual" ? <Manual id={id} view={view} busy={busy} send={send} /> : null}
      {view.step === "orientation" ? <Orientation view={view} busy={busy} send={send} /> : null}
      {view.step === "system" ? <SystemTasks view={view} busy={busy} send={send} /> : null}
      {view.step === "survey" ? <Survey busy={busy} send={send} /> : null}
      {view.step === "done" ? <Message title="試用完成，謝謝你" text="紀錄已送出，可以把裝置交回給主持人。" /> : null}
    </>
  );
}

type Send = (a: TrialAction) => Promise<boolean>;

function Stepper({ step, code }: { step: Step; code: string }) {
  const finished = step === "done";
  const current = STAGES.findIndex((s) => s.steps.includes(step));
  return (
    <div className="tr-stepper">
      <ol>
        {STAGES.map((s, i) => {
          const state = finished || i < current ? "done" : i === current ? "now" : "next";
          return (
            <li key={s.label} className={state} aria-current={state === "now" ? "step" : undefined}>
              <span className="tr-dot">{state === "done" ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <span className="tr-code">{code}</span>
    </div>
  );
}

function Card({ title, aside, children, keep }: { title: string; aside?: ReactNode; children: ReactNode; keep?: boolean }) {
  return (
    <section className="tr-card" {...(keep ? { "data-anon-keep": true } : {})}>
      <header className="tr-card-hd">
        <h1>{title}</h1>
        {aside}
      </header>
      <div className="tr-pad tr-stack">{children}</div>
    </section>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <Card title={title}>
      <p>{text}</p>
    </Card>
  );
}

/** 單選、複選都長成同一種按鈕，整塊可以點，手機也好按 */
function Choice({
  type = "radio",
  name,
  checked,
  onChange,
  children,
}: {
  type?: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={checked ? "tr-choice on" : "tr-choice"}>
      <input type={type} name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="tr-field">
      <legend>{label}</legend>
      {hint ? <p className="tr-hint">{hint}</p> : null}
      <div className="tr-choices">{children}</div>
    </fieldset>
  );
}

function Consent({ busy, send }: { busy: boolean; send: Send }) {
  const [identity, setIdentity] = useState("");
  const [minor, setMinor] = useState<boolean | null>(null);
  const [lastCheck, setLastCheck] = useState("");
  const ready = identity && minor !== null && lastCheck;
  return (
    <Card title="參與同意與基本資料">
      <div className="tr-note">
        <p>
          這是學生競賽作品的試用，約 25 分鐘。我們會記錄你的作答與操作時間，只用於競賽文件，以代號呈現，不記姓名與學號，也不會用到你自己的成績。
        </p>
        <p>你可以隨時退出；決賽結束後，原始紀錄會刪除，只保留去識別的統計。系統結果僅供參考，不是學校的正式審查。</p>
      </div>
      <Field label="身分">
        {IDENTITIES.map((v) => (
          <Choice key={v} name="identity" checked={identity === v} onChange={() => setIdentity(v)}>
            {v}
          </Choice>
        ))}
      </Field>
      <Field label="是否正在修或打算修學程、輔系、雙主修">
        <Choice name="minor" checked={minor === true} onChange={() => setMinor(true)}>
          是
        </Choice>
        <Choice name="minor" checked={minor === false} onChange={() => setMinor(false)}>
          否
        </Choice>
      </Field>
      <Field label="上次確認自己的畢業進度，大約花多久">
        {LAST_CHECK.map((v) => (
          <Choice key={v} name="lastCheck" checked={lastCheck === v} onChange={() => setLastCheck(v)}>
            {v}
          </Choice>
        ))}
      </Field>
      <div className="tr-actions">
        <button
          className="tr-btn primary"
          disabled={busy || !ready}
          onClick={() => {
            resetSystemState();
            void send({ type: "consent", agreed: true, profile: { identity, minorProgram: minor === true, lastCheck } });
          }}
        >
          我同意參與
        </button>
        <button className="tr-btn" disabled={busy} onClick={() => void send({ type: "consent", agreed: false })}>
          我不同意
        </button>
        {!ready ? <span className="tr-hint">填完上面三題才能按同意</span> : null}
      </div>
    </Card>
  );
}

function ManualIntro({ busy, send }: { busy: boolean; send: Send }) {
  return (
    <Card title="第一部分：手算" keep>
      <ul className="tr-list">
        <li>下一頁是一位 111 學年度入學、資訊管理學系學生的修課紀錄（皆已及格）。</li>
        <li>課程規劃表與修業規則也在下一頁，用上方的分頁切換。請只用這些資料計算，不要使用本系統或任何 AI。</li>
        <li>寫出各類別還差幾學分、合計、通識還缺哪些領域，以及是否已符合畢業學分。</li>
        <li>超過應修學分的部分不能補到其他類別（請依修業規則判斷）。</li>
        <li>資料不足無法判斷的地方，請寫在備註，不要硬猜。</li>
        <li>上限 15 分鐘，時間到會自動交卷。算不完或想放棄都沒關係，這也是有用的資料。</li>
      </ul>
      <div className="tr-actions">
        <button className="tr-btn primary" disabled={busy} onClick={() => void send({ type: "manual.start" })}>
          開始手算並計時
        </button>
      </div>
    </Card>
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
  const limit = view.manual.limitMs;
  const deadline = (view.manual.startedAt ?? view.now) + limit;
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

  const giveUp = () => {
    if (window.confirm("確定要放棄手算嗎？已填的內容會一起送出。")) void submit(true);
  };

  return (
    <section className="tr-manual" data-anon-keep>
      <div className={left < 60_000 ? "tr-timer urgent" : "tr-timer"} role="timer">
        <div>
          <b>手算題目</b>
          <span className="tr-hint">只用下方的資料，不要用系統或 AI</span>
        </div>
        <span className="tr-clock">剩 {formatClock(left)}</span>
        <span className="tr-timebar" aria-hidden>
          <i style={{ width: `${Math.max(0, Math.min(100, (left / limit) * 100))}%` }} />
        </span>
      </div>

      <div className="tr-manual-grid">
        <ManualMaterials rows={view.rows ?? []} />

        <div className="tr-card tr-pad tr-stack tr-answer">
          <div className="tr-field">
            <h2>各類別還差幾學分</h2>
            <div className="tr-credits">
              {view.categories.map((c) => (
                <label key={c.name}>
                  <span>
                    {c.name}
                    <small>應修 {c.required}</small>
                  </span>
                  <input
                    inputMode="numeric"
                    value={draft.categories[c.name] ?? ""}
                    onChange={(e) => update({ categories: { ...draft.categories, [c.name]: e.target.value } })}
                  />
                </label>
              ))}
              <label className="total">
                <span>合計還差</span>
                <input inputMode="numeric" value={draft.total} onChange={(e) => update({ total: e.target.value })} />
              </label>
            </div>
          </div>

          <div className="tr-answer-row">
            <Field label="通識還缺的領域" hint="三大領域各至少 4 學分">
              {view.domains.map((d) => (
                <Choice
                  key={d}
                  type="checkbox"
                  checked={draft.missingDomains.includes(d)}
                  onChange={(on) =>
                    update({ missingDomains: on ? [...draft.missingDomains, d] : draft.missingDomains.filter((x) => x !== d) })
                  }
                >
                  {d}
                </Choice>
              ))}
            </Field>
            <Field label="已符合畢業學分？">
              <Choice name="grad" checked={draft.canGraduate === true} onChange={() => update({ canGraduate: true })}>
                是
              </Choice>
              <Choice name="grad" checked={draft.canGraduate === false} onChange={() => update({ canGraduate: false })}>
                否
              </Choice>
            </Field>
          </div>
          <label className="tr-text">
            備註（無法判斷的地方）
            <textarea rows={3} maxLength={2000} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
          </label>
          <Choice type="checkbox" checked={draft.uncertain} onChange={(on) => update({ uncertain: on })}>
            有部分我無法判斷
          </Choice>
          <div className="tr-actions">
            <button className="tr-btn primary" disabled={busy} onClick={() => void submit(false)}>
              交卷
            </button>
            <button className="tr-btn" disabled={busy} onClick={giveUp}>
              放棄
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

const MATERIALS = [
  { id: "record", label: "修課紀錄" },
  { id: "plan", label: "課程規劃表" },
  { id: "rules", label: "修業規則" },
] as const;

/** 手算要用的三份資料，用分頁切換，答題欄留在旁邊不動 */
function ManualMaterials({ rows }: { rows: SheetRow[] }) {
  const [tab, setTab] = useState<(typeof MATERIALS)[number]["id"]>("record");
  return (
    <div className="tr-card tr-materials">
      <div className="tr-tabs" role="tablist" aria-label="手算資料">
        {MATERIALS.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={tab === m.id} onClick={() => setTab(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {tab === "record" ? (
        <div className="tr-sheet">
          <table>
            <thead>
              <tr>
                <th>學期</th>
                <th>課名</th>
                <th>學分</th>
                <th>選別</th>
                <th>通識領域</th>
                <th>開課單位</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.term}</td>
                  <td>{r.name}</td>
                  <td className="mono">{r.credits}</td>
                  <td>{r.type}</td>
                  <td>{r.domain}</td>
                  <td>{r.dept}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tr-hint tr-sheet-note">
            選別：必＝必修、選＝選修、通＝通識。開課單位「外系」表示非本系開設。備註「入學前抵免」的課程，學分已認列。
          </p>
        </div>
      ) : null}
      {tab === "plan" ? <PlanReference /> : null}
      {tab === "rules" ? <RulesReference /> : null}
    </div>
  );
}

function Orientation({ view, busy, send }: { view: TrialPublicView; busy: boolean; send: Send }) {
  const started = Boolean(view.orientation.startedAt);
  const open = () => {
    // 要在點擊當下開分頁才不會被瀏覽器擋；之後的任務沿用同一個分頁
    if (view.demoUrl) window.open(view.demoUrl, SYSTEM_WINDOW);
    void send({ type: "orientation.start" });
  };
  return (
    <Card title="先看看系統（約 1 分鐘）">
      <p>
        手算結束了。接下來的任務要用系統操作，先花 1 分鐘隨意點點看。這裡看到的是另一位示範學生，<b>不是任務的案例</b>，不算進任務時間。
      </p>
      {!started ? (
        <div className="tr-actions">
          <button className="tr-btn primary" disabled={busy} onClick={open}>
            開啟系統
          </button>
        </div>
      ) : (
        <>
          <p className="tr-hint">
            系統開在另一個分頁。看完回到這裡。
            {view.demoUrl ? (
              <>
                {" "}
                分頁不見了？
                <a href={view.demoUrl} target={SYSTEM_WINDOW}>
                  重新開啟
                </a>
              </>
            ) : null}
          </p>
          <div className="tr-actions">
            <button className="tr-btn primary" disabled={busy} onClick={() => void send({ type: "orientation.end" })}>
              看完了，開始任務
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

const TASK_TEXT: Record<TaskId, string> = {
  t1: "這位學生還差幾學分？缺哪幾類？",
  t2: "系統有不確定的事項嗎？原因是什麼、該問誰？",
  t3: "用對話把課表改成「星期五不要排課」，並說出改了什麼。",
};
const TASKS: TaskId[] = ["t1", "t2", "t3"];

function SystemTasks({ view, busy, send }: { view: TrialPublicView; busy: boolean; send: Send }) {
  const [total, setTotal] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [text, setText] = useState("");
  const current = TASKS.find((t) => !view.tasks[t].endedAt) ?? "t3";
  const started = Boolean(view.tasks[current].startedAt);
  const index = TASKS.indexOf(current) + 1;

  const start = () => {
    // 每個任務都把系統分頁帶回任務的案例，就算剛才留在導覽學生或切到別的案例也不會做錯人
    if (view.systemUrl) window.open(view.systemUrl, SYSTEM_WINDOW);
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
    <Card
      title={`第二部分：用系統`}
      aside={
        <span className="tr-tasks" aria-label={`任務 ${index}／3`}>
          {TASKS.map((t, i) => (
            <i key={t} className={i + 1 < index ? "done" : i + 1 === index ? "now" : undefined} />
          ))}
          任務 {index}／3
        </span>
      }
    >
      <p className="tr-task">{TASK_TEXT[current]}</p>
      {!started ? (
        <>
          <p className="tr-hint">
            {current === "t1"
              ? "按下開始後，系統分頁會換成這次任務的學生，並開始計時。找到答案再回來填。"
              : "按下開始後計時，到系統分頁操作，完成後回到這一頁。"}
            {view.systemStudent ? ` 系統右上角要顯示「${view.systemStudent}」。` : ""}
          </p>
          <div className="tr-actions">
            <button className="tr-btn primary" disabled={busy} onClick={start}>
              開始任務 {index}
            </button>
          </div>
        </>
      ) : (
        <>
          {current === "t1" ? (
            <>
              <label className="tr-text narrow">
                合計還差幾學分
                <input inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
              </label>
              <Field label="缺哪幾類">
                {view.categories.map((c) => (
                  <Choice
                    key={c.name}
                    type="checkbox"
                    checked={cats.includes(c.name)}
                    onChange={(on) => setCats(on ? [...cats, c.name] : cats.filter((x) => x !== c.name))}
                  >
                    {c.name}
                  </Choice>
                ))}
              </Field>
            </>
          ) : (
            <label className="tr-text">
              {current === "t2" ? "原因與該問誰" : "改了什麼"}
              <textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          <div className="tr-actions">
            <button className="tr-btn primary" disabled={busy} onClick={() => void finish(false)}>
              完成，下一步
            </button>
            <button className="tr-btn" disabled={busy} onClick={() => void finish(true)}>
              做不出來，跳過
            </button>
            {view.systemUrl ? (
              <span className="tr-hint">
                系統分頁不見了？
                <a href={view.systemUrl} target={SYSTEM_WINDOW}>
                  重新開啟
                </a>
              </span>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}

function Survey({ busy, send }: { busy: boolean; send: Send }) {
  const [scores, setScores] = useState<(number | null)[]>([null, null, null, null, null]);
  const [open, setOpen] = useState("");
  const ready = scores.every((s) => s !== null);
  return (
    <Card title="回饋">
      {SURVEY.map((q, i) => (
        <fieldset className="tr-field" key={q}>
          <legend>
            {i + 1}. {q}
          </legend>
          <div className="tr-likert">
            <span>非常不同意</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <Choice key={n} name={`q${i}`} checked={scores[i] === n} onChange={() => setScores(scores.map((s, j) => (j === i ? n : s)))}>
                {n}
              </Choice>
            ))}
            <span>非常同意</span>
          </div>
        </fieldset>
      ))}
      <label className="tr-text">
        哪裡讓你最困惑，或最希望它多做什麼？
        <textarea rows={4} maxLength={4000} value={open} onChange={(e) => setOpen(e.target.value)} />
      </label>
      <div className="tr-actions">
        <button
          className="tr-btn primary"
          disabled={busy || !ready}
          onClick={() => void send({ type: "survey", scores: scores as [number, number, number, number, number], open })}
        >
          送出
        </button>
        {!ready ? <span className="tr-hint">五題都選完才能送出</span> : null}
      </div>
    </Card>
  );
}
