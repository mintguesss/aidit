#!/usr/bin/env python3
"""從輔大學生資訊平台（sis.fju.edu.tw）的公開課程查詢抓開課資料。

用法：
    python scripts/fju-sis-fetch.py 115 1            # 預設單位：資管系＋全人、基本能力、通識、軍訓
    python scripts/fju-sis-fetch.py 115 1 74 PT      # 只抓指定單位

原始回應存到 .data/sources/fju-sis/<學年>-<學期>/<單位>.json（不進 repo），
再用 scripts/fju-sis-offerings.py 轉成系統的開課資料格式。

來源與禮節：
- 課程查詢頁（/couSearch/basicInfo）不需登入；前端呼叫的是
  travellerlink.fju.edu.tw/FjuCourse/api/CourseStudent/CourseStudentQueryByBasics。
  兩台主機都沒有 robots.txt（2026-10-02 查過）。
- 每次請求間隔 2 秒、一次一個單位，只抓需要的學期和單位。
- User-Agent 只寫專案網址，**不放任何個人的聯絡資料**。
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://travellerlink.fju.edu.tw/FjuCourse/api"
UA = "AiditCourseFetcher/0.1 (+https://aidit-weld.vercel.app/about)"
DELAY = 2.0
PAGE = 100

# 資管系，以及跟畢業規定有關的全校性課程單位（代碼來自 /Common/DptByDayNgt）
DEFAULT_UNITS = [
    "74",                    # 資訊管理學系
    "IT", "LT", "ET", "AT",  # 全人核心：大學入門、人生哲學、專業倫理、體育
    "CT", "FT",              # 基本能力：國文、外國語文
    "PT", "NT", "ST", "DT",  # 通識：人文藝術、自然科技、社會科學、永續素養
    "YT",                    # 軍訓
]


def get(path: str, params: dict) -> dict:
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://sis.fju.edu.tw/"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_unit(hy: int, ht: int, unit: str) -> list:
    rows, page = [], 1
    while True:
        d = get("/CourseStudent/CourseStudentQueryByBasics", {
            "Hy": hy, "Ht": ht, "ScoTyp": 100, "DayNgt": "D", "DptNo": unit, "lcid": 1028,
            "pageNumber": page, "pageSize": PAGE, "rowsPerPage": PAGE, "sortBy": "", "descending": "false",
        })
        res = d.get("result") or {}
        batch = res.get("result") or []
        if not isinstance(batch, list):
            batch = []
        rows.extend(batch)
        total_pages = res.get("totalPages") or 0
        print(f"  {unit} 第 {page}/{total_pages} 頁：{len(batch)} 筆", file=sys.stderr)
        if page >= total_pages or not batch:
            return rows
        page += 1
        time.sleep(DELAY)


def main():
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    hy, ht = int(sys.argv[1]), int(sys.argv[2])
    units = sys.argv[3:] or DEFAULT_UNITS
    out = Path(".data/sources/fju-sis") / f"{hy}-{ht}"
    out.mkdir(parents=True, exist_ok=True)

    fetched_at = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    for i, unit in enumerate(units):
        if i:
            time.sleep(DELAY)
        rows = fetch_unit(hy, ht, unit)
        (out / f"{unit}.json").write_text(
            json.dumps({"hy": hy, "ht": ht, "unit": unit, "fetchedAt": fetched_at, "rows": rows}, ensure_ascii=False),
            encoding="utf8",
        )
        print(f"{unit}：{len(rows)} 筆", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
