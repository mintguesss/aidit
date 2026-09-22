import { cmp } from "@/lib/util/text";

/**
 * 學分歸屬：這是一個指派問題（docs/BACKEND.md §1）。
 *
 * 一門課可能同時符合多個類別。貪婪指派會產生「假的未修」——
 * 例：修了 24 學分選修，系專選需 24、自由選修需 12，先塞自由選修就會顯示系專選未修 12，
 * 但換個分配即可滿足。這種錯誤會叫一個已能畢業的學生多讀一學期，是最不能犯的錯。
 *
 * 本檔為純函式，不得 import 任何 LLM client 或 I/O（CI 會掃描）。
 */

export type AssignKind = "earned" | "inProgress";

export type AssignableCourse = {
  /** 唯一鍵；重補修同一課號會有多筆，不得用 code 當鍵 */
  key: string;
  code: string;
  credits: number;
  year: number;
  term: 1 | 2 | "summer";
  kind: AssignKind;
  /** 候選類別 id 集合 */
  eligible: string[];
};

export type CategoryDemand = {
  id: string;
  required: number;
  /** 規則包中的顯示順序，作為最後一道決勝 */
  order: number;
};

export type Filled = { earned: number; inProgress: number };

export type AssignmentResult = {
  /** courseKey -> categoryId */
  byCourse: Map<string, string>;
  filled: Map<string, Filled>;
  /** Σ max(0, required - filled)，越小越好 */
  objective: number;
  method: "exact" | "relaxed";
  /** method === "relaxed" 時，以最大流鬆弛求得的目標值下界 */
  objectiveLowerBound?: number;
  nodesExplored: number;
  ambiguousCount: number;
};

/** 超過此門檻改用鬆弛解，並在 trace 標記為近似解 */
export const AMBIGUOUS_LIMIT = 16;
/** DFS 節點上限，防止病態輸入把請求拖死 */
const NODE_LIMIT = 400_000;

const termRank = (t: 1 | 2 | "summer") => (t === 1 ? 1 : t === 2 ? 2 : 3);

/**
 * 決勝規則（必須寫成測試）：
 *   同一份資料跑兩次必須得到完全相同的指派，
 *   否則「這門課被採計為系專業選修」這條會出現在依據裡的結論就站不住。
 *
 * a. 課程依 (學年度, 學期, 課號, key) 升冪指派
 * b. 候選類別依 (required 大者優先, order 小者優先, id 升冪) 嘗試
 */
function sortCourses(courses: AssignableCourse[]): AssignableCourse[] {
  return [...courses].sort(
    (a, b) =>
      a.year - b.year ||
      termRank(a.term) - termRank(b.term) ||
      cmp(a.code, b.code) ||
      cmp(a.key, b.key),
  );
}

function candidateOrder(ids: string[], demands: Map<string, CategoryDemand>): string[] {
  return [...ids].sort((x, y) => {
    const dx = demands.get(x)!;
    const dy = demands.get(y)!;
    return dy.required - dx.required || dx.order - dy.order || cmp(dx.id, dy.id);
  });
}

function emptyFilled(demands: CategoryDemand[]): Map<string, Filled> {
  return new Map(demands.map((d) => [d.id, { earned: 0, inProgress: 0 }]));
}

function add(filled: Map<string, Filled>, catId: string, c: AssignableCourse, sign: 1 | -1): void {
  const f = filled.get(catId)!;
  if (c.kind === "earned") f.earned += sign * c.credits;
  else f.inProgress += sign * c.credits;
}

function shortfall(filled: Map<string, Filled>, demands: CategoryDemand[]): number {
  let s = 0;
  for (const d of demands) {
    const f = filled.get(d.id)!;
    s += Math.max(0, d.required - f.earned - f.inProgress);
  }
  return s;
}

export function assign(courses: AssignableCourse[], demands: CategoryDemand[]): AssignmentResult {
  const demandMap = new Map(demands.map((d) => [d.id, d]));
  const filled = emptyFilled(demands);
  const byCourse = new Map<string, string>();

  const sorted = sortCourses(courses);

  // 1–2. forced：候選只有一個的直接指派，不進搜尋空間
  const ambiguous: AssignableCourse[] = [];
  for (const c of sorted) {
    const eligible = c.eligible.filter((id) => demandMap.has(id));
    if (eligible.length === 0) continue; // 不屬於任何類別：不計入（如停修、不及格）
    if (eligible.length === 1) {
      const only = eligible[0]!;
      byCourse.set(c.key, only);
      add(filled, only, c, 1);
    } else {
      ambiguous.push({ ...c, eligible });
    }
  }

  if (ambiguous.length === 0) {
    return {
      byCourse,
      filled,
      objective: shortfall(filled, demands),
      method: "exact",
      nodesExplored: 0,
      ambiguousCount: 0,
    };
  }

  // 3–4. 對 ambiguous 做 backtracking
  if (ambiguous.length > AMBIGUOUS_LIMIT) {
    return relaxed(ambiguous, demands, demandMap, filled, byCourse);
  }

  const candidates = ambiguous.map((c) => candidateOrder(c.eligible, demandMap));
  const suffixCredits = new Array<number>(ambiguous.length + 1).fill(0);
  for (let i = ambiguous.length - 1; i >= 0; i--) {
    suffixCredits[i] = suffixCredits[i + 1]! + ambiguous[i]!.credits;
  }

  let best = Number.POSITIVE_INFINITY;
  let bestAssign: string[] | null = null;
  const cur = new Array<string>(ambiguous.length);
  let nodes = 0;
  let hitLimit = false;

  const dfs = (i: number): void => {
    if (hitLimit) return;
    if (++nodes > NODE_LIMIT) {
      hitLimit = true;
      return;
    }
    const s = shortfall(filled, demands);
    // 剪枝：剩下的課全部塞進缺口，也追不上目前最佳解
    if (Math.max(0, s - suffixCredits[i]!) >= best) return;
    if (i === ambiguous.length) {
      // 嚴格小於才更新 —— 確保同分時保留 DFS 順序上第一個解（決勝穩定性）
      if (s < best) {
        best = s;
        bestAssign = [...cur];
      }
      return;
    }
    const course = ambiguous[i]!;
    for (const catId of candidates[i]!) {
      cur[i] = catId;
      add(filled, catId, course, 1);
      dfs(i + 1);
      add(filled, catId, course, -1);
      if (hitLimit) return;
    }
  };

  dfs(0);

  if (!bestAssign || hitLimit) {
    return relaxed(ambiguous, demands, demandMap, filled, byCourse, nodes);
  }

  ambiguous.forEach((c, i) => {
    const catId = bestAssign![i]!;
    byCourse.set(c.key, catId);
    add(filled, catId, c, 1);
  });

  return {
    byCourse,
    filled,
    objective: shortfall(filled, demands),
    method: "exact",
    nodesExplored: nodes,
    ambiguousCount: ambiguous.length,
  };
}

/**
 * 鬆弛解：ambiguous 過多或搜尋超限時使用。
 *
 * 做法：先以最大流求「課程可分割」情況下的最佳填充量，得到目標值下界；
 * 再用決勝規則下的貪婪法產生一組實際可行的指派（課程不可分割）。
 * 兩者一併回報，trace 上會標記為近似解。
 */
function relaxed(
  ambiguous: AssignableCourse[],
  demands: CategoryDemand[],
  demandMap: Map<string, CategoryDemand>,
  filled: Map<string, Filled>,
  byCourse: Map<string, string>,
  nodes = 0,
): AssignmentResult {
  const lowerBound = maxFlowShortfall(ambiguous, demands, filled);

  for (const c of ambiguous) {
    const order = candidateOrder(c.eligible, demandMap);
    // 缺口最大的類別優先；完全沒缺口時退回候選順序的第一個
    let pick = order[0]!;
    let bestNeed = -1;
    for (const id of order) {
      const d = demandMap.get(id)!;
      const f = filled.get(id)!;
      const need = d.required - f.earned - f.inProgress;
      if (need > bestNeed) {
        bestNeed = need;
        pick = id;
      }
    }
    byCourse.set(c.key, pick);
    add(filled, pick, c, 1);
  }

  return {
    byCourse,
    filled,
    objective: shortfall(filled, demands),
    method: "relaxed",
    objectiveLowerBound: lowerBound,
    nodesExplored: nodes,
    ambiguousCount: ambiguous.length,
  };
}

/**
 * 最大流鬆弛：允許課程學分被拆分到多個類別，求可達到的最大填充量。
 * 回傳對應的目標值（Σ 缺口）下界 —— 實際不可分割的最佳解不會優於它。
 */
function maxFlowShortfall(
  ambiguous: AssignableCourse[],
  demands: CategoryDemand[],
  filled: Map<string, Filled>,
): number {
  const need = new Map<string, number>();
  let totalNeed = 0;
  for (const d of demands) {
    const f = filled.get(d.id)!;
    const n = Math.max(0, d.required - f.earned - f.inProgress);
    need.set(d.id, n);
    totalNeed += n;
  }

  // 節點：0 = source, 1..m = 課程, m+1..m+k = 類別, 末端 = sink
  const m = ambiguous.length;
  const catIdx = new Map<string, number>();
  demands.forEach((d, i) => catIdx.set(d.id, m + 1 + i));
  const sink = m + 1 + demands.length;
  const n = sink + 1;

  const cap: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  ambiguous.forEach((c, i) => {
    cap[0]![i + 1] = c.credits;
    for (const id of c.eligible) {
      const j = catIdx.get(id);
      if (j !== undefined) cap[i + 1]![j] = c.credits;
    }
  });
  for (const d of demands) cap[catIdx.get(d.id)!]![sink] = need.get(d.id)!;

  let flow = 0;
  for (;;) {
    const prev = new Array<number>(n).fill(-1);
    prev[0] = 0;
    const queue = [0];
    while (queue.length > 0 && prev[sink] === -1) {
      const u = queue.shift()!;
      for (let v = 0; v < n; v++) {
        if (prev[v] === -1 && cap[u]![v]! > 0) {
          prev[v] = u;
          queue.push(v);
        }
      }
    }
    if (prev[sink] === -1) break;
    let bottleneck = Number.POSITIVE_INFINITY;
    for (let v = sink; v !== 0; v = prev[v]!) bottleneck = Math.min(bottleneck, cap[prev[v]!]![v]!);
    for (let v = sink; v !== 0; v = prev[v]!) {
      cap[prev[v]!]![v]! -= bottleneck;
      cap[v]![prev[v]!]! += bottleneck;
    }
    flow += bottleneck;
  }

  return totalNeed - flow;
}
