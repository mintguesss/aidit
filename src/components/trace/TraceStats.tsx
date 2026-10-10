import { CountUp } from "./CountUp";

type Kind = "ok" | "unmet" | "hold" | "plain";

/**
 * 執行紀錄最上面的統計。
 *
 * 不做四格一樣大的數字卡：每個數字配一個圖示，再配一個「看得到內容」的小圖 ——
 *   總耗時   大格，下方一條依步驟切段的時間條（段寬＝耗時比例，顏色＝結果）
 *   工具調用 寬格，一次調用一個小方塊，失敗的是紅色
 *   重試、LLM 小格，一句話說明狀態
 */
export function TraceStats({
  totalMs,
  steps,
  calls,
  retries,
  llmCalls,
  llmCost,
}: {
  totalMs: number;
  steps: { idx: number; label: string; ms: number; kind: Kind }[];
  calls: { name: string; status: string }[];
  retries: number;
  llmCalls: number;
  llmCost: number;
}) {
  const fails = calls.filter((c) => c.status === "failed").length;
  const sum = Math.max(1, steps.reduce((a, s) => a + s.ms, 0));
  const slowest = steps.reduce((a, s) => (s.ms > a.ms ? s : a), steps[0] ?? { idx: 0, label: "", ms: 0, kind: "ok" as Kind });

  return (
    <div className="bento">
      <div className="bt bt-time">
        <div className="bt-hd">
          <span className="bt-ic blue">
            <IconClock />
          </span>
          <span className="bt-k">總耗時</span>
        </div>
        <div className="bt-n big">
          <CountUp to={totalMs / 1000} decimals={1} />
          <em>秒</em>
        </div>
        <div className="bt-flow" aria-label="各步驟耗時比例">
          {steps.map((s, i) => (
            <i
              key={s.idx}
              className={s.kind}
              title={`${s.idx}. ${s.label}　${s.ms} ms`}
              style={{ flexGrow: Math.max(s.ms / sum, 0.02), animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>
        <div className="bt-sub">
          {steps.length} 個步驟・最久的是「{slowest.label}」
        </div>
      </div>

      <div className="bt bt-tools">
        <div className="bt-hd">
          <span className="bt-ic teal">
            <IconWrench />
          </span>
          <span className="bt-k">工具調用</span>
          <span className={`bt-flag ${fails > 0 ? "bad" : "good"}`}>{fails > 0 ? `失敗 ${fails} 次` : "全部成功"}</span>
        </div>
        <div className="bt-row">
          <div className="bt-n">
            <CountUp to={calls.length} />
            <em>次</em>
          </div>
          <div className="bt-dots" aria-hidden>
            {calls.map((c, i) => (
              <i key={i} className={c.status} title={c.name} style={{ animationDelay: `${300 + i * 45}ms` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="bt bt-retry">
        <div className="bt-hd">
          <span className="bt-ic amber">
            <IconRetry />
          </span>
          <span className="bt-k">重試</span>
        </div>
        <div className="bt-n">
          <CountUp to={retries} />
          <em>次</em>
        </div>
        <div className="bt-sub">{retries === 0 ? "每一步都一次就成功" : "失敗後自動重試"}</div>
      </div>

      <div className="bt bt-llm">
        <div className="bt-hd">
          <span className="bt-ic violet">
            <IconChip />
          </span>
          <span className="bt-k">LLM 呼叫</span>
        </div>
        <div className="bt-n">
          <CountUp to={llmCalls} />
          <em>次</em>
        </div>
        <div className="bt-sub">{llmCalls > 0 ? `成本 US$${llmCost.toFixed(5)}` : "未設定金鑰，用離線替身判定"}</div>
      </div>
    </div>
  );
}

/* 圖示：線條風格，跟著文字顏色 */
const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function IconClock() {
  return (
    <svg {...svg} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconWrench() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
    </svg>
  );
}
function IconRetry() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3v5h5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 21v-5h-5" />
    </svg>
  );
}
function IconChip() {
  return (
    <svg {...svg} aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M10 10h4v4h-4zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  );
}
