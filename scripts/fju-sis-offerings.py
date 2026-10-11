#!/usr/bin/env python3
"""輔大課程查詢的原始資料（fju-sis-fetch.py 的輸出）→ 系統的開課資料格式（RawOffering）。

用法：
    python scripts/fju-sis-offerings.py 115 1 docs/review/fju-im-111.draft.json \
        src/lib/offerings/data/fju-115-1.json

每一班可以採計的類別依規則包決定，不猜：
- 課號列在某一類的課號清單 → 那一類
- 課名符合某一類的課名規則（完全相同或開頭相同，見 lib/courses/names.ts）→ 那一類
- 通識單位（PT／NT／ST／DT）開的課 → 通識，並記下領域
- 本系（規則包的系所）開的選修 → 系專選、其他選修（扣掉規則包排除的課名）
- 其他單位開的課（外系、學程、TAICA）→ 有學分、對外系開放（外系名額 > 0、備註沒限本系）就收，
  類別依規則包的承接類別（輔大：選修課程），網站排課時依學生的規則包判斷
- 其他（0 學分的體育與軍訓等）不收，列在輸出訊息裡

修課人數只有上限（totNum），沒有已選人數 —— 未知不是 0，enrolled 不填。
單雙週（sda = S／D）寫進時段文字，單週與雙週的課不算衝堂（TODO H8）。
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

DAY = {"1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六", "7": "日"}

# 通識單位 → 規則包的領域名稱（PT／NT／ST 對應 111 規劃表的三大領域；DT 永續素養是之後新增的）
GENERAL_UNITS = {"PT": "人文與藝術", "NT": "自然與科技", "ST": "社會科學", "DT": "永續素養"}

# 開課單位 → （系所代碼, 學院代碼）。系所代碼要與規則包的 minDeptCredits.dept、修課紀錄的 offeringDept 一致。
# 物理學系分三個組開課（物理組 55、光電物理組 56、電子物理組 1R），本系專業選修三組都算
DEPT_UNITS = {
    "74": ("IM", "MGT"),   # 資訊管理學系
    "55": ("PH", "SCI"),   # 物理學系物理組
    "56": ("PH", "SCI"),   # 物理學系光電物理組
    "1R": ("PH", "SCI"),   # 物理學系電子物理組
    "SG": ("SG", "SCI"),   # 理工學院（院開課，如微積分-英）
}


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s)


def slot_text(row: dict) -> str:
    parts = []
    for s in row["seqList"]:
        day, section = s["couWek"].strip(), s["section"].strip()
        if not day or not section:
            continue
        # 單雙週（教務處節次說明：S 單週、D 雙週），寫成「二 D2(單)」，lib/solver/slots.ts 解析
        weeks = {"S": "(單)", "D": "(雙)"}.get(s["sda"].strip(), "")
        parts.append(f"{DAY.get(day, day)} {section}{weeks}")
    # 沒有固定上課時間（專題、實習）—— 不是「時段未知」，是本來就沒排
    return " / ".join(parts) if parts else "時間另訂"


def main():
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    hy, ht, pack_path, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
    pack = json.load(open(pack_path, encoding="utf8"))
    src = Path(".data/sources/fju-sis") / f"{hy}-{ht}"

    listed, name_rules, elective_cats, excluded, general_cat = {}, [], [], set(), None
    for cat in pack["categories"]:
        m = cat["match"]
        if m["type"] == "courseList":
            for code in m["codes"]:
                listed[code] = cat["id"]
        elif m["type"] == "courseNames":
            name_rules.append((cat["id"], [norm(n) for n in m.get("names", [])], [norm(p) for p in m.get("prefixes", [])]))
        elif m["type"] in ("deptElective", "anyPassed"):
            elective_cats.append(cat["id"])
            excluded |= {norm(n) for n in m.get("excludeNames", [])}
        elif m["type"] == "selectType" and m["value"] == "general":
            general_cat = cat["id"]
    # 規則包可能沒有「系專選」類別（輔大 111 v0.7 起改成選修課程底下的分項條件）
    major = next((c["id"] for c in pack["categories"] if c["match"]["type"] == "deptElective"), None)

    def by_name(name: str):
        n = norm(name)
        for cat_id, names, prefixes in name_rules:
            if n in names or any(n.startswith(p) for p in prefixes):
                return cat_id
        return None

    seen, out_rows, skipped = set(), [], Counter()
    sda = Counter()
    for f in sorted(src.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf8"))
        # 舊版抓取腳本寫成 +0800，JavaScript 的 Date 不一定認得，統一成 +08:00
        unit, fetched = d["unit"], re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", d["fetchedAt"])
        for r in d["rows"]:
            if r["avaNO"] in seen:  # 同一班出現在兩個單位（資管系保留的人生哲學、大學入門班）
                continue
            seen.add(r["avaNO"])
            code, name = r["sbjNO"], r["couCNa"].strip()
            domain = None
            if code in listed:
                category = [listed[code]]
            elif by_name(name):
                category = [by_name(name)]
            elif unit in GENERAL_UNITS and general_cat:
                category, domain = [general_cat], GENERAL_UNITS[unit]
            elif unit in DEPT_UNITS and DEPT_UNITS[unit][0] == pack["dept"] and r["reqSel"] == "S":
                category = [c for c in elective_cats if not (c == major and norm(name) in excluded)]
            elif not (unit in DEPT_UNITS and DEPT_UNITS[unit][0] == pack["dept"]) and r["credit"] > 0:
                # 外系的課只要對外系開放就能算選修（輔大：外系名額 outNum 為 0、或備註限本系的不收）。
                # TAICA 等跨校、學程的課一樣：使用者實際選過、採計為選修
                if r.get("outNum") == 0 or re.search(r"限本系|不開放外系|限.{0,6}系學生", r.get("avaNote") or ""):
                    skipped[f"{unit}（不開放外系）"] += 1
                    continue
                # 別系（對轉換用的規則包而言）開的課：一樣收進來，網站排課時依學生自己的規則包判斷類別。
                # 規則包本系沒列的必修、0 學分的導師時間照舊不收
                # 與網站即時判斷一致（lib/offerings 的 categoriesFor）：別系的課對這份規則包只算承接類別
                category = [c["id"] for c in pack["categories"] if c["match"]["type"] == "anyPassed"]
            else:
                skipped[f"{unit} {name}（{r['reqSelAbr']}，{r['credit']:g} 學分）"] += 1
                continue
            for s in r["seqList"]:
                sda[s["sda"]] += 1
            row = {
                "school": pack.get("school", "demo"),
                "code": code,
                "name": name,
                "credits": int(r["credit"]),
                # 選別：網站排課時依學生的規則包判斷可採計類別（TODO H10），category 只是轉換當時的參考
                "selectType": {"R": "required", "S": "elective", "G": "general"}.get(r["reqSel"], "elective"),
                "year": hy,
                "term": ht,
                "teacher": r["tchCNa"] or "未定",
                "slotText": slot_text(r),
                "dept": DEPT_UNITS[unit][0] if unit in DEPT_UNITS else unit,
                "college": DEPT_UNITS[unit][1] if unit in DEPT_UNITS else "FJU",
                "category": category,
                "capacity": r["totNum"] or None,
                "fetchedAt": fetched,
            }
            if domain:
                row["generalDomain"] = domain
            # 課綱頁要用的：學校大綱系統的編號（打開課綱頁時才去抓大綱）、教室、授課語言、課程標籤
            row["outline"] = {"id": r["jonCouSn"], "tchNo": r["tchNo"]}
            # 開課班級：甲乙班、依學院指定的國文外文、開給某一系的全人課（TODO C7）
            if (r.get("avaDptCNa") or "").strip():
                row["classGroup"] = r["avaDptCNa"].strip()
            rooms = sorted({s["romNO"].strip() for s in r["seqList"] if (s.get("romNO") or "").strip()})
            if rooms:
                row["rooms"] = rooms
            if r.get("teaLangCNa"):
                row["language"] = r["teaLangCNa"]
            tags = [c["couClassifyCna"] for c in (r.get("couClassifyList") or []) if c.get("couClassifyCna")]
            if tags:
                row["tags"] = tags
            # 本系必修規劃給哪個年級（開課班級「資管二甲」→ 2）。排課不會把大二的必修排給大一，
            # 學年課也不會只排到下半（大一上排到「統計學」下學期那一半）
            grade = re.match(r"(?:資管|光電|物理|電物)([一二三四])", r.get("avaDptCNa") or "")
            if unit in DEPT_UNITS and r["reqSel"] == "R" and grade:
                row["forGrade"] = "一二三四".index(grade.group(1)) + 1
            if row["capacity"] is None:
                del row["capacity"]
            out_rows.append(row)

    out_rows.sort(key=lambda x: (x["dept"], x["code"], x["slotText"]))
    Path(out).write_text(json.dumps(out_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(f"寫入 {len(out_rows)} 班（{len({r['code'] for r in out_rows})} 門課）→ {out}")
    print(f"單雙週：{dict(sda)}（S 單週、D 雙週）")
    print(f"未收 {sum(skipped.values())} 班：")
    for k, n in skipped.most_common(25):
        print(f"  {k} ×{n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
