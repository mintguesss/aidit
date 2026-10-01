"use client";

import { useEffect, useState } from "react";
import type { CoursePreferences } from "@/lib/types";
import { exportJson, loadStored, PREF_TTL_MONTHS, type StoredPreferences } from "@/lib/ui/prefs";
import { erase, fetchPreferences } from "@/lib/ui/sync";

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

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <h2>系統存了什麼</h2>
          <span className="hint">
            {source === "server"
              ? "存在伺服器（以不可逆的雜湊值為鍵，不含學號），本機另有一份離線備援"
              : "目前連不上伺服器，顯示的是本機備援的值"}
          </span>
        </div>

        <div className="pv-sec">
          <div className="pv-hd">
            <b>必填</b>
            <span>規劃所需。少一項，課表就排不出來或排錯</span>
          </div>
          <dl className="pv-list">
            <Row k="修課目標" v={{ asap: "最快畢業", balanced: "正常進度", light: "輕量修課" }[r.goal]} />
            <Row k="不排早八" v={r.avoidEarly ? "是" : "否"} />
            <Row
              k="完全空出的星期"
              v={r.avoidDays.length > 0 ? r.avoidDays.map((d) => `星期${"一二三四五六日"[d - 1]}`).join("、") : "（未設定）"}
            />
            <Row k="期望堂數" v={r.targetCourseCount !== undefined ? `${r.targetCourseCount} 堂` : "（未設定）"} />
            <Row k="學期學分上限" v={r.maxCredits !== undefined ? `${r.maxCredits} 學分` : "（依學則）"} />
            <Row k="課程盡量集中" v={r.preferCompactDays ? "是" : "否"} />
            <Row k="備註" v={r.note || "（未填）"} />
            <Row
              k="額外修業目標"
              v={
                r.extraGoals.length > 0
                  ? r.extraGoals.map((g) => `${LABEL[g.kind]}（${g.target}）`).join("、")
                  : "（未設定）"
              }
            />
          </dl>
        </div>

        <div className="pv-sec">
          <div className="pv-hd">
            <b>選填</b>
            <span>僅影響課程排序，不影響任何判定</span>
          </div>
          <dl className="pv-list">
            <Row k="職涯方向" v={o.careerDirection || "（未填）"} />
            <Row k="興趣領域" v={o.interestAreas.length > 0 ? o.interestAreas.join("、") : "（未填）"} />
            <Row
              k="想避開的課程類型"
              v={o.avoidCourseTypes.length > 0 ? o.avoidCourseTypes.join("、") : "（未填）"}
            />
          </dl>
        </div>

        <div className="pv-sec">
          <div className="pv-hd">
            <b>畢業條件自行勾選</b>
            <span>存在伺服器，刪除偏好時一併刪除</span>
          </div>
          <dl className="pv-list">
            <Row k="已勾選" v={declared.length > 0 ? declared.join("、") : "（沒有）"} />
          </dl>
        </div>

        <div className="pv-sec">
          <div className="pv-hd">
            <b>其他</b>
          </div>
          <dl className="pv-list">
            <Row k="最後使用" v={new Date(stored.lastUsedAt).toLocaleString("zh-TW")} />
            <Row k="自動刪除" v={`最後使用日起 ${PREF_TTL_MONTHS} 個月未使用即刪除`} />
            <Row
              k="學籍狀態"
              v={
                studentStatus === "graduated"
                  ? "已畢業 —— 下次開啟時會自動刪除全部偏好"
                  : studentStatus === "leave"
                    ? "離校中 —— 下次開啟時會自動刪除全部偏好"
                    : "在學"
              }
            />
            <Row k="偏好存在哪" v="伺服器端，以 studentHash（HMAC，不可逆）為鍵；本機另存一份供離線使用" />
            <Row k="執行紀錄" v="去識別後保留 90 天，逾期自動刪除" />
            <Row
              k="送進語言模型的"
              v="只有你打的那句話（以及情境試算時的學期代號與未修課程名稱）。偏好與學號從未進入任何 prompt"
            />
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2>你可以做的</h2>
          <span className="hint">刪除立即生效，不需二次確認</span>
        </div>
        <div className="panel-bd">
          <div className="pv-actions">
            <button className="btn" onClick={download} disabled={busy}>
              匯出 JSON
            </button>
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
              onClick={() => run("preferences", "已刪除全部偏好（伺服器與本機）。下次排課會回到本案例的預設值。")}
            >
              刪除全部偏好
            </button>
          </div>
          {msg ? <div className="note inset">{msg}</div> : null}

          <div className="pv-danger">
            <b>連同執行紀錄一起刪除</b>
            <p>
              執行紀錄是系統對自己判定的稽核證據（已去識別，學號以雜湊值取代）。
              刪掉之後，「系統當初告訴你什麼、依據哪一條」就再也查不到 ——
              包括你自己想回頭確認的時候。它本來就會在 90 天後自動刪除。
            </p>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                run("all", "已刪除全部偏好與執行紀錄。", (n) => `已刪除全部偏好，以及 ${n} 筆執行紀錄。`)
              }
            >
              刪除偏好與執行紀錄
            </button>
          </div>
        </div>
      </section>
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
    <div className="pv-row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
