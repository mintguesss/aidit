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

describe("A6：系選修框外的課不算系專選", () => {
  const pack = zRulePack.parse(draft);

  function audit(courses: CourseRecord[]) {
    const record: StudentRecord = {
      student: { id: "S-TEST", dept: "IM", admissionYear: 111, actualAdmissionYear: 111, status: "enrolled", program: "day" },
      courses,
      fetchedAt: "2026-10-01T00:00:00Z",
      source: "mock",
    };
    const a = auditCredits({ record, pack, traceId: "t", currentTerm: "115-1", nextTerm: "115-2" });
    expect(a.countable + a.inProgress + a.unmet).toBe(a.minCredits);
    return (id: string) => a.categories.find((x) => x.id === id)!.earned;
  }

  const elective = (code: string, name: string, credits: number): CourseRecord => ({
    code, name, credits, year: 114, term: 1, status: "passed", selectType: "elective", score: 80,
  });

  it("「組織學習與社會探究」算其他選修，不算系專選", () => {
    const earned = audit([elective("19664", "組織學習與社會探究", 2)]);
    expect(earned("major-elective")).toBe(0);
    expect(earned("free-elective")).toBe(2);
  });

  it("課名比對忽略空白：「組織領導與 社會創新實務」一樣排除", () => {
    const earned = audit([elective("19663", "組織領導與 社會創新實務", 2)]);
    expect(earned("major-elective")).toBe(0);
  });

  it("同課號（19664）的「資訊系統專案管理」不受影響，仍算系專選 —— 這就是用課名不用課號的原因", () => {
    const earned = audit([elective("19664", "資訊系統專案管理", 3)]);
    expect(earned("major-elective")).toBe(3);
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
