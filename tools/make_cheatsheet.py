#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Генерация PDF-шпаргалки по билетам.
Каждый билет (оба вопроса + ответы) — на одной мини-карточке.
Несколько карточек на листе A4, между ними — пунктирные линии для разреза.
Размер шрифта в каждой карточке подбирается автоматически, чтобы текст
поместился целиком.
"""
import json, re, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Frame, KeepInFrame
from reportlab.platypus.paragraph import Paragraph as P
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("DJ", FONT_DIR + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DJ-B", FONT_DIR + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFontFamily("DJ", normal="DJ", bold="DJ-B", italic="DJ", boldItalic="DJ-B")

ACCENT = HexColor("#4f6ef7")
MUTED = HexColor("#555555")

# ---------- параметры сетки ----------
COLS, ROWS = 2, 3          # карточек на лист A4 (2×3 = 6, ~99×92 мм — для кармана)
MARGIN = 6 * mm            # внешнее поле листа
CARD_PAD = 3.0 * mm        # внутренний отступ карточки

PAGE_W, PAGE_H = A4
GRID_W = PAGE_W - 2 * MARGIN
GRID_H = PAGE_H - 2 * MARGIN
CARD_W = GRID_W / COLS
CARD_H = GRID_H / ROWS


def markup_to_html(text):
    """Преобразует мини-разметку ответа в разметку reportlab Paragraph."""
    text = (text or "").strip()
    text = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    # вернуть жирный (после экранирования)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    blocks = re.split(r"\n\s*\n", text)
    out = []
    for b in blocks:
        lines = [l for l in b.split("\n")]
        if all(re.match(r"^\s*[-•]\s+", l) or not l.strip() for l in lines) and any(l.strip() for l in lines):
            for l in lines:
                if l.strip():
                    out.append("• " + re.sub(r"^\s*[-•]\s+", "", l))
        else:
            out.append(b.replace("\n", "<br/>"))
    return out


def build_flowables(ticket, fs):
    """Создаёт список Paragraph для карточки при размере шрифта fs."""
    lead = fs + 1.2
    h_title = ParagraphStyle("t", fontName="DJ-B", fontSize=fs + 1.5, leading=fs + 2.5,
                             textColor=ACCENT, spaceAfter=fs * 0.4)
    h_q = ParagraphStyle("q", fontName="DJ-B", fontSize=fs + 0.3, leading=lead,
                         textColor=black, spaceBefore=fs * 0.5, spaceAfter=fs * 0.2)
    body = ParagraphStyle("b", fontName="DJ", fontSize=fs, leading=lead,
                          textColor=HexColor("#1c2433"), alignment=TA_LEFT,
                          spaceAfter=fs * 0.25)
    fl = [P(ticket["title"], h_title)]
    for i, q in enumerate(ticket["questions"], 1):
        fl.append(P("%d. %s" % (i, q["q"]), h_q))
        for para in markup_to_html(q["a"]):
            fl.append(P(para, body))
    return fl


def fits(flowables, w, h):
    """Проверяет, помещаются ли flowables в рамку w×h."""
    total = 0
    for f in flowables:
        _, fh = f.wrap(w, h)
        total += fh
        if total > h:
            return False
    return total <= h


def fit_font(ticket, w, h):
    """Подбирает максимальный размер шрифта, при котором всё помещается."""
    lo, hi = 3.0, 7.0
    best = lo
    # бинарный поиск по размеру шрифта
    for _ in range(18):
        mid = (lo + hi) / 2
        if fits(build_flowables(ticket, mid), w, h):
            best = mid
            lo = mid
        else:
            hi = mid
    return best


def draw_cut_guides(c):
    """Рисует пунктирные линии разреза по сетке + уголки-метки."""
    c.saveState()
    c.setStrokeColor(HexColor("#9aa3b2"))
    c.setLineWidth(0.4)
    c.setDash(2, 2)
    # вертикальные линии между колонками (и по краям сетки)
    for i in range(COLS + 1):
        x = MARGIN + i * CARD_W
        c.line(x, MARGIN, x, PAGE_H - MARGIN)
    # горизонтальные линии между рядами
    for j in range(ROWS + 1):
        y = MARGIN + j * CARD_H
        c.line(MARGIN, y, PAGE_W - MARGIN, y)
    c.restoreState()
    # значок ножниц-подсказки сверху
    c.setDash()
    c.setFillColor(HexColor("#9aa3b2"))
    c.setFont("DJ", 6)
    c.drawString(MARGIN, PAGE_H - MARGIN + 2, "✂ режьте по пунктиру")


def main():
    data = json.load(open("/tmp/history.json", encoding="utf-8"))
    tickets = data["tickets"]
    out_path = sys.argv[1] if len(sys.argv) > 1 else "Shpargalka_Istoriya_Rossii.pdf"

    c = canvas.Canvas(out_path, pagesize=A4)
    c.setTitle("Шпаргалка — История России (билеты)")

    inner_w = CARD_W - 2 * CARD_PAD
    inner_h = CARD_H - 2 * CARD_PAD
    per_page = COLS * ROWS

    for idx, ticket in enumerate(tickets):
        pos = idx % per_page
        if pos == 0:
            if idx > 0:
                c.showPage()
            draw_cut_guides(c)
        col = pos % COLS
        row = pos // COLS
        # координаты левого-нижнего угла карточки (reportlab: снизу вверх)
        x0 = MARGIN + col * CARD_W
        y_top = PAGE_H - MARGIN - row * CARD_H
        # рамка содержимого
        fx = x0 + CARD_PAD
        fy = y_top - CARD_H + CARD_PAD

        fs = fit_font(ticket, inner_w, inner_h)
        flowables = build_flowables(ticket, fs)
        frame = Frame(fx, fy, inner_w, inner_h, leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0, showBoundary=0)
        # KeepInFrame на всякий случай ужмёт, если осталась погрешность
        kif = KeepInFrame(inner_w, inner_h, flowables, mode="shrink")
        frame.addFromList([kif], c)

    c.showPage()
    c.save()
    print("PDF сохранён:", out_path, "| билетов:", len(tickets),
          "| карточек на лист:", per_page)


if __name__ == "__main__":
    main()
