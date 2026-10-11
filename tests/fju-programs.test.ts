import { describe, expect, it } from "vitest";
import { fixture } from "@/lib/providers/fixtures";
import { findExtraPack } from "@/lib/rules/extra-packs";
import { auditExtra } from "@/lib/extra/goals";
import { programClausesFor } from "@/lib/rules/program-regs";
import { answerProgramProcedure, programPackIn } from "@/lib/chat/capabilities";
import { loadCorpus } from "@/lib/rules/loader";
import { extraCorpus, loadExtraPacks } from "@/lib/rules/extra-packs";
import { verifyCitation } from "@/lib/verify/citation";
import type { RulePack } from "@/lib/rules/schema";

/** 輔大的雙主修、輔系辦法與收錄的雙主修、學程規定（2026-10-12 從學校公開文件抄錄） */

const record = fixture("fju-im-111-year2").record;
const usable = record.courses.filter((c) => c.status === "passed");
// 資管的院系必修（單元測試載不到 Supabase 上的規則包，直接列出這份成績單裡會用到的）
const imRequired = new Set(["16258", "24496", "02490"]);

describe("雲端服務學程", () => {
  const pack = findExtraPack("cert-program", { program: "雲端", school: "fju" })!;

  it("「雲端學程」對得到「雲端服務學程」，合成學校的學程不會混進來", () => {
    expect(pack?.id).toBe("fju-cloud-program-112");
    expect(findExtraPack("cert-program", { program: "雲端", school: "demo" })).toBeUndefined();
  });

  it("課名大小寫不同也算（成績單的「WEB程式設計」「web前端設計」）；門數與「至少一半不能是本系必修」都算進去", () => {
    const r = auditExtra(pack, usable, (code) => imRequired.has(code));
    const by = Object.fromEntries(r.requirements.map((q) => [q.id, q]));
    expect(by.required).toMatchObject({ earned: 3, unmet: 0 });
    expect(by.core).toMatchObject({ courses: 3, missingCourses: 0 });
    expect(by.elective).toMatchObject({ courses: 1, missingCourses: 2 });
    // 已採計 17 學分裡只有雲端應用平台概論、雲端應用程式設計（6 學分）不是本系必修，至少要 10
    expect(r.nonMainShortfall).toBe(4);
  });
});

describe("心理系雙主修", () => {
  const pack = findExtraPack("double-major", { dept: "39", school: "fju" })!;

  it("本系開的同名課（統計學、經濟學）不算進去，列為可申請免修", () => {
    const r = auditExtra(pack, usable);
    expect(r.earned).toBe(0);
    expect(r.unmet).toBe(64);
    expect(r.waiverCandidates?.map((c) => c.name).sort()).toEqual(["統計學", "經濟學"]);
  });
});

describe("學校的雙主修、輔系辦法", () => {
  it.each([
    ["雙主修要修幾學分", "雙主修", "第五條"],
    ["雙主修會延畢嗎", "雙主修", "第十條"],
    ["輔系要修多少", "輔系", "第四條"],
    ["雙主修什麼時候可以申請", "雙主修", "第二條"],
  ])("%s → %s %s", (said, program, locator) => {
    const hits = programClausesFor("fju", said);
    expect(hits.map((h) => `${h.clause.program}${h.clause.locator}`)).toContain(`${program}${locator}`);
  });

  it("每一條引用的原文都查得到（citation.verify）", () => {
    const corpus = new Map([...loadCorpus(), ...extraCorpus()]);
    for (const h of programClausesFor("fju", "雙主修 輔系 學分 申請 什麼時候 延畢 免修 放棄 相同")) {
      expect(verifyCitation(h.citation, corpus).ok, `${h.citation.docId} ${h.citation.locator}`).toBe(true);
    }
    for (const p of loadExtraPacks().filter((x) => x.school === "fju")) {
      for (const q of p.requirements) {
        expect(verifyCitation({ ...q.citation, docTitle: "" }, corpus).ok, `${p.id} ${q.citation.locator}`).toBe(true);
      }
    }
    for (const id of ["fju-cloud-program-112", "fju-psy-double-major-109"]) {
      const p = [
        findExtraPack("cert-program", { program: "雲端", school: "fju" }),
        findExtraPack("double-major", { dept: "39", school: "fju", startYear: 112 }),
      ].find((x) => x?.id === id)!;
      for (const q of p.requirements) {
        expect(verifyCitation({ ...q.citation, docTitle: "" }, corpus).ok, `${id} ${q.citation.locator}`).toBe(true);
      }
    }
  });
});

describe("學程怎麼申請", () => {
  const fju = { school: "fju" } as RulePack;
  it("「我想修雲端學程 如何申請」→ 雲端學程自己的申請方式", () => {
    expect(programPackIn("我想修雲端學程 如何申請", "fju")?.id).toBe("fju-cloud-program-112");
    const r = answerProgramProcedure("我想修雲端學程 如何申請", fju)!;
    expect(r.headline).toContain("LM306");
  });
  it("雙主修怎麼申請 → 學校辦法的申請期間", () => {
    expect(answerProgramProcedure("雙主修要怎麼申請", fju)!.headline).toContain("教務處公告");
  });
});

describe("輔系", () => {
  it("心理系輔系：本系的統計學不能算，列出來並說要另選補足", () => {
    const pack = findExtraPack("minor", { dept: "39", school: "fju" })!;
    const r = auditExtra(pack, usable);
    expect(r.unmet).toBe(24);
    expect(r.waiverCandidates?.map((c) => c.name)).toEqual(["統計學"]);
    expect(pack.waiverByName?.text).toContain("另選");
  });
  it("物理系沒有輔系科目表：依輔系辦法以專業必修、至少 20 學分，並講明但書", () => {
    const pack = findExtraPack("minor", { dept: "PH", school: "fju" })!;
    expect(pack.minCredits).toBe(20);
    expect(pack.caveat).toContain("第三、四條");
  });
  it("物理系必修每一門都對得到課名（缺課清單不會只剩課號）", () => {
    const pack = findExtraPack("double-major", { dept: "PH", school: "fju" })!;
    for (const q of pack.requirements) {
      if (q.match.type !== "courseList") continue;
      for (const code of q.match.codes) expect(q.names?.[code], code).toBeTruthy();
    }
  });
});

describe("依開始修讀的學年選科目表（雙主修辦法第六條）", () => {
  it.each([
    [112, "39", "fju-psy-double-major-109"],
    [113, "39", "fju-psy-double-major-113"],
    [112, "PH", "fju-ph-double-major-110"],
    [113, "PH", "fju-ph-double-major-113"],
  ])("%i 學年開始、系所 %s → %s", (startYear, dept, id) => {
    expect(findExtraPack("double-major", { dept, school: "fju", startYear })?.id).toBe(id);
  });
});
