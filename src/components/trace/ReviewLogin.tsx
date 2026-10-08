"use client";

import { useState } from "react";
import { Spinner } from "@/components/shell/Spinner";

/** 校對登入表單：姓名＋校對密碼。姓名會記在每一筆校對紀錄上 */
export function ReviewLogin({ next }: { next: string }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/review/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `登入失敗（${res.status}）。`);
        return;
      }
      window.location.href = next;
    } catch {
      setError("連不上伺服器，請檢查網路後再試。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <div className="panel-hd">
        <h2>規則校對登入</h2>
      </div>
      <div className="panel-bd rv-login">
        <label>
          姓名或代號
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required maxLength={40} />
        </label>
        <label>
          校對密碼
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error ? (
          <p className="rv-err" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? <Spinner label="登入中…" /> : "登入"}
        </button>
        <p className="rv-hint">校對是內部作業：只有拿到校對密碼的人能校對、鎖版。登入 12 小時有效。</p>
      </div>
    </form>
  );
}
