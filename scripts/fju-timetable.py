#!/usr/bin/env python3
"""輔大資管系每學期課表 PDF → 開課資料（docs/BACKEND.md §4）。

用法：
    python scripts/fju-timetable.py <課表.pdf> <課程規劃表.pdf> <輸出.json>

例：
    python scripts/fju-timetable.py .data/sources/fju-im/timetable-115-2.pdf \
        .data/sources/fju-im/courses-111.pdf docs/review/fju-offerings-115-2.json

課表是網格版面：哪門課在星期幾第幾節，靠的是儲存格的位置，純文字抽出來會丟掉。
這裡用 pdfplumber 偵測表格儲存格（含合併儲存格），以列標 D1…E0 的中心點判斷
一個儲存格跨了哪幾節，以欄標「星期一…星期五」判斷星期幾。

課表上**只有課名，沒有課號**。課號由課程規劃表的課名對照取得，對不到的不猜，
列在輸出的 unmatched 給人工處理 —— 猜錯課號會讓排課把課放進錯的類別。

輸出的 slotText 用輔大節次代號（例如「二 D2-D4」），系統的時段解析認得這種寫法。
"""

import json
import re
import sys
from collections import OrderedDict

import pdfplumber

ROW_LABELS = ["D0", "D1", "D2", "D3", "D4", "Dn", "DN", "D5", "D6", "D7", "D8",
              "E0", "E1", "E2", "E3", "E4"]
DAYS = {"星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4, "星期五": 5, "星期六": 6, "星期日": 7}
DAY_CHAR = {1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日"}

# 教室代號：LM503、BS440、LE4A、MD1002、ES601。
# 不用 \b：中文在 Python 正規表示式裡也算「字」，「實習LE4A」之間沒有字界，\b 會漏掉
ROOM_RE = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2}\d{1,4}[A-Z]?)(?![A-Za-z0-9])")
# 甲乙班前綴：「四甲專業倫理-企業倫理」
SECTION_PREFIX_RE = re.compile(r"^[一二三四][甲乙]")
CJK_RE = re.compile(r"[一-鿿]")
# 不排入開課資料的格子：沒有課可選，或不是課
SKIP_NAMES = ("導師時間",)
GROUP_HINT = "分組上課"
# 體育也是分組上課（各組課號、時段由學生自選），課表上只是標出全班共同的體育時段
GROUP_NAMES = ("體育",)


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s)


def plan_courses(plan_pdf: str):
    """從課程規劃表 PDF 的表格取出「課名 → (課號, 每學期學分)」。

    用表格抽取而不是版面文字：版面文字裡同一行會混進類別欄的字（「系選修課程」
    「課程」），曾經把 C++程式設計 的課號對到「系選修課程」—— 對錯課號會把課歸到
    錯的類別。表格抽取按欄位取值，課名、課號、學分各在自己的格子裡。

    每學期學分取八個學期欄（一上…四下）中第一個有值的：全學年課程總學分 6、
    上下各 3，單學期開出來的只有 3 學分。

    回傳 (對照表, 重複課號清單)。
    """
    out, codes_seen, dup = {}, {}, []
    with pdfplumber.open(plan_pdf) as pdf:
        for page in pdf.pages:
            for t in page.extract_tables():
                for row in t:
                    cells = [(c or "").replace("\n", " ").strip() for c in row]
                    ci = next((i for i, c in enumerate(cells) if re.fullmatch(r"\d{5}", c)), None)
                    if ci is None or ci == 0:
                        continue
                    # 課名：課號前一格，取開頭連續含中文的詞（後面是英文課名）
                    tokens = cells[ci - 1].split()
                    name_tokens = []
                    for tok in tokens:
                        if not CJK_RE.search(tok):
                            break
                        name_tokens.append(tok)
                    name = norm("".join(name_tokens))
                    if not name:
                        continue
                    nums = [int(c) for c in cells[ci + 2: ci + 12] if re.fullmatch(r"\d+", c)]
                    if not nums:
                        continue
                    total, per_term = nums[0], (nums[1] if len(nums) > 1 else nums[0])
                    code = cells[ci]
                    if code in codes_seen and codes_seen[code] != name:
                        dup.append(f"課號 {code} 同時對到「{codes_seen[code]}」與「{name}」")
                    codes_seen.setdefault(code, name)
                    out.setdefault(name, (code, per_term, total))
    return out, dup


def cell_text_lines(page, bbox):
    txt = page.within_bbox(bbox).extract_text() or ""
    return [l.strip() for l in txt.splitlines() if l.strip()]


def parse_cell(lines):
    """一個儲存格的文字 → 課名、必選修、教師、教室、標記。"""
    # 標記可能被斷成兩行（「(英語授」「課)」），先在整段文字上判斷，再把殘片去掉
    joined = "".join(lines)
    tags = [t for t in ("英語授課", "遠距授課") if t in joined]
    body = []
    for l in lines:
        for t in ("英語授課", "遠距授課"):
            l = l.replace(f"({t})", "").replace(f"（{t}）", "")
        if any(t in joined for t in ("英語授課", "遠距授課")) and re.fullmatch(r"[(（]?(英語授|遠距授)?課?[)）]?", l):
            continue
        if l.strip():
            body.append(l.strip())

    # 課名：開頭連續幾行含中文的；遇到純英文行（英文課名）就停
    name_parts = []
    i = 0
    while i < len(body) and CJK_RE.search(body[i]) and body[i] not in ("必", "選"):
        name_parts.append(body[i])
        i += 1
    name = "".join(name_parts)
    rooms = ROOM_RE.findall(name)
    name = ROOM_RE.sub("", name).strip()
    name = SECTION_PREFIX_RE.sub("", norm(name))

    rest = body[i:]
    kind = None
    for l in rest:
        if l in ("必", "選"):
            kind = "required" if l == "必" else "elective"
    # 教師：英文課名之後、只含中文（與頓號、班別）的那一行。課表沒標必選修時也找得到
    teacher = None
    for l in rest:
        if l in ("必", "選") or ROOM_RE.fullmatch(l) or not CJK_RE.search(l):
            continue
        if re.fullmatch(r"[一-鿿、\-\s]+", l):
            teacher = l
    for l in rest:
        rooms += ROOM_RE.findall(l)
    return {
        "name": name,
        "kind": kind,
        "teacher": teacher,
        "rooms": sorted(set(rooms)),
        "tags": sorted(set(tags)),
        "isLab": name.endswith("實習") or "Practical class" in " ".join(lines),
        "isGroup": GROUP_HINT in " ".join(lines) or name in GROUP_NAMES,
    }


def periods_to_codes(idxs):
    order = ["D0", "D1", "D2", "D3", "D4", "DN", "D5", "D6", "D7", "D8", "E0", "E1", "E2", "E3", "E4"]
    return [order[i] for i in idxs]


def slot_text(day, idxs):
    """連續的節次寫成區間；不連續就分段。內部編號連續＝輔大代碼連續（見 periods-fju.ts）。"""
    codes = periods_to_codes(sorted(idxs))
    runs, start, prev = [], None, None
    for i in sorted(idxs):
        if start is None:
            start = prev = i
        elif i == prev + 1:
            prev = i
        else:
            runs.append((start, prev))
            start = prev = i
    runs.append((start, prev))
    order = ["D0", "D1", "D2", "D3", "D4", "DN", "D5", "D6", "D7", "D8", "E0", "E1", "E2", "E3", "E4"]
    parts = [order[a] if a == b else f"{order[a]}-{order[b]}" for a, b in runs]
    return f"{DAY_CHAR[day]} {','.join(parts)}"


def extract(pdf_path):
    label_to_index = {"D0": 0, "D1": 1, "D2": 2, "D3": 3, "D4": 4, "Dn": 5, "DN": 5,
                      "D5": 6, "D6": 7, "D7": 8, "D8": 9, "E0": 10, "E1": 11, "E2": 12, "E3": 13, "E4": 14}
    cells_out = []
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            words = page.extract_words()
            title = " ".join(w["text"] for w in words if w["top"] < 120)
            klass = re.search(r"(資[一二三四][甲乙]{1,2})", title)
            klass = klass.group(1) if klass else f"第{pno}頁"

            rows = {}
            for w in words:
                if w["text"] in label_to_index and w["x0"] < 140:
                    rows[label_to_index[w["text"]]] = (w["top"] + w["bottom"]) / 2
            cols = sorted(((w["x0"] + w["x1"]) / 2, DAYS[w["text"]]) for w in words if w["text"] in DAYS)
            if not rows or not cols:
                continue
            # 欄界：相鄰欄標中心的中點
            bounds = []
            for k, (cx, day) in enumerate(cols):
                left = (cols[k - 1][0] + cx) / 2 if k > 0 else cx - (cols[1][0] - cx) / 2
                right = (cx + cols[k + 1][0]) / 2 if k + 1 < len(cols) else cx + (cx - cols[k - 1][0]) / 2
                bounds.append((left, right, day))

            table = max(page.find_tables(), key=lambda t: len(t.cells))
            for c in table.cells:
                x0, top, x1, bottom = c
                cx = (x0 + x1) / 2
                day = next((d for l, r, d in bounds if l <= cx < r), None)
                idxs = sorted(i for i, cy in rows.items() if top <= cy <= bottom)
                if day is None or not idxs:
                    continue
                lines = cell_text_lines(page, c)
                if not lines or lines[0] in label_to_index or lines[0] in DAYS:
                    continue
                info = parse_cell(lines)
                if not info["name"]:
                    continue
                info.update({"class": klass, "page": pno, "day": day, "periods": idxs})
                cells_out.append(info)
    return cells_out


def main():
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    pdf_path, plan_pdf, out_path = sys.argv[1:]
    plan, dup_codes = plan_courses(plan_pdf)
    cells = extract(pdf_path)

    issues = list(dup_codes)
    lectures = [c for c in cells if not c["isLab"] and not c["isGroup"] and c["name"] not in SKIP_NAMES]
    labs = [c for c in cells if c["isLab"]]
    groups = sorted({c["name"] for c in cells if c["isGroup"]})

    # 同一門課出現在好幾個年級的課表上（同時段、同教師、同教室）是同一班，合併
    offerings = OrderedDict()
    for c in lectures:
        key = (norm(c["name"]), c["teacher"], tuple(c["rooms"]), c["day"], tuple(c["periods"]))
        if key not in offerings:
            offerings[key] = {**c, "classes": [c["class"]], "slots": [(c["day"], c["periods"])]}
        else:
            offerings[key]["classes"].append(c["class"])

    # 實習併回主課：同一個班級課表上、課名去掉「實習」的那門課
    for lab in labs:
        parent_name = norm(lab["name"]).removesuffix("實習")
        parent = next((o for o in offerings.values()
                       if norm(o["name"]) == parent_name and lab["class"] in o["classes"]), None)
        if parent is None:
            issues.append(f"{lab['class']}「{lab['name']}」找不到主課，未併入")
            continue
        parent["slots"].append((lab["day"], lab["periods"]))

    out = []
    unmatched = []
    for o in offerings.values():
        n = norm(o["name"])
        hit = plan.get(n)
        via = "課名"
        if hit is None and "英語授課" in o["tags"]:
            hit = plan.get(n + "-英")
            via = "課名＋「-英」"
        if hit is None:
            unmatched.append(o["name"])
        if o["kind"] is None:
            issues.append(f"「{o['name']}」課表上沒有標必修或選修")
        if o["teacher"] in (None, "教師未定"):
            issues.append(f"「{o['name']}」（{'、'.join(o['classes'])}）教師未定")
        slot_texts = [slot_text(d, p) for d, p in o["slots"]]
        out.append({
            "code": hit[0] if hit else None,
            "codeVia": via if hit else None,
            "name": o["name"],
            # 本學期開出的學分；全學年課程是總學分的一半
            "credits": hit[1] if hit else None,
            "totalCredits": hit[2] if hit else None,
            "kind": o["kind"],
            "teacher": o["teacher"],
            "rooms": o["rooms"],
            "tags": o["tags"],
            "classes": o["classes"],
            "slotText": " / ".join(slot_texts),
        })

    # 同一課號有多個時段＝甲乙分班，各自是一個開課班級
    by_code = {}
    for o in out:
        if o["code"]:
            by_code.setdefault(o["code"], []).append(o)
    for code, lst in by_code.items():
        for k, o in enumerate(sorted(lst, key=lambda x: x["classes"][0]), start=1):
            o["section"] = k if len(lst) > 1 else None

    result = {
        "source": pdf_path,
        "offerings": out,
        "unmatched": sorted(set(unmatched)),
        "groupCourses": groups,
        "issues": issues,
    }
    json.dump(result, open(out_path, "w", encoding="utf8"), ensure_ascii=False, indent=2)
    print(f"開課班級 {len(out)}；對到課號 {sum(1 for o in out if o['code'])}；"
          f"對不到 {len(result['unmatched'])}；分組上課 {len(groups)}；問題 {len(issues)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
