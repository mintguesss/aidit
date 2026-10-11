import {
  DEFAULT_PREFERENCES,
  type AuditResult,
  type Citation,
  type CourseRecord,
  type Scenario,
  type StudentRecord,
  type WhatIfResult,
} from "@/lib/types";
import type { RulePack } from "@/lib/rules/schema";
import { auditCredits } from "@/lib/audit/engine";
import {
  constraintsFrom,
  requirementsFrom,
  reservedFrom,
  solveWithRelaxation,
  type SolveContext,
} from "@/lib/solver/schedule";
import { offeringsFor, activeCourseCodes, allOfferings } from "@/lib/offerings";
import { loadRulePacks } from "@/lib/rules/loader";
import { findExtraPack, type ExtraPack } from "@/lib/rules/extra-packs";
import { auditExtra, mainRequiredOf } from "@/lib/extra/goals";
import { resolveDept } from "@/lib/offerings/depts";
import { programClausesFor } from "@/lib/rules/program-regs";
import { termLimitsFor } from "@/lib/rules/term-limits";
import { schoolOf } from "@/lib/schools";
import { continuingCourseCodes, takenCourseCodes } from "@/lib/solver/taken";
import { classProfileOf } from "@/lib/offerings/class-group";

/**
 * 情境試算的確定性推算（docs/SPEC.md §12 步驟 3）。
 *
 * 每一種 scenario 都是「改變輸入條件後重跑既有引擎」，不是另外問一次模型。
 * 無解時必須說明哪兩個條件在打架，而不是只回一句做不到。
 */

export type SimulateInput = {
  scenario: Scenario;
  audit: AuditResult;
  record: StudentRecord;
  pack: RulePack;
};

export function simulate(input: SimulateInput): WhatIfResult {
  switch (input.scenario.type) {
    case "early-graduation":
      return earlyGraduation(input, input.scenario.targetTerm);
    case "withdraw-course":
      return withdrawCourse(input, input.scenario.code);
    case "take-course":
      return takeCourse(input, input.scenario.course);
    case "add-minor":
      return anotherRuleSet(input, "輔系", input.scenario.dept);
    case "double-major":
      return anotherRuleSet(input, "雙主修", input.scenario.dept);
    case "add-cert-program":
      return anotherRuleSet(input, "學分學程", input.scenario.program);
    case "change-major":
      return changeMajor(input, input.scenario.dept);
    case "grade-threshold":
      return gradeThreshold(input, input.scenario.target);
  }
}

const NL = String.fromCharCode(10);
const uncounted = (a: AuditResult) => a.holds.length;

// ---------------------------------------------------------- 提前畢業

function earlyGraduation(input: SimulateInput, targetTerm: string): WhatIfResult {
  const { audit, record, pack } = input;
  const parsed = /^(\d+)-([12])$/.exec(targetTerm);
  if (!parsed) {
    return {
      headline: "無法解析目標學期",
      level: "infeasible",
      detail: `目標學期「${targetTerm}」不是合法的學期代號（格式應為如 115-1）。`,
      alternatives: [],
      citations: [],
      uncountedHolds: uncounted(audit),
    };
  }
  const year = Number(parsed[1]);
  const term = Number(parsed[2]) as 1 | 2;

  const requirements = requirementsFrom(audit);
  if (requirements.length === 0) {
    return {
      headline:
        audit.inProgress > 0 ? "修課中科目成績登錄後即可達成" : "目前條件下可行",
      level: audit.holds.length > 0 ? "conditional" : "feasible",
      detail: `各類別學分均已滿足${audit.inProgress > 0 ? `，尚有 ${audit.inProgress} 學分修課中` : ""}，無須於 ${targetTerm} 另行補修。`,
      alternatives: [],
      citations: audit.categories.flatMap((c) => c.citations).slice(0, 3),
      uncountedHolds: uncounted(audit),
    };
  }

  const ctx = buildSolveContext(audit, record, pack, year, term, requirements);
  const result = solveWithRelaxation(ctx, "fill-unmet", []);

  if (!result.ok) {
    const first = result.infeasibilities[0]!;
    const blockers = first.excludedBy
      .map((e) => `${e.reason} ${e.count} 門`)
      .join("、");
    return {
      headline: "目前條件下不可行",
      level: "infeasible",
      detail:
        `於 ${targetTerm} 需補修 ${requirements.map((r) => r.label).join("、")}。` +
        `其中「${first.category}」在 ${targetTerm} 共 ${first.candidatesBeforeFilter} 門符合類別之開課，` +
        `經過濾後無一可選（${blockers}）。`,
      conflict: first.conflictWith
        ? {
            a: first.category,
            b: first.conflictWith,
            explanation: `補修「${first.category}」與已登記之「${first.conflictWith}」在同一時段，兩者無法並存；這是本情境無解的直接原因。`,
          }
        : undefined,
      alternatives: [first.suggestion, "確認該類別是否開設暑修班", "向系辦申請領域抵充認定"],
      citations: citationsFor(audit, requirements.map((r) => r.categoryId)),
      uncountedHolds: uncounted(audit),
    };
  }

  const plan = result.plans[0]!;
  const conditional = audit.inProgress > 0 || audit.holds.length > 0 || plan.relaxations.length > 0;
  return {
    headline: conditional ? "可行，但有前提條件" : "目前條件下可行",
    level: conditional ? "conditional" : "feasible",
    detail:
      `於 ${targetTerm} 修習 ${plan.courses.map((c) => `${c.name}（${c.code}，${c.credits} 學分）`).join("、")}` +
      `，合計 ${plan.totalCredits} 學分，即可補足 ${requirements.map((r) => r.label).join("、")}。` +
      (audit.inProgress > 0
        ? `前提是本學期修課中的 ${audit.inProgress} 學分成績登錄及格。`
        : "") +
      (plan.warnings.length > 0 ? plan.warnings.join(" ") : "") +
      (plan.relaxations.length > 0 ? `本結果已放寬條件：${plan.relaxations.join("、")}。` : ""),
    alternatives: result.plans.slice(1).map(
      (p) => `替代組合：${p.courses.map((c) => c.name).join("、")}（${p.totalCredits} 學分）`,
    ),
    citations: citationsFor(audit, requirements.map((r) => r.categoryId)),
    uncountedHolds: uncounted(audit),
  };
}

// ---------------------------------------------------------- 停修影響

function withdrawCourse(input: SimulateInput, key: string): WhatIfResult {
  const { audit, record, pack } = input;
  const target = record.courses.find(
    (c) => c.code === key || c.name === key || c.name.includes(key),
  );
  if (!target) {
    // 只有「修課中」的科目可以停修 —— 直接把可停修的清單給出來，比要學生再猜一次有用
    const ongoing = record.courses.filter((c) => c.status === "in_progress");
    return {
      headline: "查無此修課紀錄",
      level: "infeasible",
      detail:
        `修課紀錄中查無「${key}」。` +
        (ongoing.length > 0
          ? `目前修課中的科目是：${ongoing.map((c) => `${c.name}（${c.code}）`).join("、")}。`
          : "目前沒有修課中的科目，沒有可停修的對象。"),
      alternatives: [],
      citations: [],
      uncountedHolds: uncounted(audit),
    };
  }
  if (target.status !== "in_progress") {
    return {
      headline: "此科目不在可停修狀態",
      level: "infeasible",
      detail: `「${target.name}」目前狀態為${statusLabel(target.status)}，非修課中，無停修可言。`,
      alternatives: [],
      citations: [],
      uncountedHolds: uncounted(audit),
    };
  }

  const after = auditCredits({
    record: {
      ...record,
      courses: record.courses.map((c) =>
        c === target ? { ...c, status: "withdrawn" as const, score: null } : c,
      ),
    },
    pack,
    traceId: `${audit.traceId}-whatif`,
    currentTerm: audit.currentTerm,
    nextTerm: audit.nextTerm,
    activeCourseCodes: activeCourseCodes(),
  });

  const delta = after.unmet - audit.unmet;
  const changed = audit.categories
    .map((c) => {
      const b = after.categories.find((x) => x.id === c.id)!;
      return { name: c.name, before: c.unmet, after: b.unmet };
    })
    .filter((x) => x.before !== x.after);

  return {
    headline: delta > 0 ? `停修後未修學分增加 ${delta} 學分` : "停修不影響目前的未修學分",
    level: delta > 0 ? "conditional" : "feasible",
    detail:
      `停修「${target.name}」（${target.code}，${target.credits} 學分）後，` +
      (changed.length > 0
        ? `${changed.map((c) => `${c.name}未修 ${c.before} → ${c.after}`).join("、")}。`
        : "各類別未修學分不變。") +
      `依學則第 23 條，停修之科目不計學分，亦不列入該學期修習學分數之計算。`,
    alternatives:
      delta > 0
        ? [`於 ${audit.nextTerm} 重修「${target.name}」`, "確認停修後該學期修習學分數是否仍達下限"]
        : [],
    citations: citationsFor(audit, changed.length > 0 ? audit.categories.map((c) => c.id) : []),
    uncountedHolds: uncounted(audit),
  };
}

// ------------------------------------------------------------ 修某一門課

/**
 * 下學期修某一門課會怎樣：把它當成修課中加進紀錄，重跑審查。
 * 回報算進哪一類、各類未修學分怎麼變；採計方式不確定的（例：舊生修新領域的通識）
 * 會落到待確認，要明講為什麼、該找誰，而不是假裝算得出來。
 */
function takeCourse(input: SimulateInput, key: string): WhatIfResult {
  const { audit, record, pack } = input;
  const school = schoolOf(record.student);
  const [y, t] = audit.nextTerm.split("-").map(Number) as [number, 1 | 2];
  const k = key.trim();
  const pick = (list: ReturnType<typeof allOfferings>) =>
    list.find((o) => o.code === k) ?? list.find((o) => o.name === k) ?? list.find((o) => o.name.includes(k));
  const next = pick(offeringsFor(y, t, school, pack));
  const any = next ?? pick([...allOfferings(school)].sort((a, b) => b.year - a.year || Number(b.term === 2) - Number(a.term === 2)));
  if (!any) {
    return {
      headline: "開課資料中找不到這門課",
      level: "infeasible",
      detail: `開課資料中找不到「${k}」。請提供課號或完整課名。`,
      alternatives: [],
      citations: [],
      uncountedHolds: uncounted(audit),
    };
  }
  const taken = record.courses.find((c) => c.code === any.code && c.status === "passed");
  const added: CourseRecord = {
    code: any.code,
    name: any.name,
    credits: any.credits,
    year: y,
    term: t,
    selectType: any.selectType ?? "elective",
    score: null,
    status: "in_progress",
    offeringDept: any.dept,
    ...(any.college ? { offeringCollege: any.college } : {}),
    ...(any.generalDomain ? { generalDomain: any.generalDomain } : {}),
  };
  const after = auditCredits({
    record: { ...record, courses: [...record.courses, added] },
    pack,
    traceId: `${audit.traceId}-whatif`,
    currentTerm: audit.currentTerm,
    nextTerm: audit.nextTerm,
    activeCourseCodes: activeCourseCodes(),
  });

  const offeredNote = next ? "" : `${audit.nextTerm} 沒有開這門課，以下用最近一次開課（${any.year}-${any.term}）的資料試算。`;
  const newHolds = after.holds.filter((h) => !audit.holds.some((x) => x.id === h.id));
  const hold = newHolds.find((h) => `${h.title}${h.body}${h.impact}`.includes(any.name) || `${h.title}${h.body}`.includes(any.code));
  if (hold) {
    return {
      headline: `修「${any.name}」採計方式要人工確認`,
      level: "conditional",
      detail: `${offeredNote}${hold.title}。${hold.body}`,
      alternatives: [`向${hold.contact}確認這門課的採計方式後再選`, "改選採計方式確定的同類課程"],
      citations: hold.citations,
      uncountedHolds: uncounted(after),
    };
  }

  const into = after.categories.find((c) => c.assignedCodes.includes(any.code) && !audit.categories.find((b) => b.id === c.id)?.assignedCodes.includes(any.code));
  const changed = audit.categories
    .map((c) => ({ name: c.name, before: c.unmet, after: after.categories.find((x) => x.id === c.id)!.unmet }))
    .filter((x) => x.before !== x.after);
  const reduced = audit.unmet - after.unmet;
  return {
    headline: reduced > 0 ? `修「${any.name}」可減少未修 ${reduced} 學分` : `修「${any.name}」不會減少未修學分`,
    level: reduced > 0 ? "feasible" : "conditional",
    detail:
      offeredNote +
      (taken ? `你已修過這門課（${taken.year}-${taken.term}），再修通常不重複採計。` : "") +
      (into ? `會算進「${into.name}」。` : "沒有可以算進的類別，或該類已經修滿，只會算超修。") +
      (changed.length > 0 ? changed.map((c) => `${c.name}未修 ${c.before} → ${c.after}`).join("、") + "。" : ""),
    alternatives: [],
    citations: citationsFor(after, into ? [into.id] : []),
    uncountedHolds: uncounted(after),
  };
}

// ------------------------------------------------- 輔系／學程（規則包未載入）

/**
 * 加修另一套規定：輔系、雙主修、學分學程。
 *
 * 這三件事在學生口中常常混著講，但它們是**三套不同的規定**：
 *   輔系　　　只修另一系的指定科目，不另發學位
 *   雙主修　　兩系的畢業條件都要滿足，兩張學位
 *   學分學程　跨系的課程模組，另發學程證明
 * 系統不會把其中一種當成另一種來算，也不會在沒有規定的情況下給數字 ——
 * 猜錯等於換了一整套畢業條件。
 */
const RULE_SET_NEEDS: Record<string, string[]> = {
  輔系: ["該系輔系應修科目與最低學分", "本系課程可否抵充輔系學分之認定", "申請與核可程序"],
  雙主修: [
    "該系之完整課程規劃表（雙主修須同時滿足兩系畢業條件）",
    "兩系共同科目之重複採計規定",
    "修業年限與學分上限之放寬規定",
  ],
  學分學程: ["該學程之應修科目與最低學分", "已修科目可否採計入學程", "學程證明之申請程序"],
};

const KIND_OF: Record<string, "minor" | "double-major" | "cert-program"> = {
  輔系: "minor",
  雙主修: "double-major",
  學分學程: "cert-program",
};

/**
 * 加修另一套規定（輔系、雙主修、學分學程）。
 *
 * 有收錄那一系（那個學程）的規定：照規定逐項算還差什麼（extra/goals 的 auditExtra，跟修業明細同一套），
 * 再估一下兩邊加起來每學期要修多少。沒收錄：講學校辦法的規定（有收錄的話）與還缺哪一份資料，不推算數字。
 */
function anotherRuleSet(input: SimulateInput, kind: string, name: string): WhatIfResult {
  const { audit, record } = input;
  const school = schoolOf(record.student);
  const dept = kind === "學分學程" ? undefined : resolveDept(name);
  const extra = findExtraPack(KIND_OF[kind]!, { dept: dept?.code, program: name, school });
  const label = kind === "學分學程" ? (extra?.title ?? `「${name}」學程`) : `${dept?.name ?? name}${kind}`;

  if (extra) {
    const usable = record.courses.filter((c) => c.status !== "failed" && c.status !== "withdrawn");
    const r = auditExtra(extra, usable, mainRequiredOf(audit));
    const offered = allOfferings(school);
    const nameOf = (code: string, req: ExtraPack["requirements"][number]) =>
      req.names?.[code] ?? offered.find((o) => o.code === code)?.name ?? code;
    const lines = r.requirements.map((q) => {
      const req = extra.requirements.find((x) => x.id === q.id)!;
      const done = `${q.label}：已修 ${q.earned}${q.inProgress ? `（修課中 ${q.inProgress}）` : ""}／${q.required} 學分`;
      const left =
        q.missingCourses !== undefined
          ? q.missingCourses > 0 ? `，還差 ${q.missingCourses} 門` : "，門數已足"
          : q.unmet > 0 ? `，還差 ${q.unmet} 學分` : "，已滿足";
      const missing =
        q.missingCodes.length > 0 && q.missingCodes.length <= 12
          ? `（未修：${[...new Set(q.missingCodes.map((c) => nameOf(c, req)))].join("、")}）`
          : "";
      return done + left + missing;
    });
    const unmet = r.requirements.reduce((a, q) => a + q.unmet, 0);
    const notes: string[] = [];
    if (r.nonMainShortfall) {
      notes.push(`學程至少一半學分不能是本系必修：已採計的課多半是本系必修，還要再修至少 ${r.nonMainShortfall} 學分不是本系必修的學程課。`);
    }
    if (r.waiverCandidates?.length) {
      notes.push(
        `你修過的 ${r.waiverCandidates.map((c) => c.name).join("、")} 跟${dept?.name ?? "該系"}的科目同名，` +
          `可以申請免修，由${dept?.name ?? "該系"}主任認定；上面的數字沒有算進去。`,
      );
    }
    // 雙主修、輔系：兩邊加起來每學期要修多少（學分學程多半跟本系課重疊，不估）
    if (kind !== "學分學程" && unmet > 0) {
      const last = `${record.student.admissionYear + 3}-2`;
      const terms = termsBetween(audit.nextTerm, last);
      const need = audit.unmet + unmet;
      const cap = termLimitsFor(input.pack, record.student, audit.nextTerm).maxCredits;
      if (terms > 0) {
        const per = Math.ceil(need / terms);
        notes.push(
          `本系還差 ${audit.unmet} 學分，加上${kind}還差的 ${unmet} 學分，剩下 ${terms} 個學期平均每學期要修約 ${per} 學分` +
            (per > cap ? `，超過每學期上限 ${cap}，照這個進度要延長修業年限。` : `（每學期上限 ${cap}）。`),
        );
      }
    }
    if (extra.provenance !== "approved") notes.push("這份規定是從學校公開文件抄錄的，還沒經人工校對鎖版；實際應修與免修以承辦單位認定為準。");

    return {
      headline:
        unmet === 0 && !r.nonMainShortfall
          ? `${label}：已修的課已經符合規定`
          : `${label}：還要修約 ${Math.max(unmet, r.nonMainShortfall ?? 0)} 學分`,
      level: "conditional",
      detail: [...lines, ...notes].join(NL),
      alternatives: [extra.overlapPolicy],
      citations: dedupe([
        ...r.requirements.map((q) => q.citation),
        r.overlapCitation,
        ...(extra.waiverByName && r.waiverCandidates?.length
          ? [{ docId: extra.waiverByName.citation.docId, docTitle: extra.waiverByName.citation.docId, locator: extra.waiverByName.citation.locator, quote: extra.waiverByName.citation.quote }]
          : []),
      ]),
      uncountedHolds: uncounted(audit),
    };
  }

  // 沒收錄該系（該學程）的規定：學校辦法有的就講，缺的資料講清楚，不推算
  const rules = kind === "學分學程" ? [] : programClausesFor(school, kind);
  const main = rules.find((x) => x.clause.main) ?? rules[0];
  return {
    headline: `還沒收錄${label}的科目表，無法算出還差哪些課`,
    level: "infeasible",
    detail: [
      main ? `學校的規定：${main.clause.text}` : "",
      kind === "學分學程"
        ? `各學程的應修科目由開設單位訂定，目前沒收錄「${name}」的修習要點。`
        : `要算出還差哪些，需要${dept?.name ?? `「${name}」`}的${kind}科目表（${kind === "雙主修" ? "依開始修讀那一年該系入學生的必修科目" : "該系的專業必修科目"}）。`,
    ]
      .filter(Boolean)
      .join(NL),
    alternatives: [`可以向${kind === "學分學程" ? "開設學程的單位" : `${dept?.name ?? "該系"}系辦`}索取科目表，上傳後經人工校對即可試算`],
    citations: main ? [main.citation] : [],
    uncountedHolds: uncounted(audit),
  };
}

/** 學期代號 a 到 b（含）共有幾個學期（只算上下學期） */
function termsBetween(a: string, b: string): number {
  const n = (t: string) => {
    const [y, s] = t.split("-").map(Number);
    return y! * 2 + (s === 2 ? 1 : 0);
  };
  return Math.max(0, n(b) - n(a) + 1);
}

// ---------------------------------------------------------- 轉系

/**
 * 轉系。
 *
 * 轉系與加修不同：它會**改變適用的課程規劃表版本**，而版本綁定是這套系統
 * 最不能含糊的一件事（docs/SPEC.md §6 step 2：學籍入學學年與實際入學學年不一致即轉人工）。
 * 因此這裡不做任何「轉過去大概還差幾學分」的推估，
 * 只把「會影響什麼、需要哪些依據」講清楚。
 */
function changeMajor(input: SimulateInput, dept: string): WhatIfResult {
  const { audit, record, pack } = input;
  const packs = loadRulePacks();
  const target = packs.find((p) => p.dept === dept || p.id.includes(dept));
  const earned = record.courses
    .filter((c) => c.status === "passed" || c.status === "waived")
    .reduce((a, c) => a + c.credits, 0);

  const common = {
    level: "infeasible" as const,
    citations: [] as Citation[],
    uncountedHolds: uncounted(audit),
  };

  const shared = [
    `轉系會改變適用的課程規劃表：目前依「${pack.dept} ${pack.admissionYear} 學年度 rev.${pack.version}」判定，`,
    `轉系後改依轉入學系之版本，已修 ${earned} 學分中有多少可採計、採計到哪一類別，`,
    "都要重新認定，而不是把現在的判定平移過去。",
  ].join("");

  if (!target) {
    return {
      ...common,
      headline: `無法試算轉系：尚未收錄「${dept}」的課程規劃表與轉系規定`,
      detail:
        shared +
        `本系統目前只收錄 ${packs.map((p) => `${p.dept} ${p.admissionYear} 學年度`).join("、")}，` +
        `查無「${dept}」之規定，因此不就轉系後的學分狀況作任何推算。`,
      alternatives: [
        `需要補齊的資料：「${dept}」之課程規劃表、轉系錄取後之學分採計辦法、轉系申請資格與時程`,
        "取得課程規劃表後可到「適用規劃表」頁上傳，經人工校對鎖版後即可試算",
        "轉系資格與名額請洽教務處註冊組",
      ],
    };
  }

  return {
    ...common,
    headline: `「${dept}」的課程規劃表已載入，但轉系後的學分採計須經人工認定`,
    level: "conditional",
    detail:
      shared +
      "系統可以讀到轉入學系的應修條件，但「哪一門課採計到哪一類」在轉系案中是由系上逐案認定的，" +
      "不是規則包能推導出來的。系統不以未經認定的假設輸出數字。",
    alternatives: [
      "向轉入學系索取學分採計對照結果後，由承辦人協助試算",
      "轉系申請資格與時程請洽教務處註冊組",
    ],
  };
}

// ---------------------------------------------------------- 成績門檻

/**
 * 系統不預測成績、不預測是否被當（docs/SPEC.md §0）。
 * 因此本情境只回報「已確定的事實」：已修科目之加權平均與可採計學分數。
 */
function gradeThreshold(input: SimulateInput, target: string): WhatIfResult {
  const { audit, record } = input;
  const graded = record.courses.filter((c) => c.status === "passed" && typeof c.score === "number");
  const credits = graded.reduce((a, c) => a + c.credits, 0);
  const weighted = graded.reduce((a, c) => a + c.credits * (c.score as number), 0);
  const avg = credits > 0 ? weighted / credits : 0;

  return {
    headline: "系統不預測成績，僅回報目前已確定的數字",
    level: "conditional",
    detail:
      `就「${target}」一事，本系統不預測未來成績、不預測是否通過，也不代為評估錄取機會。` +
      `目前已登錄成績之科目共 ${graded.length} 門、${credits} 學分，學分加權平均為 ${avg.toFixed(2)} 分。` +
      `本學期尚有 ${audit.inProgress} 學分修課中，成績未登錄，未計入上述平均。` +
      `各校系之採計方式（是否含通識、是否計入重修）不一，實際換算應以該校系簡章為準。`,
    alternatives: [
      "向欲報考之校系確認成績採計範圍與換算方式",
      "向教務處註冊組申請歷年成績單以取得正式數字",
    ],
    citations: [],
    uncountedHolds: uncounted(audit),
  };
}

// ------------------------------------------------------------------ 共用

function buildSolveContext(
  audit: AuditResult,
  record: StudentRecord,
  pack: RulePack,
  year: number,
  term: 1 | 2,
  requirements: ReturnType<typeof requirementsFrom>,
): SolveContext {
  // 試算可能跨好幾個學期，每個學期用它自己的學年算上下限
  const limits = termLimitsFor(pack, record.student, `${year}-${term}`);
  return {
    offerings: offeringsFor(year, term, schoolOf(record.student), pack),
    requirements,
    passedCodes: new Set(
      record.courses
        .filter((c) => c.status === "passed" || c.status === "waived")
        .map((c) => c.equivalentOf ?? c.code),
    ),
    takenCodes: takenCourseCodes(record.courses, pack),
    continueCodes: continuingCourseCodes(record.courses, pack),
    admissionYear: record.student.admissionYear,
    studentDept: record.student.dept, classProfile: classProfileOf(record.student, pack.college),
    reserved: reservedFrom(record.plannedCommitments),
    // 提前畢業的試算以「最快畢業」為目標，覆寫學生平時的選課傾向 ——
    // 使用者問的就是「拚一點有沒有可能」，用輕量傾向去算會答錯方向
    preferences: { ...(record.preferences ?? DEFAULT_PREFERENCES), goal: "asap" },
    constraints: constraintsFrom(
      { ...(record.preferences ?? DEFAULT_PREFERENCES), goal: "asap", maxCredits: undefined },
      limits,
    ),
    termLabel: `${year}-${term}`,
    termMinCredits: limits.minCredits,
    termMaxCredits: limits.maxCredits,
  };
}

function citationsFor(audit: AuditResult, categoryIds: string[]): Citation[] {
  const ids = new Set(categoryIds);
  const out: Citation[] = [];
  for (const c of audit.categories) {
    if (!ids.has(c.id)) continue;
    out.push(...c.citations);
    for (const s of c.subRules) out.push(...s.citations);
  }
  return dedupe(out).slice(0, 5);
}

function dedupe(list: Citation[]): Citation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.docId}|${c.locator}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function statusLabel(s: CourseRecord["status"]): string {
  return { passed: "及格", failed: "不及格", in_progress: "修課中", withdrawn: "已停修", waived: "抵免" }[s];
}
