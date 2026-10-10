"use client";

import { useEffect, useState } from "react";
import type { HoldItem } from "@/lib/types";
import { contactOf } from "@/lib/rules/contacts";
import { Modal } from "../shell/Modal";

/**
 * 待確認事項。
 *
 * 一則一張卡，收起時只看得到三件事：**什麼事、影響多少、找誰**。
 * 為什麼判定不了、涉及哪些科目、查過哪些來源（每一則都必須交代，否則看起來像偷懶）
 * 點開卡片才展開。詢問信在彈出視窗裡預先寫好，可以改了再寄。
 *
 * 「我的進度」只是學生自己的備忘（存在這台裝置），不會改變判定 ——
 * 判定只有承辦單位回覆、規則包更新之後才會變。
 */

type Step = "todo" | "asked" | "replied";
const STEPS: { id: Step; label: string }[] = [
  { id: "todo", label: "還沒問" },
  { id: "asked", label: "已寄信" },
  { id: "replied", label: "已回覆" },
];

const storeKey = (scope: string, id: string) => `aidit:hold:${scope}:${id}`;

export function HoldList({
  holds,
  contactSubject,
  scope = "",
}: {
  holds: HoldItem[];
  contactSubject: string;
  /** 進度存放的區隔（案例代號），不同案例的同一則不會互相覆蓋 */
  scope?: string;
}) {
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [letterOf, setLetterOf] = useState<HoldItem | null>(null);

  // 掛載後才讀本機紀錄，伺服器渲染一律從「還沒問」開始，避免畫面對不上
  useEffect(() => {
    const next: Record<string, Step> = {};
    for (const h of holds) {
      try {
        const v = localStorage.getItem(storeKey(scope, h.id));
        if (v === "asked" || v === "replied") next[h.id] = v;
      } catch {
        /* 私密視窗等情況讀不到，當作還沒問 */
      }
    }
    setSteps(next);
  }, [holds, scope]);

  const setStep = (id: string, s: Step) => {
    setSteps((prev) => ({ ...prev, [id]: s }));
    try {
      if (s === "todo") localStorage.removeItem(storeKey(scope, id));
      else localStorage.setItem(storeKey(scope, id), s);
    } catch {
      /* 存不下就只在這次畫面有效 */
    }
  };

  if (holds.length === 0) {
    return (
      <div className="holds-empty">
        <b>本次審查未產生待確認事項。</b>
        <br />
        所有結論皆有可回查之依據，且沒有任何修課命中規則包所記載的規則缺口。
      </div>
    );
  }

  const done = holds.filter((h) => steps[h.id] === "replied").length;
  const asked = holds.filter((h) => steps[h.id] === "asked").length;

  return (
    <>
      {/* 處理進度：一則一格，跟著每張卡的狀態變色 */}
      <div className="hq">
        <div className="hq-track" aria-hidden>
          {holds.map((h) => (
            <span key={h.id} className={`hq-cell ${steps[h.id] ?? "todo"}`} />
          ))}
        </div>
        <div className="hq-txt">
          <b>{done}</b>/{holds.length} 已回覆
          {asked > 0 ? <span className="hq-asked">・{asked} 封等回覆</span> : null}
          <span className="hq-note" title="只記在這台裝置，不會改變判定">我的進度</span>
        </div>
      </div>

      <div className="hcards">
        {holds.map((h, i) => (
          <HoldCard
            key={h.id}
            h={h}
            n={i + 1}
            step={steps[h.id] ?? "todo"}
            open={open === h.id}
            onToggle={() => setOpen((o) => (o === h.id ? null : h.id))}
            onStep={(s) => setStep(h.id, s)}
            onLetter={() => setLetterOf(h)}
          />
        ))}
      </div>

      <LetterModal
        h={letterOf}
        subject={contactSubject}
        onClose={() => setLetterOf(null)}
        onSent={() => {
          if (letterOf && (steps[letterOf.id] ?? "todo") === "todo") setStep(letterOf.id, "asked");
        }}
      />
    </>
  );
}

function HoldCard({
  h,
  n,
  step,
  open,
  onToggle,
  onStep,
  onLetter,
}: {
  h: HoldItem;
  n: number;
  step: Step;
  open: boolean;
  onToggle: () => void;
  onStep: (s: Step) => void;
  onLetter: () => void;
}) {
  const c = contactOf(h.contact);
  const bodyId = `hold-bd-${h.id}`;

  return (
    <article className={`hcard st-${step}${open ? " open" : ""}`} style={{ animationDelay: `${(n - 1) * 60}ms` }}>
      <button type="button" className="hcard-hd" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="hcard-n">{step === "replied" ? "✓" : n}</span>
        <span className="hcard-main">
          <span className="hcard-title">{h.title}</span>
          <span className="hcard-impact">{h.impact}</span>
        </span>
        <span className="hcard-chev" aria-hidden />
      </button>

      {/* 展開：高度用 grid 0fr→1fr 動畫，內容不必量高度 */}
      <div className="hcard-bd" id={bodyId}>
        <div className="hcard-bd-in">
          <div className="hcard-sec">
            <p className="hcard-why">{h.reason ?? h.body}</p>
            {h.courses && h.courses.length > 0 ? (
              <div className="hcard-chips">
                {h.courses.map((x) => (
                  <span className="hchip course" key={x.code}>
                    <code>{x.code}</code>
                    {x.name}
                    <em>{x.credits} 學分</em>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {h.searched && h.searched.length > 0 ? (
            <div className="hcard-sec">
              <div className="hcard-lb">已查過，都沒有答案</div>
              <div className="hcard-chips">
                {h.searched.map((s, i) => (
                  <span className="hchip searched" key={s} style={{ animationDelay: `${i * 70}ms` }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="hcard-sec">
            <div className="hcard-lb">依據</div>
            <div className="hcard-src">
              {h.citations.map((x) => `${x.docTitle} ${x.locator}`).join("；")}
              {h.conflictOf ? (
                <span className="hcard-conflict">
                  依據衝突：{h.conflictOf[0].docTitle} {h.conflictOf[0].locator} 對 {h.conflictOf[1].docTitle}{" "}
                  {h.conflictOf[1].locator}
                </span>
              ) : null}
            </div>
          </div>

          {c ? (
            <div className="hcard-sec hcard-contact">
              <a href={`mailto:${c.email}`}>{c.email}</a>
              {c.phone ? <span>{c.phone}</span> : null}
              {c.hours ? <span>{c.hours}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="hcard-foot">
        <span className="hcard-who">
          <span className="hcard-lb">找</span>
          {c ? c.unit : h.contact}
        </span>
        <button type="button" className="btn btn-primary hcard-mail" onClick={onLetter}>
          寫詢問信
        </button>
        <div className="hstep" role="radiogroup" aria-label="我的進度">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={step === s.id}
              className={step === s.id ? "on" : undefined}
              onClick={() => onStep(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

/** 詢問信：預先寫好，可以改了再寄；按寄出會順手把進度標成「已寄信」 */
function LetterModal({
  h,
  subject,
  onClose,
  onSent,
}: {
  h: HoldItem | null;
  subject: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const c = h ? contactOf(h.contact) : null;

  useEffect(() => {
    if (!h) return;
    setCopied(false);
    setText(
      [
        `本人為${subject}學生，就下列事項請求協助確認：`,
        "",
        h.body,
        "",
        `影響：${h.impact}`,
        h.citations.length > 0 ? `依據：${h.citations.map((x) => `${x.docTitle} ${x.locator}`).join("；")}` : "",
        "",
        "（本說明由修業規劃輔助系統產生，僅供洽詢之用，非畢業資格證明。）",
      ]
        .filter((l, i, a) => l !== "" || a[i - 1] !== "")
        .join("\n"),
    );
  }, [h, subject]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`主旨：${h?.title}\n\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal size="narrow" open={h !== null} onClose={onClose} title="詢問信" sub={c ? `寄給 ${c.unit}` : h?.contact}>
      {h ? (
        <div className="letter">
          <div className="letter-row">
            <span className="letter-k">收件</span>
            <span>{c ? c.email : "通訊錄查無此窗口的信箱，請以系上公告為準"}</span>
          </div>
          <div className="letter-row">
            <span className="letter-k">主旨</span>
            <span>{h.title}</span>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} aria-label="信件內容" />
          <div className="letter-act">
            <button type="button" className="btn" onClick={copy}>
              {copied ? "已複製" : "複製全文"}
            </button>
            {c ? (
              <a
                className="btn btn-primary"
                href={`mailto:${c.email}?subject=${encodeURIComponent(h.title)}&body=${encodeURIComponent(text)}`}
                onClick={() => {
                  onSent();
                  onClose();
                }}
              >
                用郵件寄出
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
