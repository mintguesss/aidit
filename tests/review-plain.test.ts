import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCredits } from "@/lib/audit/engine";
import { zRulePack } from "@/lib/rules/schema";
import type { CourseRecord, StudentRecord } from "@/lib/types";

/**
 * 校對頁要讓「不是工程師的人」也能校對（使用者回報：「學制 day」「比對方式 courseList」看不懂）。
 * 以及 A6 的回覆：規劃表畫在系選修框外的兩門課，不算那 10 學分系專選。
 */

const DRAFT = "docs/review/fju-im-111.draft.json";
const draft = JSON.parse(readFileSync(DRAFT, "utf8")) as Record<string, unknown>;

describe("A6：系選修框外的兩門課", () => {
  const pack = zRulePack.parse(draft);

  function audit(courses: CourseRecord[], p = pack) {
    const record: StudentRecord = {
      student: { id: "S-TEST", dept: "IM", admissionYear: 111, actualAdmissionYear: 111, status: "enrolled", program: "day" },
      courses,
      fetchedAt: "2026-10-01T00:00:00Z",
      source: "mock",
    };
    const a = auditCredits({ record, pack: p, traceId: "t", currentTerm: "115-1", nextTerm: "115-2" });
    expect(a.countable + a.inProgress + a.unmet).toBe(a.minCredits);
    return {
      earned: (id: string) => a.categories.find((x) => x.id === id)!.earned,
      check: (id: string) => a.graduationChecks.find((x) => x.id === id)!,
    };
  }

  const elective = (code: string, name: string, credits: number): CourseRecord => ({
    code, name, credits, year: 114, term: 1, status: "passed", selectType: "elective", score: 80,
  });

  it("校對結論（v0.5）：兩門都算系專選", () => {
    expect(audit([elective("19664", "組織學習與社會探究", 2)]).earned("major-elective")).toBe(2);
    expect(audit([elective("19663", "組織領導與社會創新實務", 2)]).earned("major-elective")).toBe(2);
  });

  describe("排除課名的機制（excludeNames）", () => {
    const excluding = zRulePack.parse({
      ...draft,
      categories: (draft.categories as { id: string; match: object }[]).map((c) =>
        c.id === "major-elective"
          ? { ...c, match: { ...c.match, excludeNames: ["組織學習與社會探究", "組織領導與社會創新實務"] } }
          : c,
      ),
    });

    it("被排除的課只能算其他選修", () => {
      const r = audit([elective("19664", "組織學習與社會探究", 2)], excluding);
      expect(r.earned("major-elective")).toBe(0);
      expect(r.earned("free-elective")).toBe(2);
    });

    it("課名比對忽略空白", () => {
      expect(audit([elective("19663", "組織領導與 社會創新實務", 2)], excluding).earned("major-elective")).toBe(0);
    });

    it("同課號（19664）的「資訊系統專案管理」不受影響 —— 這就是用課名不用課號的原因", () => {
      expect(audit([elective("19664", "資訊系統專案管理", 3)], excluding).earned("major-elective")).toBe(3);
    });
  });

  describe("國防：從成績單的課名判斷（校對第 14 項）", () => {
    const defense = (status: CourseRecord["status"], term: 1 | 2 = 1, name = "全民國防教育軍事訓練"): CourseRecord => ({
      code: "", name, credits: 0, year: 111, term, status, selectType: "required", score: status === "passed" ? 80 : null,
    });

    it("上下學期都通過 → 通過", () => {
      expect(audit([defense("passed", 1), defense("passed", 2)]).check("defense-education").status).toBe("satisfied");
    });

    it("只修一學期不夠（規劃表一上、一下各一欄）", () => {
      const c = audit([defense("passed", 1)]).check("defense-education");
      expect(c.status).toBe("hold");
      expect(c.detail).toContain("只有 1 學期，需要 2 學期");
    });

    it("一學期通過、一學期正在修 → 「修課中」", () => {
      const c = audit([defense("passed", 1), defense("in_progress", 2)]).check("defense-education");
      expect(c.status).toBe("hold");
      expect(c.label).toBe("修課中");
    });

    it("找不到 → 待確認，不判未修 —— 可能只是課名寫法不同", () => {
      const c = audit([defense("passed", 1, "全民國防教育(一)"), defense("passed", 2, "全民國防教育(二)")]).check("defense-education");
      expect(c.status).toBe("hold");
      expect(c.detail).toContain("資訊管理學系辦公室");
    });

    it("不及格不算", () => {
      expect(audit([defense("failed", 1), defense("passed", 2)]).check("defense-education").status).toBe("hold");
    });
  });

  describe("外國語文：成績單把級別寫在括號裡", () => {
    const lang = (name: string, term: 1 | 2): CourseRecord => ({
      code: "", name, credits: 2, year: 111, term, status: "passed", selectType: "required", score: 85,
    });

    it("「外國語文(中級英文)」「外國語文(基礎日文)」都算基本能力", () => {
      const r = audit([
        lang("外國語文(中級英文)", 1), lang("外國語文(中級英文)", 2),
        lang("國文", 1), lang("國文", 2),
      ]);
      expect(r.earned("basic-skills")).toBe(8);
    });

    it("沒有課號的紀錄：同課名、同學期才算重複（重修只採計一筆）", () => {
      const failed = { ...lang("國文", 1), status: "failed" as const, score: 40 };
      const r = audit([failed, { ...lang("國文", 1), year: 112 }, lang("國文", 2)]);
      expect(r.earned("basic-skills")).toBe(4);
      const dup = audit([lang("國文", 1), lang("國文", 1)]);
      expect(dup.earned("basic-skills")).toBe(2);
    });

    it("只是課名裡有「英文」的選修不算（「英文閱讀(二):新聞英文閱讀-英-網」）", () => {
      const r = audit([{ ...lang("英文閱讀(二):新聞英文閱讀-英-網", 1), selectType: "elective" }]);
      expect(r.earned("basic-skills")).toBe(0);
    });
  });
});

let tmp: string;
let store: typeof import("@/lib/review/store");

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "aidit-review-plain-"));
  mkdirSync(join(tmp, "drafts"), { recursive: true });
  copyFileSync(DRAFT, join(tmp, "drafts", "fju-im-111.json"));
  vi.stubEnv("AIDIT_DATA_DIR", tmp);
  vi.resetModules();
  store = await import("@/lib/review/store");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("校對項目寫成白話", () => {
  it("不出現欄位名、英文代碼或 JSON", async () => {
    const view = (await store.loadDraft("fju-im-111"))!;
    const jargon = /courseList|courseNames|selectType|deptElective|anyPassed|countsToTotal|transferable|evidence|\bday\b|[{}"]/;
    for (const item of view.items) {
      const text = [item.label, item.extracted, item.question, ...(item.details ?? [])].join("\n");
      expect(text, item.id).not.toMatch(jargon);
    }
  });

  it("每一項都找得到原文，並附原始文件連結", async () => {
    const view = (await store.loadDraft("fju-im-111"))!;
    for (const item of view.items) {
      expect(item.context, item.id).toBeTruthy();
      expect(item.docUrl, item.id).toMatch(/^https?:\/\//);
    }
  });

  it("畢業最低學分有原文（以前是「本項無引用」）", async () => {
    const view = (await store.loadDraft("fju-im-111"))!;
    const meta = view.items.find((i) => i.id === "meta")!;
    expect(meta.context?.match).toContain("128");
    expect(meta.page).toBe(1);
  });

  it("課號旁邊附課名", async () => {
    const view = (await store.loadDraft("fju-im-111"))!;
    const required = view.items.find((i) => i.id === "category:dept-required")!;
    expect(required.details).toContain("微積分　02390　全學年（上下學期都要修）");
    expect(required.details?.every((d) => !d.includes("課名未知"))).toBe(true);
  });
});

describe("草稿改版：只重看改到的項目", () => {
  it("內容沒變的項目沿用通過，改到的項目要重新校對", async () => {
    const before = (await store.loadDraft("fju-im-111"))!;
    for (const item of before.items) {
      await store.saveDecision("fju-im-111", {
        itemId: item.id, status: "approved", reviewer: "測試者", decidedAt: new Date().toISOString(),
      });
    }

    // 改一個畢業條件的名稱
    const path = join(tmp, "drafts", "fju-im-111.json");
    const edited = JSON.parse(readFileSync(path, "utf8")) as { graduationChecks: { id: string; name: string }[] };
    edited.graduationChecks.find((g) => g.id === "programming-test")!.name = "程式語言能力檢定";
    writeFileSync(path, JSON.stringify(edited), "utf8");

    const after = (await store.loadDraft("fju-im-111"))!;
    expect(after.draftHash).not.toBe(before.draftHash);
    const kept = new Set(after.record.decisions.map((d) => d.itemId));
    expect(kept.has("check:programming-test")).toBe(false);
    expect(kept.size).toBe(after.items.length - 1);

    // 少了一項，不能鎖版
    const r = await store.lockPack("fju-im-111", "測試者");
    expect(r.ok).toBe(false);
  });
});

describe("體育屬於全人核心（校對第 2 項的修正）", () => {
  it("全人核心那一項寫出體育，原文引的是列出體育的那一行", async () => {
    const view = (await store.loadDraft("fju-im-111"))!;
    const core = view.items.find((i) => i.id === "category:holistic-core")!;
    expect(core.extracted).toContain("這一類要修滿 8 學分（另含「體育（四學期）」，0 學分");
    expect(core.context?.match).toContain("體育0學分");
  });

  it("畢業條件的 category 寫錯會被 schema 擋下", () => {
    const bad = structuredClone(draft) as { graduationChecks: { id: string; category?: string }[] };
    bad.graduationChecks.find((g) => g.id === "pe")!.category = "no-such-category";
    expect(zRulePack.safeParse(bad).success).toBe(false);
  });
});

describe("雜湊算規則資料，不算畫面文字", () => {
  it("只加補充說明：已通過的項目全部保留", async () => {
    const path = join(tmp, "drafts", "fju-im-111.json");
    copyFileSync(DRAFT, path);
    const before = (await store.loadDraft("fju-im-111"))!;
    for (const item of before.items) {
      await store.saveDecision("fju-im-111", {
        itemId: item.id, status: "approved", reviewer: "測試者", decidedAt: new Date().toISOString(),
      });
    }
    const edited = JSON.parse(readFileSync(path, "utf8")) as { _draft: { itemNotes: Record<string, string> } };
    edited._draft.itemNotes["meta"] = "新加的說明";
    writeFileSync(path, JSON.stringify(edited), "utf8");

    const after = (await store.loadDraft("fju-im-111"))!;
    expect(after.draftHash).not.toBe(before.draftHash);
    expect(after.record.decisions).toHaveLength(after.items.length);
    expect(after.items.find((i) => i.id === "meta")!.note).toBe("新加的說明");
  });

  it("改了課名對照：只有列那門課的類別要重看", async () => {
    const path = join(tmp, "drafts", "fju-im-111.json");
    const edited = JSON.parse(readFileSync(path, "utf8")) as { _draft: { courseTitles: Record<string, string> } };
    edited._draft.courseTitles["02390"] = "微積分（改）";
    writeFileSync(path, JSON.stringify(edited), "utf8");

    const after = (await store.loadDraft("fju-im-111"))!;
    const kept = new Set(after.record.decisions.map((d) => d.itemId));
    expect(kept.has("category:dept-required")).toBe(false);
    expect(kept.size).toBe(after.items.length - 1);
  });
});
