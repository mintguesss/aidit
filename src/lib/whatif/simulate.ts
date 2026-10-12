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
import { auditExtra, mainRequiredOf, nameMatches } from "@/lib/extra/goals";
import { resolveDept } from "@/lib/offerings/depts";
import { programClausesFor, programDocTitle } from "@/lib/rules/program-regs";
import { findProgramUnit } from "@/lib/rules/program-units";
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
      return earlyGraduation(input, input.scenario.targetTerm, input.scenario.termsEarly);
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

function earlyGraduation(input: SimulateInput, given: string, termsEarly?: number): WhatIfResult {
  const { audit, record, pack } = input;
  // 沒講學期代號（「提前一學期畢業」）：照入學年度的大四下往回推；推出來的學期已經過了，就改算最快的下學期
  let targetTerm = given;
  let note = "";
  if (!/^\d+-[12]$/.test(given) && termsEarly) {
    const last = `${record.student.admissionYear + 3}-2`;
    const back = (t: string, n: number) => {
      const [y, s] = t.split("-").map(Number);
      const k = y! * 2 + (s === 2 ? 1 : 0) - n;
      return `${Math.floor(k / 2)}-${k % 2 === 1 ? 2 : 1}`;
    };
    targetTerm = back(last, termsEarly);
    note = `照入學年度，你的大四下是 ${last}，提前 ${termsEarly} 個學期是 ${targetTerm}。`;
    if (termsBetween(audit.nextTerm, targetTerm) === 0) {
      note += `這個學期已經過了，下面改算最快能畢業的 ${audit.nextTerm}。`;
      targetTerm = audit.nextTerm;
    }
  }
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
  // 目標學期之前還有好幾個學期：先看學分數排不排得進（每學期上限），不硬塞進同一個學期
  const terms = termsBetween(audit.nextTerm, targetTerm);
  if (requirements.length > 0 && terms > 1) {
    const cap = termLimitsFor(pack, record.student, audit.nextTerm).maxCredits;
    const per = Math.ceil(audit.unmet / terms);
    const fits = per <= cap;
    return {
      headline: fits
        ? `${targetTerm} 畢業：學分數排得進，平均每學期約 ${per} 學分`
        : `${targetTerm} 畢業：平均每學期要 ${per} 學分，超過上限 ${cap}`,
      level: fits ? "conditional" : "infeasible",
      detail:
        note +
        `從 ${audit.nextTerm} 到 ${targetTerm} 共 ${terms} 個學期，還差 ${audit.unmet} 學分（${requirements.map((r) => r.label).join("、")}），` +
        `平均每學期約 ${per} 學分，每學期上限 ${cap} 學分。` +
        (audit.inProgress > 0 ? `前提是本學期修課中的 ${audit.inProgress} 學分成績登錄及格。` : "") +
        (fits
          ? "這只算學分數；各類別的課在這幾個學期有沒有開、有沒有先修限制，要一學期一學期排，可以到「選課建議」先排下學期。"
          : "照每學期上限修也來不及。") +
        "學校對提前畢業是否另有資格條件（例如成績），系統沒有收錄，請向教務處註冊組確認。",
      alternatives: fits ? [] : ["利用暑修補學分", `改以 ${audit.nextTerm} 之後較晚的學期為目標`],
      citations: citationsFor(audit, requirements.map((r) => r.categoryId)),
      uncountedHolds: uncounted(audit),
    };
  }
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
  // 排得出課表不等於補得齊：這學期能排的課修完還差學分，就是這學期畢不了業（不能標成「可行」）
  if (plan.unmetAfter > 0) {
    return {
      headline: `${targetTerm} 畢業：這學期排滿 ${plan.totalCredits} 學分，還差 ${plan.unmetAfter} 學分補不齊`,
      level: "infeasible",
      detail:
        note +
        `於 ${targetTerm} 需補 ${requirements.map((r) => r.label).join("、")}；這學期最多排得進 ` +
        `${plan.courses.map((c) => `${c.name}（${c.credits} 學分）`).join("、")}，合計 ${plan.totalCredits} 學分，仍差 ${plan.unmetAfter} 學分。`,
      alternatives: ["利用暑修補學分", "改以較晚的學期為目標（可問「提前一學期畢業」看平均每學期要修多少）"],
      citations: citationsFor(audit, requirements.map((r) => r.categoryId)),
      uncountedHolds: uncounted(audit),
    };
  }
  const conditional = audit.inProgress > 0 || audit.holds.length > 0 || plan.relaxations.length > 0;
  return {
    headline: conditional ? "可行，但有前提條件" : "目前條件下可行",
    level: conditional ? "conditional" : "feasible",
    detail:
      note +
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
  // 課名只講一部分（「專題研究」）而對到好幾門時，優先修課中的那一門：只有修課中的能停修
  const target =
    record.courses.find((c) => c.code === key || c.name === key) ??
    record.courses.find((c) => c.status === "in_progress" && c.name.includes(key)) ??
    record.courses.find((c) => c.name.includes(key));
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
  // 現在打算加修，就是從下學期那一學年開始修讀
  const startYear = Number(audit.nextTerm.split("-")[0]);
  const extra = findExtraPack(KIND_OF[kind]!, { dept: dept?.code, program: name, school, startYear });
  const label = kind === "學分學程" ? (extra?.title ?? `「${name}」學程`) : `${dept?.name ?? name}${kind}`;

  if (extra) return withExtraRules(input, kind, extra, label, dept?.name ?? name, school, startYear);

  // 沒收錄該系（該學程）的規定：學校辦法有的就講，缺的資料講清楚，不推算
  const rules = programClausesFor(school, kind === "學分學程" ? "學程" : kind);
  const main = rules.find((x) => x.clause.main) ?? rules[0];
  // 學程雖然沒收錄修習要點，課程系統裡有它的開課單位：列出它開了哪些課（開課事實，不是推算）
  const unit = kind === "學分學程" ? findProgramUnit(school, name) : undefined;
  const unitLine = unit ? programUnitLine(unit, school) : undefined;
  return {
    headline: `還沒收錄${label}的科目表，無法算出還差哪些課`,
    level: "infeasible",
    detail: [
      main ? `學校的規定：${main.clause.text}` : "",
      kind === "學分學程"
        ? `各學程的應修科目由開設單位訂定，目前沒收錄「${name}」的修習要點。`
        : `要算出還差哪些，需要${dept?.name ?? `「${name}」`}的${kind}科目表（${kind === "雙主修" ? "依開始修讀那一年該系入學生的必修科目" : "該系的專業必修科目"}）。`,
      unitLine ?? "",
    ]
      .filter(Boolean)
      .join(NL),
    alternatives: [`可以向${kind === "學分學程" ? "開設學程的單位" : `${dept?.name ?? "該系"}系辦`}索取科目表，上傳後經人工校對即可試算`],
    citations: main ? [main.citation] : [],
    uncountedHolds: uncounted(audit),
  };
}

/**
 * 有收錄規定時的試算：分成「規定、你的進度、每學期要修多少、要注意」四段，
 * 替代路徑放真正可以選的另一條路（改修輔系、延長修業年限），不是重講規定。
 */
function withExtraRules(
  input: SimulateInput,
  kind: string,
  extra: ExtraPack,
  label: string,
  deptName: string,
  school: string,
  startYear: number,
): WhatIfResult {
  const { audit, record } = input;
  const usable = record.courses.filter((c) => c.status !== "failed" && c.status !== "withdrawn");
  const r = auditExtra(extra, usable, mainRequiredOf(audit));
  const offered = allOfferings(school);
  const nameOf = (code: string, req: ExtraPack["requirements"][number]) =>
    req.names?.[code] ?? offered.find((o) => o.code === code)?.name ?? code;
  const unmet = r.requirements.reduce((a, q) => a + q.unmet, 0);
  const sections: { title: string; lines: string[] }[] = [];
  const cite: Citation[] = [...r.requirements.map((q) => q.citation), r.overlapCitation];

  // 一、規定
  // 標籤已經寫了門數或學分（「基礎（3 選 1）」「織品服飾應用課程（至少 2 學分）」）就不再重複
  const parts = extra.requirements.map((q) =>
    /選|學分/.test(q.label)
      ? q.label
      : q.minCourses
        ? `${q.label.replace(/（.*）$/, "")} ${q.minCourses} 門`
        : `${q.label} ${q.credits} 學分`,
  );
  sections.push({
    title: "規定",
    lines: [
      `${extra.title}：${parts.join("、")}，共至少 ${extra.minCredits} 學分。`,
      extra.overlapPolicy,
      ...(kind !== "學分學程" ? [`你從 ${startYear} 學年開始修讀，依雙主修（輔系）辦法用該系 ${startYear} 學年適用的科目表。`] : []),
      ...(extra.caveat ? [extra.caveat] : []),
    ],
  });

  // 二、你的進度
  const progress = r.requirements.map((q) => {
    const req = extra.requirements.find((x) => x.id === q.id)!;
    const left =
      q.missingCourses !== undefined
        ? q.missingCourses > 0 ? `還差 ${q.missingCourses} 門` : "門數已足"
        : q.unmet > 0 ? `還差 ${q.unmet} 學分` : "已滿足";
    const missing =
      q.missingCodes.length > 0 && q.missingCodes.length <= 12
        ? `（還沒修：${[...new Set(q.missingCodes.map((c) => nameOf(c, req)))].join("、")}）`
        : "";
    return `${q.label}：已修 ${q.earned}${q.inProgress ? `（修課中 ${q.inProgress}）` : ""}／${q.required} 學分，${left}${missing}`;
  });
  if (r.nonMainShortfall) {
    progress.push(`學程學分至少一半不能是本系必修：之後要修的學程課裡，至少 ${r.nonMainShortfall} 學分要是本系必修以外的課。`);
  }
  if (r.waiverCandidates?.length) {
    progress.push(
      `你修過的 ${r.waiverCandidates.map((c) => c.name).join("、")} 跟${deptName}的科目同名：` +
        (extra.waiverByName?.text ?? `可以申請免修，由${deptName}主任認定；上面的數字沒有算進去。`),
    );
    if (extra.waiverByName) {
      const w = extra.waiverByName.citation;
      cite.push({ docId: w.docId, docTitle: programDocTitle(school, w.docId) ?? extra.document.title, locator: w.locator, quote: w.quote });
    }
  }
  // 下學期就開得到、還沒修過的課：讓學生知道第一學期可以先修哪些
  const [ny, nt] = audit.nextTerm.split("-").map(Number);
  // 包含不對外系開放的課：雙主修、輔系學生可以修那一系保留給本系的課
  const next = offeringsFor(ny!, nt as 1 | 2, school, undefined, true);
  const nextHits = new Map<string, string>();
  for (const q of extra.requirements) {
    for (const o of next) {
      const ok =
        q.match.type === "courseList"
          ? q.match.codes.includes(o.code)
          : q.match.type === "courseNames"
            ? nameMatches(q.match.names, o.name) && (!q.deptOnly || o.dept === extra.dept)
            : false;
      if (ok && !usable.some((c) => c.code === o.code || nameMatches([o.name], c.name))) nextHits.set(o.name, `${o.name}（${o.credits} 學分）`);
    }
  }
  if (unmet > 0 && nextHits.size > 0) progress.push(`${audit.nextTerm} 就有開的：${[...nextHits.values()].slice(0, 10).join("、")}。`);
  sections.push({ title: "你的進度", lines: progress });

  // 三、每學期要修多少（雙主修、輔系；學程多半跟本系課重疊，不估）
  const alternatives: string[] = [];
  const last = `${record.student.admissionYear + 3}-2`;
  const terms = termsBetween(audit.nextTerm, last);
  const cap = termLimitsFor(input.pack, record.student, audit.nextTerm).maxCredits;
  if (kind !== "學分學程" && unmet > 0 && terms > 0) {
    const need = audit.unmet + unmet;
    const per = Math.ceil(need / terms);
    const fastest = Math.ceil(need / cap);
    const lines = [
      `到大四下（${last}）還有 ${terms} 個學期：本系還差 ${audit.unmet} 學分，加上${kind}的 ${unmet} 學分，共 ${need} 學分，平均每學期約 ${per} 學分（每學期上限 ${cap}）。`,
    ];
    if (fastest > terms) {
      const over = fastest - terms;
      lines.push(`照每學期上限修滿，也要 ${fastest} 個學期，比大四下多 ${over} 個學期，要延長修業年限（或利用暑修）。`);
      alternatives.push(`延長修業年限 ${over} 個學期修完（雙主修辦法第十、十一條）`);
    } else {
      lines.push(`照上限排得進 ${terms} 個學期內，不用延長修業年限；但每學期都要修接近上限，課表會很滿。`);
    }
    sections.push({ title: "每學期要修多少", lines });
  }

  // 改修輔系當作替代路徑：雙主修排不下時，輔系要修的少很多
  if (kind === "雙主修" && extra.dept) {
    const minor = findExtraPack("minor", { dept: extra.dept, school, startYear });
    if (minor) {
      const m = auditExtra(minor, usable, mainRequiredOf(audit));
      const mu = m.requirements.reduce((a, q) => a + q.unmet, 0);
      const mper = terms > 0 ? Math.ceil((audit.unmet + mu) / terms) : 0;
      alternatives.unshift(
        `改修${deptName}輔系：還要約 ${mu} 學分${terms > 0 ? `，平均每學期約 ${mper} 學分${mper <= cap ? "，排得進修業年限內" : ""}` : ""}`,
      );
    }
  }

  // 四、要注意
  const notes: string[] = [];
  const clauseKind = kind === "學分學程" ? "學程" : kind;
  const pick = (locs: string[]) =>
    programClausesFor(school, `${clauseKind} 申請 什麼時候 衝堂 延畢 放棄 認定`).filter((x) => x.clause.program === clauseKind && locs.includes(x.clause.locator));
  const important =
    kind === "雙主修" ? pick(["第二條", "第八條", "第十條", "第十二條"]) : kind === "輔系" ? pick(["第二條", "第九條"]) : pick(["第六條", "第七條"]);
  for (const x of important) {
    notes.push(x.clause.text);
    cite.push(x.citation);
  }
  if (kind === "學分學程" && unmet === 0 && !r.nonMainShortfall) notes.unshift("規定的科目已經修完，可以向開設單位申請學程證明（沒事先申請的用認定制）。");
  if (extra.apply) notes.push(`申請方式：${extra.apply.text}`);
  if (notes.length > 0) sections.push({ title: "要注意", lines: notes });

  return {
    headline:
      unmet === 0 && !r.nonMainShortfall
        ? `${label}：已修的課已經符合規定`
        : `${label}：還要修約 ${Math.max(unmet, r.nonMainShortfall ?? 0)} 學分`,
    level: "conditional",
    detail: sections.map((x) => `【${x.title}】${x.lines.join(" ")}`).join(NL),
    sections,
    alternatives,
    citations: dedupe(cite),
    uncountedHolds: uncounted(audit),
  };
}

/** 學程單位在開課資料裡最近一學期開的課（「人工智慧應用微學程（K71）113-1 開了：…」） */
export function programUnitLine(unit: { code: string; name: string }, school: string): string | undefined {
  const mine = allOfferings(school).filter((o) => o.dept === unit.code);
  if (mine.length === 0) return `課程系統裡這個學程的開課單位是「${unit.name}」（${unit.code}），目前的開課資料裡沒有它的課。`;
  const latest = mine.reduce((a, o) => (o.year * 10 + Number(o.term) > a ? o.year * 10 + Number(o.term) : a), 0);
  const term = `${Math.floor(latest / 10)}-${latest % 10}`;
  const names = [...new Set(mine.filter((o) => o.year * 10 + Number(o.term) === latest).map((o) => `${o.name}（${o.credits} 學分）`))];
  return `課程系統裡這個學程是「${unit.name}」（${unit.code}），${term} 開了：${names.slice(0, 12).join("、")}${names.length > 12 ? " 等" : ""}。哪些算學程的必修、選修，要看它的修習要點。`;
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
