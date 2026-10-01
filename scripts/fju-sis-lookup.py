#!/usr/bin/env python3
"""用「學期＋課名」到輔大課程查詢找課號、開課單位、通識領域。

輔大的成績單沒有課號（docs/TODO.md C4），引擎卻是用課號比對類別。這支把成績單上的
課名對回當學期的開課紀錄：

    python scripts/fju-sis-lookup.py <輸入.json> <輸出.json>

輸入：{"courses": [[學期, 選別, 課名, 學分], ...]}，學期寫成 "111-1"。
輸出：每一筆加上 code、unit（開課單位代碼，PT／NT／ST 等是通識領域）、yearLong（學年課）、
matches（候選數）。
對不到或對到好幾門不同課號的，code 留 null，**不猜**，列在訊息裡交給人工。

成績單與查詢系統的寫法差異（實際比對過一份 111 入學的成績單）：
- 成績單在課名後面加「-英」「-網」（英語授課、遠距），查詢系統的課名沒有
- 括號有全形、半形之分（「資訊系統專題（一）」對「資訊系統專題(一)」）
- 大小寫（「web前端設計」對「Web前端設計」）

與 fju-sis-fetch.py 相同的禮節：每次請求間隔 2 秒，User-Agent 只寫專案網址。
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://travellerlink.fju.edu.tw/FjuCourse/api"
UA = "AiditCourseFetcher/0.1 (+https://aidit-weld.vercel.app/about)"
DELAY = 2.0

FULL = str.maketrans("（）：", "():")


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s).translate(FULL).lower()


def strip_tags(name: str) -> str:
    """成績單加在課名後面的「-英」「-網」標記"""
    return re.sub(r"(-(英|網))+$", "", name)


def query(hy: int, ht: int, name: str, day_ngt: str = "D") -> list:
    params = {
        "Hy": hy, "Ht": ht, "ScoTyp": 100, "DayNgt": day_ngt, "CouCna": name, "lcid": 1028,
        "pageNumber": 1, "pageSize": 100, "rowsPerPage": 100, "sortBy": "", "descending": "false",
    }
    url = f"{API}/CourseStudent/CourseStudentQueryByBasics?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://sis.fju.edu.tw/"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r).get("result") or {}
    rows = res.get("result")
    return rows if isinstance(rows, list) else []


def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src = json.load(open(sys.argv[1], encoding="utf8"))
    out, cache, unresolved = [], {}, []
    for i, (term, kind, name, credits) in enumerate(src["courses"]):
        hy, ht = (int(x) for x in term.split("-"))
        base = strip_tags(name)
        key = (hy, ht, base)
        if key not in cache:
            # 日間部找不到就查其他學制：日間部學生可以跨部修進修部的通識（實例：電腦與課程學習）
            for day_ngt in ("D", "C", "G", "T"):
                if cache:
                    time.sleep(DELAY)
                cache[key] = [r for r in query(hy, ht, base, day_ngt) if norm(r["couCNa"]) == norm(base)]
                if cache[key]:
                    break
        rows = cache[key]
        codes = sorted({r["sbjNO"] for r in rows})
        # 同一門課可能好幾班、好幾個單位開；課號一樣就沒有歧義。開課單位取資管系的班（本系學生多半修那班），沒有就取第一班
        pick = next((r for r in rows if r["dptNO"] == "74"), rows[0] if rows else None)
        rec = {
            "term": term, "kind": kind, "name": name, "credits": credits,
            "code": codes[0] if len(codes) == 1 else None,
            "unit": pick["dptNO"] if pick and len(codes) == 1 else None,
            "officialName": pick["couCNa"] if pick else None,
            # 課程查詢系統標「學年」（term ≠ 0）：上下學期共用課號，是同一門課的上下兩半，不是重修
            "yearLong": bool(pick and pick["term"] != 0),
            "matches": len(codes),
        }
        if rec["code"] is None:
            unresolved.append(f"{term} {name}（候選課號 {codes or '無'}）")
        out.append(rec)
        print(f"{term} {name} → {rec['code']} {rec['unit']}", file=sys.stderr)

    json.dump({"courses": out}, open(sys.argv[2], "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(f"對到 {len(out) - len(unresolved)}／{len(out)} 筆；沒對到：{'、'.join(unresolved) or '無'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
