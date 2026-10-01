#!/usr/bin/env python3
"""輔大開課資料（fju-timetable.py 的輸出）→ 系統的開課資料格式（RawOffering）。

用法：
    python scripts/fju-offerings-raw.py docs/review/fju-offerings-115-2.json \
        docs/review/fju-im-111.draft.json 115 2 src/lib/offerings/data/fju-115-2.json

每門課可採計的類別依規則包決定：課號列在某個類別的課號清單就歸那個類別；
其餘本系選修可算系專選或其他選修。**規則包校對後類別有改，要重跑這支。**

對不到課號的課不收：沒有課號，引擎就無法判斷它算哪個類別，排進課表只會誤導。
人數（capacity／enrolled）不填 —— 系上課表沒有，未知不是 0。
"""

import json
import re
import sys
from datetime import datetime, timezone, timedelta


def main():
    if len(sys.argv) != 6:
        print(__doc__, file=sys.stderr)
        return 2
    src, pack_path, year, term, out = sys.argv[1:]
    data = json.load(open(src, encoding="utf8"))
    pack = json.load(open(pack_path, encoding="utf8"))

    listed = {}
    for cat in pack["categories"]:
        if cat["match"]["type"] == "courseList":
            for code in cat["match"]["codes"]:
                listed[code] = cat["id"]
    elective_cats = [c["id"] for c in pack["categories"] if c["match"]["type"] in ("deptElective", "anyPassed")]
    # 系專選排除的課（規劃表畫在系選修框外的）只能算其他選修，見 schema 的 excludeNames
    norm = lambda s: re.sub(r"\s+", "", s)
    excluded = {norm(n): c["id"] for c in pack["categories"]
                if c["match"]["type"] == "deptElective" for n in c["match"].get("excludeNames", [])}

    fetched = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    raw, skipped = [], []
    for o in data["offerings"]:
        if not o["code"]:
            skipped.append(o["name"])
            continue
        if o["code"] in listed:
            category = [listed[o["code"]]]
        elif o["kind"] == "required":
            # 課表標必修、規則包卻沒列：不猜它屬於哪一類，交給人工
            skipped.append(f"{o['name']}（必修但規則包未列）")
            continue
        else:
            category = [c for c in elective_cats if excluded.get(norm(o["name"])) != c]
        raw.append({
            "school": pack.get("school", "demo"),
            "code": o["code"],
            "name": o["name"],
            "credits": o["credits"],
            "year": int(year),
            "term": int(term),
            "teacher": o["teacher"] or "未定",
            "slotText": o["slotText"],
            "dept": pack["dept"],
            "college": pack["college"],
            "category": category,
            "fetchedAt": fetched,
        })

    json.dump(raw, open(out, "w", encoding="utf8"), ensure_ascii=False, indent=2)
    print(f"寫入 {len(raw)} 筆；未收 {len(skipped)} 筆：{'、'.join(skipped) or '無'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
