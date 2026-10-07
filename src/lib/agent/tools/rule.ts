import { z } from "zod/v4";
import type { Citation, Student, TransferApproval } from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import { resolveRulePack, loadCorpus, type ResolveOutcome } from "@/lib/rules/loader";
import { announcementsFor, citationOf, type Announcement } from "@/lib/rules/announcements";
import { structured, type LlmBudget } from "@/lib/llm/client";
import type { ConflictNote, DeptDefinedResolution } from "@/lib/audit/engine";

/** rule.resolve —— 純查表，不經 LLM */
export function ruleResolve(student: Student, transfer?: TransferApproval): ResolveOutcome {
  return resolveRulePack(student, transfer);
}

// ------------------------------------------------------------ rule.conflict

export type Conflict = {
  id: string;
  /** 規則包中的類別 id 或畢業條件 id */
  target: string;
  targetName: string;
  kind: "version-superseded" | "applicability-unknown";
  detail: string;
  packCitation: Citation;
  announcement: Announcement;
};

/**
 * rule.conflict —— 比對規則包與公告庫，找出版本／適用對象衝突。
 *
 * applies_to_years IS NULL 就是衝突訊號：公告沒說適用哪幾屆，
 * 而畢業審查不能在「不知道適不適用」的狀態下作成判定。
 */
export function ruleConflict(pack: RulePack): Conflict[] {
  const out: Conflict[] = [];
  for (const ann of announcementsFor(pack.school)) {
    if (ann.dept && ann.dept !== pack.dept) continue;
    if (ann.group && ann.group !== pack.group) continue;
    for (const target of ann.targets) {
      const cat = pack.categories.find((c) => c.id === target);
      const chk = pack.graduationChecks.find((g) => g.id === target);
      if (!cat && !chk) continue;

      const targetName = cat?.name ?? chk!.name;
      const raw = cat?.citation ?? chk!.citation;
      const doc = pack.documents.find((d) => d.id === raw.docId);
      const packCitation: Citation = {
        docId: raw.docId,
        docTitle: doc?.title ?? raw.docId,
        locator: raw.locator,
        quote: raw.quote,
        publishedAt: doc?.publishedAt,
      };

      out.push({
        id: `conflict-${ann.id}-${target}`,
        target,
        targetName,
        kind: ann.appliesToYears === null ? "applicability-unknown" : "version-superseded",
        detail:
          ann.appliesToYears === null
            ? `公告「${ann.title}」就${targetName}另有規定，但全文未載明適用之入學學年。`
            : `公告「${ann.title}」就${targetName}另有規定，須判斷是否適用本學籍。`,
        packCitation,
        announcement: ann,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------- rule.reconcile

const zReconcile = z.object({
  /** 是否能作成明確判定 */
  resolved: z.boolean(),
  /** 本公告是否適用於該生；resolved 為 false 時應為 null */
  appliesToStudent: z.boolean().nullable(),
  /** 判斷理由，一句話 */
  reason: z.string().min(1).max(200),
  /** 支持上述判斷的公告原文片段；查無適用對象敘述時為空字串 */
  quote: z.string().max(300),
});

export type ReconcileOutcome = {
  conflict: Conflict;
  resolved: boolean;
  appliesToStudent: boolean | null;
  reason: string;
  citation: Citation | null;
  mode: "api" | "offline";
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

const SYSTEM = [
  "你是畢業審查系統的規則比對元件。",
  "任務：判斷一則校務公告是否適用於指定學籍的學生。",
  "規則：",
  "1. 只依據提供的公告原文判斷，不得引用原文以外的知識。",
  "2. 公告未明確載明適用之入學學年時，一律回傳 resolved=false，不得推測。",
  "3. quote 必須逐字取自公告原文，不得改寫；沒有可引用的句子就回傳空字串。",
  "4. 不得輸出任何學分數字或審查結論 —— 學分計算由確定性程式負責。",
].join("\n");

/**
 * rule.reconcile —— 唯一在執行期判斷「公告是否適用本學籍」的 LLM 呼叫。
 * 輸出必須附引用，且該引用會被 citation.verify 回查原文；對不上就降級為待確認。
 */
export async function ruleReconcile(
  conflict: Conflict,
  student: Student,
  budget: LlmBudget,
): Promise<ReconcileOutcome> {
  const corpus = loadCorpus();
  const text = corpus.get(conflict.announcement.contentDocId) ?? "";

  const res = await structured(
    {
      system: SYSTEM,
      user: [
        `學生學籍入學學年：${student.admissionYear}`,
        `系所：${student.dept}　學制：${student.program === "day" ? "日間部" : "進修部"}`,
        `待判斷之公告標題：${conflict.announcement.title}`,
        // 同一份公告對不同入學年度有不同規定時，只判斷這一則講的那部分
        ...(conflict.announcement.appliesToRaw ? [`本次只判斷這一段規定：${conflict.announcement.appliesToRaw}`] : []),
        `公告發布日期：${conflict.announcement.publishedAt}`,
        "公告全文：",
        text,
      ].join("\n"),
      schema: zReconcile,
      offline: () => offlineReconcile(conflict, student),
    },
    budget,
  );

  const d = res.data;
  const citation =
    d.quote.trim() === ""
      ? null
      : citationOf(conflict.announcement, locatorFor(conflict.announcement), d.quote);

  return {
    conflict,
    resolved: d.resolved,
    appliesToStudent: d.appliesToStudent,
    reason: d.reason,
    citation,
    mode: res.mode,
    costUsd: res.costUsd,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}

/**
 * 離線替身：以公告庫已解析之 applies_to_years 欄位作確定性判斷。
 * 與 LLM 走同一條輸出 schema 與同一套降級規則，trace 會標示 mode=offline。
 */
function offlineReconcile(conflict: Conflict, student: Student): z.infer<typeof zReconcile> {
  const ann = conflict.announcement;
  if (ann.appliesToYears === null || ann.appliesToRaw === null) {
    return {
      resolved: false,
      appliesToStudent: null,
      reason: "公告全文未載明適用之入學學年，無法確認是否適用本學籍。",
      quote: "",
    };
  }
  const applies = ann.appliesToYears.includes(student.admissionYear);
  return {
    resolved: true,
    appliesToStudent: applies,
    reason: applies
      ? `公告載明適用對象包含 ${student.admissionYear} 學年度入學之學生。`
      : `公告載明適用對象為 ${ann.appliesToYears[0]} 學年度起入學之學生，本學籍入學學年為 ${student.admissionYear}，不適用。`,
    quote: ann.appliesToRaw,
  };
}

function locatorFor(ann: Announcement): string {
  return ann.locator ?? (ann.appliesToRaw ? "第 1 點適用對象" : "全文");
}

// -------------------------------------------------- 解消結果 → 引擎輸入形狀

export function toConflictNotes(outcomes: ReconcileOutcome[]): ConflictNote[] {
  const notes: ConflictNote[] = [];
  for (const o of outcomes) {
    if (!o.resolved) continue;
    const cat = o.conflict.kind === "version-superseded";
    if (!cat) continue;
    notes.push({
      target: o.conflict.target,
      text: `已查核公告「${o.conflict.announcement.title}」：${o.reason}${
        !o.appliesToStudent
          ? "仍依本學籍適用之課程規劃表判定。"
          : o.conflict.announcement.effect
            ? `依此公告，${o.conflict.announcement.effect.ambiguity.description}這類課修了會列為待確認事項。`
            : ""
      }`,
      citations: o.citation ? [o.citation] : [],
    });
  }
  return notes;
}

/**
 * 判定適用本學籍的公告，把它對審查的影響加進這次審查用的規則包（不改動已鎖版的規則包本身）。
 * 影響是資料（公告庫的 effect），不是模型臨時決定的：模型只判斷「適不適用」。
 */
export function withAnnouncedEffects(pack: RulePack, outcomes: ReconcileOutcome[]): RulePack {
  const applied = outcomes.filter((o) => o.resolved && o.appliesToStudent === true && o.conflict.announcement.effect);
  if (applied.length === 0) return pack;
  const documents = [...pack.documents];
  const categories = pack.categories.map((cat) => {
    const extra = applied
      .map((o) => o.conflict.announcement)
      .filter((a) => a.effect!.category === cat.id && !cat.ambiguities.some((x) => x.id === a.effect!.ambiguity.id));
    return extra.length ? { ...cat, ambiguities: [...cat.ambiguities, ...extra.map((a) => a.effect!.ambiguity)] } : cat;
  });
  for (const o of applied) {
    const a = o.conflict.announcement;
    if (!documents.some((d) => d.id === a.contentDocId)) {
      documents.push({ id: a.contentDocId, title: a.title, url: a.url, publishedAt: a.publishedAt });
    }
  }
  return { ...pack, categories, documents };
}

export function toDeptDefinedResolutions(
  outcomes: ReconcileOutcome[],
): Record<string, DeptDefinedResolution> {
  const map: Record<string, DeptDefinedResolution> = {};
  for (const o of outcomes) {
    map[o.conflict.target] = {
      resolved: o.resolved && o.appliesToStudent === true,
      detail: o.reason,
      citations: o.citation ? [o.citation] : [],
    };
  }
  return map;
}
