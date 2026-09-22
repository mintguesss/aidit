import type { StudentRecord } from "@/lib/types";
import type { Capabilities, CourseRecordProvider } from "./types";
import { fixture, type FixtureId } from "./fixtures";

/**
 * 合成資料 Provider。Demo 與評測都靠它（SPEC.md §4）。
 * 不讀取任何外部系統，也不接受真實學號。
 */
export class MockProvider implements CourseRecordProvider {
  readonly kind = "mock" as const;

  constructor(private readonly fixtureId: FixtureId = "demo") {}

  async fetch(input?: unknown): Promise<StudentRecord> {
    const id = pickFixtureId(input) ?? this.fixtureId;
    return structuredClone(fixture(id).record);
  }

  /**
   * capabilities() 描述的是「這個資料來源能不能提供該項資料」，
   * 不是「這份資料裡有沒有該項資料」。兩者混為一談會讓沒有抵免的學生
   * 被誤判為「資料來源未含抵免紀錄」，憑空多出一筆待確認事項。
   *
   * 合成來源完整模擬校務系統的匯出內容，因此除了刻意製造缺項的 fixture 之外，
   * 各項能力一律為 true。
   */
  capabilities(): Capabilities {
    const rec = fixture(this.fixtureId).record;
    return {
      hasWaivers: true,
      hasEnrollment: this.fixtureId !== "no-enrollment-data",
      hasCertPrograms: true,
      hasGraduationEvidence: !!rec.graduationEvidence,
    };
  }
}

function pickFixtureId(input: unknown): FixtureId | null {
  if (input && typeof input === "object" && "fixture" in input) {
    const v = (input as { fixture?: unknown }).fixture;
    if (typeof v === "string") return v as FixtureId;
  }
  return null;
}
