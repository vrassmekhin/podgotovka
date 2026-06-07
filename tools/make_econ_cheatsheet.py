#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Шпаргалка по «Экономической теории» — 54 вопроса, краткие тезисы.
Плотная сетка карточек на A4 (одна карточка = один вопрос), пунктир для разреза,
авто-подбор размера шрифта под содержимое карточки.
"""
import re, sys, json
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Frame, KeepInFrame
from reportlab.platypus.paragraph import Paragraph as P
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("DJ", FONT_DIR + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DJ-B", FONT_DIR + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFontFamily("DJ", normal="DJ", bold="DJ-B", italic="DJ", boldItalic="DJ-B")

ACCENT = HexColor("#1f7a5a")  # зелёный — под предмет «экономика»

# Плотная сетка: 3 колонки × 6 рядов = 18 карточек на лист (54 → 3 листа).
COLS, ROWS = 3, 6
MARGIN = 5 * mm
CARD_PAD = 2.2 * mm
PAGE_W, PAGE_H = A4
GRID_W, GRID_H = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN
CARD_W, CARD_H = GRID_W / COLS, GRID_H / ROWS


def clean(text):
    # убрать эмодзи и прочие символы вне базовых диапазонов (DejaVu их не содержит)
    text = (text or "")
    text = re.sub(r"[\U0001F000-\U0001FAFF←-⇿☀-➿️]", "", text)
    text = text.replace("ₑ", "*")  # равновесные P*/Q*
    return text


def markup(text):
    text = clean(text).strip()
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    out = []
    for b in re.split(r"\n\s*\n", text):
        lines = [l for l in b.split("\n") if l.strip()]
        para, lst = [], []
        for l in lines:
            if re.match(r"^\s*[-•]\s+", l):
                if para:
                    out.append(("p", "<br/>".join(para))); para = []
                lst.append(re.sub(r"^\s*[-•]\s+", "", l))
            else:
                if lst:
                    out += [("li", x) for x in lst]; lst = []
                para.append(l)
        if lst:
            out += [("li", x) for x in lst]
        if para:
            out.append(("p", "<br/>".join(para)))
    return out


def build(item, fs):
    lead = fs + 1.0
    h = ParagraphStyle("h", fontName="DJ-B", fontSize=fs + 0.6, leading=fs + 1.6,
                       textColor=ACCENT, spaceAfter=fs * 0.35)
    body = ParagraphStyle("b", fontName="DJ", fontSize=fs, leading=lead,
                          textColor=HexColor("#15201a"), alignment=TA_LEFT, spaceAfter=fs * 0.15)
    li = ParagraphStyle("li", parent=body, leftIndent=fs * 0.8, bulletIndent=fs * 0.1)
    fl = [P(clean(item["q"]), h)]
    for kind, t in markup(item["a"]):
        fl.append(P(("• " + t) if kind == "li" else t, li if kind == "li" else body))
    return fl


def fits(fl, w, h):
    tot = 0
    for f in fl:
        _, fh = f.wrap(w, h)
        tot += fh
        if tot > h:
            return False
    return tot <= h


def fit_font(item, w, h):
    lo, hi, best = 2.6, 7.0, 2.6
    for _ in range(18):
        mid = (lo + hi) / 2
        if fits(build(item, mid), w, h):
            best, lo = mid, mid
        else:
            hi = mid
    return best


def cut_guides(c):
    c.saveState()
    c.setStrokeColor(HexColor("#9aa3b2"))
    c.setLineWidth(0.4)
    c.setDash(2, 2)
    for i in range(COLS + 1):
        x = MARGIN + i * CARD_W
        c.line(x, MARGIN, x, PAGE_H - MARGIN)
    for j in range(ROWS + 1):
        y = MARGIN + j * CARD_H
        c.line(MARGIN, y, PAGE_W - MARGIN, y)
    c.restoreState()
    c.setDash()
    c.setFillColor(HexColor("#9aa3b2"))
    c.setFont("DJ", 5.5)
    c.drawString(MARGIN, PAGE_H - MARGIN + 2, "режьте по пунктиру")


def main():
    items = json.load(open("/tmp/econ.json", encoding="utf-8"))
    out_path = sys.argv[1] if len(sys.argv) > 1 else "Шпаргалка_Экономическая_теория.pdf"
    c = canvas.Canvas(out_path, pagesize=A4)
    c.setTitle("Шпаргалка — Экономическая теория (тезисы)")
    iw, ih = CARD_W - 2 * CARD_PAD, CARD_H - 2 * CARD_PAD
    per = COLS * ROWS
    for idx, item in enumerate(items):
        pos = idx % per
        if pos == 0:
            if idx > 0:
                c.showPage()
            cut_guides(c)
        col, row = pos % COLS, pos // COLS
        x0 = MARGIN + col * CARD_W
        y_top = PAGE_H - MARGIN - row * CARD_H
        fs = fit_font(item, iw, ih)
        kif = KeepInFrame(iw, ih, build(item, fs), mode="shrink")
        Frame(x0 + CARD_PAD, y_top - CARD_H + CARD_PAD, iw, ih,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0).addFromList([kif], c)
    c.showPage()
    c.save()
    print("PDF сохранён:", out_path, "| карточек:", len(items), "| на лист:", per)


if __name__ == "__main__":
    main()
