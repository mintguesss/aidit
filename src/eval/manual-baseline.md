# 基準 A：人工計算（待實測）

SPEC.md §10 要求的三組基準中，本組**必須由真人實測**，程式無法代勞。
在填入實測數字之前，評測報告會標示本組為未執行，不得在簡報中出現任何推估值。

## 做法

1. 印出 `src/lib/rules/corpus/plan-im-111.txt`（合成課程規劃表原文，
   真實 PDF 匯入後改用真實規劃表）。
2. 印出 `src/eval/golden/` 的合成修課紀錄。可用下列指令匯出成可讀清單：

   ```bash
   npx tsx -e "
   import { FIXTURES } from './src/lib/providers/fixtures';
   for (const f of FIXTURES) {
     console.log('====', f.id, f.title);
     for (const c of f.record.courses)
       console.log([c.year, c.term, c.code, c.name, c.credits, c.selectType, c.status].join('\t'));
   }"
   ```

3. 請 3–5 位同學各自對照規劃表計算「各類別未修學分」與「是否符合畢業條件」。
4. 每人每案記錄：**耗時（分鐘）**、**答案**、**是否放棄**。
5. 與 `src/eval/golden/cases.ts` 的標準答案比對，算出錯誤率。

## 記錄表

| 案例 | 受測者 | 耗時（分） | 未修學分（作答） | 標準答案 | 正確 | 備註 |
|---|---|---|---|---|---|---|
| demo | | | | 5 | | |
| plain | | | | 0 | | |
| overflow-no-transfer | | | | 9 | | |
| transfer-student | | | | （應判定為無法計算） | | |
| waiver-retired | | | | 0 | | |
| legacy-code | | | | 0 | | |
| double-major | | | | 0 | | |
| repeat-course | | | | 0 | | |
| cross-college | | | | 3 | | |
| domain-unmet-credits-ok | | | | 0（但通識領域未達） | | |
| no-enrollment-data | | | | 11 | | |

## 彙總（填完上表後計算）

- 平均耗時：____ 分／案
- 錯誤率：____%
- 放棄率：____%
- 最常見的錯誤類型：____

## 預期觀察（實測後刪除此節，改填實際發現）

依 BACKEND.md §1 的分析，人工計算最容易錯的是：

1. **超修流用**：看到總學分已達 128 就認為可以畢業，忽略自由選修超修不得流用
   （`overflow-no-transfer` 一案總學分 131，仍差 9 學分）
2. **學分歸屬**：同時符合多個類別的選修課該算哪一類，貪婪分配會產生假的未修
3. **重補修**：同一門課的多筆紀錄重複計算
4. **通識領域分布**：學分已足就當作滿足，忽略四大領域各需一門
