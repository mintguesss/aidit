#!/usr/bin/env python3
"""課程規劃表 PDF → 分段文字（BACKEND.md §2 的第一步）。

刻意保留頁碼與版面順序：citation.locator 要寫得出「第 4 頁附註 3」，
而 citation.quote 必須是可回查的原文，兩者都依賴這一步不丟資訊。

用法：
    pip install pdfplumber
    python scripts/pdf-to-segments.py plan.pdf plan-im-111 "111 學年度資訊管理學系課程規劃表" \
        > .data/segments/plan-im-111.json

輸出同時供兩個用途：
  1. scripts/extract-rulepack.ts 的輸入
  2. src/lib/rules/corpus/<docId>.txt 的來源（citation.verify 的比對對象）
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2

    path, doc_id, title = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        import pdfplumber
    except ImportError:
        print("請先安裝 pdfplumber：pip install pdfplumber", file=sys.stderr)
        return 1

    pages = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            # layout=True 保留欄位對齊，科目表才不會被壓成一行
            text = page.extract_text(layout=True) or ""
            tables = []
            for t in page.extract_tables() or []:
                tables.append([[cell or "" for cell in row] for row in t])
            pages.append({"page": i, "text": text, "tables": tables})

    json.dump(
        {"docId": doc_id, "title": title, "source": path, "pages": pages},
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
