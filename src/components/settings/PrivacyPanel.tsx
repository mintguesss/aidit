"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CoursePreferences } from "@/lib/types";
import { exportJson, loadStored, PREF_TTL_MONTHS, type StoredPreferences } from "@/lib/ui/prefs";
import { erase, fetchPreferences } from "@/lib/ui/sync";
import { Spinner } from "@/components/shell/Spinner";
import { Modal } from "@/components/shell/Modal";

/**
 * 資料與隱私。
 *
 * 三件事要讓使用者自己做得到，而不是寫在說明裡請他相信：
 *   看得到系統存了什麼、只刪選填、全部刪掉。
 *
 * 偏好存在伺服器端（以不可逆的 studentHash 為鍵），所以這裡的「刪除」是真的刪到
 * 伺服器上的那一份 —— 純本地儲存的話，使用者本來就能從瀏覽器設定清掉，
 * 這個按鈕只是比較好按而已，不是一項權利。
 *
 * 偏好的刪除立即生效、不做二次確認：誤刪的代價只是重填一次。
 * **執行紀錄的刪除是分開的一個動作**，因為它的代價完全不同 ——
 * 那是系統對自己判定的稽核證據，刪掉之後「當初告訴我什麼、依據是什麼」就查不到了。
 */
export function PrivacyPanel({
  defaults,
  studentStatus,
  declared = [],
  fixture,
  term,
}: {
  defaults: CoursePreferences;
  studentStatus?: string;
  /** 自行勾選已通過的畢業條件（存在伺服器，跟偏好一起刪） */
  declared?: string[];
  fixture: string;
  term: string;
}) {
  const [stored, setStored] = useState<StoredPreferences | null>(null);
  const [source, setSource] = useState<"server" | "local">("local");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // hooks 一定要在下面的 early return 之前：放在後面的話，資料載入前後呼叫的 hook 數量不同，React 會直接崩潰
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // 「刪除偏好與執行紀錄」要在彈出視窗裡打字確認：執行紀錄刪了就查不回來，一個按鈕太容易誤按
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const reload = () => {
    void fetchPreferences(fixture, term, defaults).then((s) => {
      setSource(s.source);
      setStored(loadStored(defaults));
    });
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!stored) return null;

  const r = stored.required;
  const o = stored.optional;
  const hasOptional =
    Boolean(o.careerDirection) || o.interestAreas.length > 0 || o.avoidCourseTypes.length > 0;

  const run = (
    scope: "optional" | "preferences" | "all",
    ok: string,
    withTraces?: (n: number) => string,
  ) => {
    setBusy(true);
    setMsg(null);
    void erase(fixture, term, scope)
      .then((r) => {
        setMsg(withTraces ? withTraces(r.traces) : ok);
        reload();
        // 畢業條件的自行勾選由伺服器端頁面帶進來，刪掉之後要重新整理才會從畫面上消失
        startRefresh(() => router.refresh());
      })
      .finally(() => setBusy(false));
  };

  const download = () => {
    const blob = new Blob([exportJson(defaults)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aidit-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const day = (d: number) => `星期${"一二三四五六日"[d - 1]}`;
  const CONFIRM = "確認刪除";

  return (
    <>
      {/* 最重要的一句單獨成塊 */}
      <div className="decl pv-decl">
        <span className="decl-ic" aria-hidden>
          i
        </span>
        <div>
          <p className="decl-h">系統只存你填的偏好，不存學號、帳號密碼或修課紀錄。</p>
          <p className="decl-p">
            {source === "server"
              ? "偏好存在伺服器，以不可逆的雜湊值為鍵；本機另有一份離線備援。下面每一項都可以自己刪。"
              : "目前連不上伺服器，下面顯示的是本機備援的值。"}
          </p>
        </div>
      </div>

      {/* 只有五段，不需要左側索引；內容置中 */}
      <div className="legal pv-legal">

        <div className="legal-body">
          <article className="art" id="pv-1">
            <h2><span className="art-no">第一項</span>必填偏好</h2>
            <p className="art-key">排課所需。少一項，課表就排不出來或排錯。</p>
            <dl className="art-dl">
              <Row k="修課目標" v={{ asap: "最快畢業", balanced: "正常進度", light: "輕量修課" }[r.goal]} />
              <Row k="不排早八" v={r.avoidEarly ? "是" : "否"} />
              <Row k="完全空出" v={r.avoidDays.length > 0 ? r.avoidDays.map(day).join("、") : "（未設定）"} />
              <Row k="期望堂數" v={r.targetCourseCount !== undefined ? `${r.targetCourseCount} 堂` : "（未設定）"} />
              <Row k="學分上限" v={r.maxCredits !== undefined ? `${r.maxCredits} 學分` : "（依學則）"} />
              <Row k="課程集中" v={r.preferCompactDays ? "是" : "否"} />
              <Row k="額外目標" v={r.extraGoals.length > 0 ? r.extraGoals.map((g) => `${LABEL[g.kind]}（${g.target}）`).join("、") : "（未設定）"} />
              <Row k="備註" v={r.note || "（未填）"} />
            </dl>
          </article>

          <article className="art" id="pv-2">
            <h2><span className="art-no">第二項</span>選填偏好</h2>
            <p className="art-key">只影響課程排序，不影響任何判定。</p>
            <dl className="art-dl">
              <Row k="職涯方向" v={o.careerDirection || "（未填）"} />
              <Row k="興趣領域" v={o.interestAreas.length > 0 ? o.interestAreas.join("、") : "（未填）"} />
              <Row k="想避開的" v={o.avoidCourseTypes.length > 0 ? o.avoidCourseTypes.join("、") : "（未填）"} />
            </dl>
          </article>

          <article className="art" id="pv-3">
            <h2><span className="art-no">第三項</span>畢業條件自行勾選</h2>
            <p className="art-key">存在伺服器，刪除偏好時一併刪除。</p>
            <dl className="art-dl">
              <Row k="已勾選" v={declared.length > 0 ? declared.join("、") : "（沒有）"} />
            </dl>
          </article>

          <article className="art" id="pv-4">
            <h2><span className="art-no">第四項</span>保存與刪除期限</h2>
            <p className="art-key">不用的資料會自己消失，不需要你記得回來刪。</p>
            <table className="art-table">
              <tbody>
                <tr><th>偏好</th><td>最後使用日起 {PREF_TTL_MONTHS} 個月未使用即刪除</td><td className="mono">最後使用 {new Date(stored.lastUsedAt).toLocaleString("zh-TW")}</td></tr>
                <tr>
                  <th>學籍狀態</th>
                  <td colSpan={2}>
                    {studentStatus === "graduated"
                      ? "已畢業 —— 下次開啟時會自動刪除全部偏好"
                      : studentStatus === "leave"
                        ? "離校中 —— 下次開啟時會自動刪除全部偏好"
                        : "在學"}
                  </td>
                </tr>
                <tr><th>執行紀錄</th><td colSpan={2}>去識別後保留 90 天，逾期自動刪除</td></tr>
                <tr><th>送進語言模型的</th><td colSpan={2}>只有你打的那句話（以及情境試算時的學期代號與未修課程名稱）。偏好與學號從未進入任何 prompt</td></tr>
              </tbody>
            </table>
          </article>

          <article className="art" id="pv-5">
            <h2><span className="art-no">第五項</span>你可以做的</h2>
            <p className="art-key">匯出與刪除都由你自己操作，偏好的刪除立即生效。</p>
            <div className="pv-actions">
              <button className="btn" onClick={download} disabled={busy}>匯出 JSON</button>
              <button
                className="btn"
                disabled={!hasOptional || busy}
                onClick={() => run("optional", "已刪除選填欄位。必填保留，系統仍可正常使用。")}
              >
                只刪選填
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => run("preferences", "已刪除全部偏好（伺服器與本機），畢業條件的自行勾選也一併刪除。下次排課會回到本案例的預設值。")}
              >
                刪除全部偏好
              </button>
            </div>
            {busy || refreshing ? (
              <div className="note inset"><Spinner label="處理中…" /></div>
            ) : msg ? (
              <div className="note inset">{msg}</div>
            ) : null}

            <div className="pv-danger">
              <b>連同執行紀錄一起刪除</b>
              <p>
                執行紀錄是系統對自己判定的稽核證據（已去識別，學號以雜湊值取代）。刪掉之後，「系統當初告訴你什麼、依據哪一條」就再也查不到
                —— 包括你自己想回頭確認的時候。它本來就會在 90 天後自動刪除。
              </p>
              <button className="btn btn-danger" disabled={busy} onClick={() => { setTyped(""); setConfirmOpen(true); }}>
                刪除偏好與執行紀錄…
              </button>
            </div>
          </article>
        </div>
      </div>

      <Modal size="narrow" open={confirmOpen} onClose={() => setConfirmOpen(false)} title="刪除偏好與執行紀錄">
        <div className="pv-confirm">
          <p>這會刪除全部偏好、畢業條件的自行勾選，以及這位學生的所有執行紀錄。<b>執行紀錄刪除後無法復原。</b></p>
          <label>
            請輸入「{CONFIRM}」以繼續
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={CONFIRM} autoFocus />
          </label>
          <div className="pv-actions">
            <button className="btn" onClick={() => setConfirmOpen(false)}>取消</button>
            <button
              className="btn btn-danger"
              disabled={typed.trim() !== CONFIRM || busy}
              onClick={() => {
                setConfirmOpen(false);
                run("all", "已刪除全部偏好與執行紀錄。", (n) => `已刪除全部偏好，以及 ${n} 筆執行紀錄。`);
              }}
            >
              刪除
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

const LABEL: Record<string, string> = {
  minor: "輔系",
  "double-major": "雙主修",
  "cert-program": "學分學程",
  transfer: "轉系",
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
