import { describe, expect, it } from "vitest";
import { assign, type AssignableCourse, type CategoryDemand } from "@/lib/audit/assign";

/**
 * 指派問題的測試（docs/BACKEND.md §1、§10 第 2 條）。
 *
 * 「這門課被採計為系專業選修」本身是一條會出現在依據裡的結論；
 * 同一份資料跑兩次得到不同指派，整個可溯源的主張就垮了。
 */

const demands: CategoryDemand[] = [
  { id: "major-elective", required: 24, order: 5 },
  { id: "free-elective", required: 12, order: 6 },
];

function course(key: string, credits: number, eligible: string[], year = 113, term: 1 | 2 = 1): AssignableCourse {
  return { key, code: key, credits, year, term, kind: "earned", eligible };
}

describe("貪婪指派會產生假的未修", () => {
  it("24 學分選修應能同時滿足系專選 24 與自由選修 12 中的最佳配置", () => {
    // 系專選需 24、自由選修需 12；學生修了 24 學分「兩者皆可」的選修，
    // 另有 12 學分只能算自由選修。貪婪先塞自由選修會讓系專選看起來差 12。
    const courses = [
      ...Array.from({ length: 8 }, (_, i) => course(`IM40${10 + i}`, 3, ["major-elective", "free-elective"])),
      ...Array.from({ length: 4 }, (_, i) => course(`FN30${10 + i}`, 3, ["free-elective"])),
    ];
    const r = assign(courses, demands);
    expect(r.objective).toBe(0);
    expect(r.filled.get("major-elective")!.earned).toBe(24);
    expect(r.filled.get("free-elective")!.earned).toBe(12);
  });

  it("學分不足時回報真正的最小缺口，而不是分配造成的假缺口", () => {
    const courses = [
      ...Array.from({ length: 5 }, (_, i) => course(`IM40${10 + i}`, 3, ["major-elective", "free-elective"])),
      ...Array.from({ length: 4 }, (_, i) => course(`FN30${10 + i}`, 3, ["free-elective"])),
    ];
    const r = assign(courses, demands);
    // 系專選 15/24 缺 9，自由選修 12/12 滿足 → 最小缺口 9
    expect(r.objective).toBe(9);
    expect(r.filled.get("major-elective")!.earned).toBe(15);
    expect(r.filled.get("free-elective")!.earned).toBe(12);
  });
});

describe("決勝穩定性", () => {
  it("同一輸入跑 100 次，指派結果完全一致", () => {
    const courses = [
      ...Array.from({ length: 9 }, (_, i) => course(`IM40${10 + i}`, 3, ["major-elective", "free-elective"], 113, ((i % 2) + 1) as 1 | 2)),
      ...Array.from({ length: 3 }, (_, i) => course(`FN30${10 + i}`, 3, ["free-elective"])),
    ];
    const first = serialize(assign(courses, demands));
    for (let i = 0; i < 100; i++) {
      expect(serialize(assign(courses, demands))).toBe(first);
    }
  });

  it("輸入順序打亂後仍得到相同指派", () => {
    const courses = [
      course("IM4011", 3, ["major-elective", "free-elective"]),
      course("IM4012", 3, ["major-elective", "free-elective"]),
      course("IM4013", 3, ["major-elective", "free-elective"]),
      course("FN3011", 3, ["free-elective"]),
      course("FN3012", 3, ["free-elective"]),
    ];
    const base = serialize(assign(courses, demands));
    const shuffled = [...courses].reverse();
    expect(serialize(assign(shuffled, demands))).toBe(base);
  });
});

describe("鬆弛解", () => {
  it("ambiguous 超過上限時改用鬆弛解，並附上目標值下界", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      course(`IM4${String(100 + i)}`, 3, ["major-elective", "free-elective"]),
    );
    const r = assign(many, demands);
    expect(r.method).toBe("relaxed");
    expect(r.objectiveLowerBound).toBeDefined();
    // 60 學分足以填滿 24 + 12，下界應為 0
    expect(r.objectiveLowerBound).toBe(0);
  });
});

function serialize(r: ReturnType<typeof assign>): string {
  return JSON.stringify({
    byCourse: [...r.byCourse.entries()].sort(),
    filled: [...r.filled.entries()].sort(),
    objective: r.objective,
    method: r.method,
  });
}

describe("承接類別最後才塞", () => {
  // 輔大資管：系專選 10、其他選修 22。舊的決勝規則「需求大者優先」會把本系選修
  // 先塞進其他選修 —— 總缺口一樣，但系專選顯示 0/10，學生會以為還要多修 10 學分本系的課。
  const fju: CategoryDemand[] = [
    { id: "major-elective", required: 10, order: 5 },
    { id: "free-elective", required: 22, order: 6, catchAll: true },
  ];

  it("總缺口打平時，本系選修先算系專選", () => {
    const r = assign([course("24501", 3, ["major-elective", "free-elective"])], fju);
    expect(r.filled.get("major-elective")!.earned).toBe(3);
    expect(r.filled.get("free-elective")!.earned).toBe(0);
  });

  it("承接類別排最後不能犧牲總缺口：系專選不超收，學分不浪費", () => {
    // 15 學分全塞系專選會超收 5 學分（缺口 22）；塞到 12 也浪費 2（缺口 19）。
    // 最佳是系專選 9、其他選修 6：缺口 1 + 16 = 17
    const courses = Array.from({ length: 5 }, (_, i) => course(`2450${i}`, 3, ["major-elective", "free-elective"]));
    const r = assign(courses, fju);
    expect(r.objective).toBe(17);
    expect(r.filled.get("major-elective")!.earned).toBe(9);
    expect(r.filled.get("free-elective")!.earned).toBe(6);
  });

  it("沒標 catchAll 時維持原本的決勝（需求大者優先），合成資料的結果不變", () => {
    const plain = fju.map(({ catchAll: _, ...d }) => d);
    const r = assign([course("24501", 3, ["major-elective", "free-elective"])], plain);
    expect(r.filled.get("free-elective")!.earned).toBe(3);
  });
});
