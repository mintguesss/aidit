"""
競賽文件 Markdown → Word（docs/competition/*.md → docs/competition/word/*.docx）。

Markdown 是原稿（放在 git 裡比對差異）；Word 版給團隊直接改、貼進簡報。
支援這批文件用到的語法：標題、段落、項目／編號清單（含巢狀）、核取方塊、表格、
粗體、行內程式碼、連結、刪除線、水平線。

用法：python scripts/competition-docx.py
"""

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_BREAK
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "competition"
OUT = SRC / "word"
FONT = "Microsoft JhengHei"
MONO = "Consolas"

INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))")


def set_font(run, name=FONT, size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT if name == MONO else name)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def add_inline(par, text, size=None, bold=False):
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            set_font(par.add_run(part[2:-2]), size=size, bold=True)
        elif part.startswith("`") and part.endswith("`"):
            set_font(par.add_run(part[1:-1]), name=MONO, size=size, color="22456E")
        elif part.startswith("~~") and part.endswith("~~"):
            r = par.add_run(part[2:-2])
            r.font.strike = True
            set_font(r, size=size)
        elif part.startswith("["):
            m = re.match(r"\[([^\]]+)\]\(([^)]+)\)", part)
            label, url = m.group(1), m.group(2)
            # 指向同資料夾 .md 的連結改指 Word 檔名；外部網址附在後面
            if url.endswith(".md"):
                set_font(par.add_run(label), size=size, bold=bold)
            else:
                set_font(par.add_run(label), size=size, bold=bold)
                set_font(par.add_run(f"（{url}）"), size=size and size - 1, color="666666")
        else:
            # 【待補】【待決定】之類標成紅色，改的人一眼看得到
            for seg in re.split(r"(【[^】]*】)", part):
                if not seg:
                    continue
                r = par.add_run(seg)
                set_font(r, size=size, bold=bold, color="B42318" if seg.startswith("【") else None)


def add_table(doc, rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    header, body = cells[0], [r for r in cells[2:]]
    t = doc.add_table(rows=1 + len(body), cols=len(header))
    t.style = "Table Grid"
    for i, h in enumerate(header):
        p = t.rows[0].cells[i].paragraphs[0]
        add_inline(p, h, size=10, bold=True)
    for ri, r in enumerate(body, start=1):
        for ci in range(len(header)):
            p = t.rows[ri].cells[ci].paragraphs[0]
            add_inline(p, r[ci] if ci < len(r) else "", size=10)
    doc.add_paragraph()


def convert(md: Path, out: Path):
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = FONT
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(11)

    lines = md.read_text(encoding="utf8").splitlines()
    i = 0
    para_buf: list[str] = []

    def flush():
        nonlocal para_buf
        if para_buf:
            add_inline(doc.add_paragraph(), "".join(x.strip() for x in para_buf))
            para_buf = []

    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            flush()
            i += 1
            continue
        if s.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            add_table(doc, rows)
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            flush()
            h = doc.add_heading(level=len(m.group(1)))
            add_inline(h, m.group(2))
            for r in h.runs:
                r.font.name = FONT
                r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
            i += 1
            continue
        if s == "---":
            flush()
            doc.add_paragraph().add_run().add_break(WD_BREAK.LINE)
            i += 1
            continue
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(\[[ x]\]\s+)?(.*)$", line)
        if m:
            flush()
            indent = len(m.group(1)) // 2
            numbered = m.group(2)[0].isdigit()
            style = ("List Number" if numbered else "List Bullet") + (f" {indent + 1}" if indent else "")
            try:
                p = doc.add_paragraph(style=style)
            except KeyError:
                p = doc.add_paragraph(style="List Number" if numbered else "List Bullet")
            text = m.group(4)
            if m.group(3):
                text = ("☑ " if "x" in m.group(3) else "☐ ") + text
            # 清單項目接續行（縮排、非新項目）併進同一項
            i += 1
            while i < len(lines) and lines[i].startswith("  ") and lines[i].strip() and not re.match(r"^\s*([-*]|\d+\.)\s", lines[i]) and not lines[i].strip().startswith("|"):
                text += lines[i].strip()
                i += 1
            add_inline(p, text)
            continue
        para_buf.append(line)
        i += 1
    flush()
    doc.save(out)


def main():
    OUT.mkdir(exist_ok=True)
    for md in sorted(SRC.glob("*.md")):
        out = OUT / (("00-總覽" if md.stem == "README" else md.stem) + ".docx")
        convert(md, out)
        print(f"{md.name} → word/{out.name}")


if __name__ == "__main__":
    sys.exit(main())
