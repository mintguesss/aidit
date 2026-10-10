"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/shell/Spinner";

type Issue = { level: "error" | "warn"; message: string };
type Summary = {
  id: string;
  version: string;
  admissionYear: number;
  dept: string;
  minCredits: number;
  categories: { id: string; label: string; credits: number }[];
  documents: { id: string; title: string; hasCorpus: boolean }[];
  ambiguities: number;
  provenance: string;
  contentHash: string;
};
type Result =
  | { kind: "json"; ok: boolean; issues: Issue[]; summary?: Summary }
  | { kind: "pdf"; ok: true; receipt: string; filename: string; bytes: number; steps: string[] }
  | { error: string };

/**
 * 上傳自己的課程規劃表。
 *
 * 上傳完**不會**直接生效 —— 規則包要經人工校對才鎖版。
 * 這一點在畫面上要講在最前面，否則使用者會以為上傳完判定就換了版本。
 */
export function RulePackUpload() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [over, setOver] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const send = async (file: File) => {
    setBusy(true);
    setRes(null);
    setName(file.name);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/rulepack", { method: "POST", body: fd });
      setRes((await r.json()) as Result);
    } catch (e) {
      setRes({ error: `上傳失敗：${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 拖進來或點一下都可以；整塊都是按鈕 */}
      <div
        className={`drop${over ? " over" : ""}${busy ? " busy" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="選擇或拖曳規劃表檔案"
        onClick={() => !busy && ref.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            ref.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void send(f);
        }}
      >
        <input
          ref={ref}
          type="file"
          accept=".pdf,.json,application/pdf,application/json"
          disabled={busy}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void send(f);
          }}
        />
        <span className="drop-ic" aria-hidden />
        {busy ? (
          <Spinner label={`檢查 ${name ?? ""} 中…`} />
        ) : (
          <>
            <b>{over ? "放開就上傳" : "把規劃表拖到這裡，或點一下選檔案"}</b>
            <span className="drop-hint">.pdf 原始規劃表　或　.json 規則包・上限 8 MB</span>
          </>
        )}
      </div>

      {res ? <ResultView r={res} /> : null}
    </>
  );
}

function ResultView({ r }: { r: Result }) {
  if ("error" in r) return <div className="note warn">{r.error}</div>;

  if (r.kind === "pdf") {
    return (
      <div className="uresult">
        <h3>已收件　<code>{r.receipt}</code></h3>
        <p>
          {r.filename}（{Math.round(r.bytes / 1024)} KB）已存入伺服器暫存區。
          <b>這份規劃表還不會生效</b> —— 抽取需要語言模型，而抽取出來的每一個欄位都必須
          帶原文 quote 並通過逐條回查，最後還要人工校對才鎖版。接下來會跑：
        </p>
        <ol className="usteps">
          {r.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    );
  }

  const errors = r.issues.filter((i) => i.level === "error");
  const warns = r.issues.filter((i) => i.level === "warn");

  return (
    <div className="uresult">
      <h3 className={r.ok ? "ok" : "bad"}>
        {r.ok ? "結構檢查通過，可送人工校對" : `結構檢查未通過（${errors.length} 項錯誤）`}
      </h3>

      {errors.length > 0 ? (
        <ul className="uissues">
          {errors.map((i, k) => (
            <li key={k} className="bad">
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {warns.length > 0 ? (
        <ul className="uissues">
          {warns.map((i, k) => (
            <li key={k} className="warn">
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      {r.summary ? (
        <>
          <div className="fieldgrid">
            <F k="規則包" v={`${r.summary.id} rev.${r.summary.version}`} mono />
            <F k="適用" v={`${r.summary.admissionYear} 學年度　${r.summary.dept}`} />
            <F k="畢業最低學分" v={String(r.summary.minCredits)} />
            <F k="類別數" v={`${r.summary.categories.length} 類`} />
            <F k="記載的規則缺口" v={`${r.summary.ambiguities} 項`} />
            <F k="內容指紋" v={r.summary.contentHash} mono />
          </div>
          <p className="panel-foot">
            結構沒問題不等於可以拿來判定。<b>未校對的規則包一律不參與學分判定</b> ——
            要生效必須補上語料檔、通過逐條引用回查，並由承辦人在校對頁鎖版。
          </p>
        </>
      ) : null}
    </div>
  );
}

function F({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="field">
      <div className="field-k">{k}</div>
      <div className={`field-v${mono ? " mono" : ""}`}>{v}</div>
    </div>
  );
}
