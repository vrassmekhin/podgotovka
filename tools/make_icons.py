#!/usr/bin/env python3
"""Генерирует иконки приложения (PNG) без внешних зависимостей.
Рисует фирменный градиент и стилизованную «шапку выпускника»."""
import struct, zlib, math, os

BRAND_TOP = (109, 134, 255)   # #6d86ff
BRAND_BOT = (79, 110, 247)    # #4f6ef7
WHITE = (255, 255, 255)

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside

def dist_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)

def render(size, ss=3):
    S = size * ss
    # буфер RGBA
    buf = [[(0, 0, 0, 0)] * S for _ in range(S)]
    radius = S * 0.22
    # геометрия шапки (нормализовано 0..1)
    board = [(0.50, 0.30), (0.80, 0.44), (0.50, 0.58), (0.20, 0.44)]
    band = [(0.355, 0.475), (0.645, 0.475), (0.595, 0.66), (0.405, 0.66)]
    board_px = [(px * S, py * S) for px, py in board]
    band_px = [(px * S, py * S) for px, py in band]
    # кисточка (тассел)
    tx0, ty0 = 0.80 * S, 0.44 * S
    tx1, ty1 = 0.83 * S, 0.70 * S
    ball = (0.83 * S, 0.73 * S, 0.028 * S)

    for y in range(S):
        for x in range(S):
            # скруглённый прямоугольник-фон
            inset = 0
            cx = min(max(x, radius), S - radius)
            cy = min(max(y, radius), S - radius)
            d = math.hypot(x - cx, y - cy)
            if d > radius:
                continue
            t = y / S
            r, g, b = lerp(BRAND_TOP, BRAND_BOT, t)
            col = (r, g, b, 255)
            # белая шапка поверх
            if point_in_poly(x, y, board_px) or point_in_poly(x, y, band_px):
                col = WHITE + (255,)
            elif dist_seg(x, y, tx0, ty0, tx1, ty1) <= 0.012 * S:
                col = WHITE + (255,)
            elif math.hypot(x - ball[0], y - ball[1]) <= ball[2]:
                col = WHITE + (255,)
            buf[y][x] = col

    # даунсемплинг (box) ss×ss -> сглаживание
    out = bytearray()
    for y in range(size):
        out.append(0)  # filter type 0
        for x in range(size):
            ar = ag = ab = aa = 0
            for dy in range(ss):
                for dx in range(ss):
                    px = buf[y * ss + dy][x * ss + dx]
                    a = px[3]
                    ar += px[0] * a; ag += px[1] * a; ab += px[2] * a; aa += a
            if aa == 0:
                out += bytes((0, 0, 0, 0))
            else:
                out += bytes((ar // aa, ag // aa, ab // aa, aa // (ss * ss)))
    return bytes(out)

def write_png(path, size, raw):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

os.makedirs("icons", exist_ok=True)
for size in (180, 192, 512):
    write_png(f"icons/icon-{size}.png", size, render(size))
    print("создано icons/icon-%d.png" % size)
print("Готово")
