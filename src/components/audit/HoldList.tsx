"use client";

import { useState } from "react";
import type { HoldItem } from "@/lib/types";
import { contactOf } from "@/lib/rules/contacts";

/**
 * 待確認事項。
 *
 * 每一則都必須說明「已檢索過哪些來源」，否則看起來像偷懶。
 * 這些項目未計入學分判定，文案上必須講清楚，不能讓人誤以為已經算進去了。
 *
 * 版面：一則一個區塊，標題 → 說明 → 四個欄位 → 兩個動作，由上而下讀。
 * 先前把依據／影響／洽詢窗口塞進自動分欄的 grid，欄數會隨寬度跳動，
 * 讀起來像一堆碎片；現在固定成「標籤在左、內容在右」的逐列結構。
 */
export function HoldList({ holds, contactSubject }: { holds: HoldItem[]; contactSubject: string }) {
  if (holds.length === 0) {
    return (
      <div className="empty">
        <b>本次審查未產生待確認事項。</b>
        <br />
        所有結論皆有可回查之依據，且沒有任何修課命中規則包所記載的規則缺口。
      </div>
    );
  }
  return (
    <div className="holds">
      {holds.map((h, i) => (
        <Hold key={h.id} h={h} n={i + 1} subject={contactSubject} />
      ))}
    </div>
  );
}

function Hold({ h, n, subject }: { h: HoldItem; n: number; subject: string }) {
  const [copied, setCopied] = useState<"idle" | "body" | "letter">("idle");
  const c = contactOf(h.contact);

  const letter = [
    `主旨：${h.title}`,
    "",
    `本人為${subject}學生，就下列事項請求協助確認：`,
    "",
    h.body,
    "",
    `影響：${h.impact}`,
    h.citations.length > 0
      ? `依據：${h.citations.map((c) => `${c.docTitle} ${c.locator}`).join("；")}`
      : "",
    "",
    "（本說明由修業規劃輔助系統產生，僅供洽詢之用，非畢業資格證明。）",
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async (text: string, which: "body" | "letter") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("idle");
    }
  };

  return (
    <div className="holditem">
      <div className="holditem-hd">
        <span className="holditem-n">{n}</span>
        <h3>{h.title}</h3>
      </div>

      <p className="holditem-body">{h.body}</p>

      <dl className="holditem-facts">
        {h.citations.length > 0 ? (
          <Fact k="依據">{h.citations.map((c) => `${c.docTitle} ${c.locator}`).join("；")}</Fact>
        ) : null}
        {h.conflictOf ? (
          <Fact k="依據衝突">
            {h.conflictOf[0].docTitle} {h.conflictOf[0].locator}
            　對　
            {h.conflictOf[1].docTitle} {h.conflictOf[1].locator}
          </Fact>
        ) : null}
        <Fact k="影響">{h.impact}</Fact>
        <Fact k="建議洽詢">
          {c ? (
            <>
              {c.unit}
              <span className="fact-sub">
                <a href={`mailto:${c.email}`}>{c.email}</a>
                {c.phone ? `　${c.phone}` : ""}
                {c.hours ? `　${c.hours}` : ""}
              </span>
            </>
          ) : (
            <>
              {h.contact}
              <span className="fact-sub">通訊錄查無此窗口的信箱，請以系上公告為準。</span>
            </>
          )}
        </Fact>
      </dl>

      <div className="holditem-act">
        {c ? (
          <a className="btn btn-primary" href={mailto(c.email, h.title, letter)}>
            寄出詢問信
          </a>
        ) : null}
        <button className="btn" onClick={() => copy(`${h.title}\n\n${h.body}\n\n影響：${h.impact}`, "body")}>
          {copied === "body" ? "已複製" : "複製說明"}
        </button>
      </div>
    </div>
  );
}

/** 信件內容一併帶上，使用者按下去就是一封寫好的信 */
function mailto(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
