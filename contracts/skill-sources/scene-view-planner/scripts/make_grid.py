#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_grid.py — 把同一空间的多个机位视角拼成 2x2 四宫格总览（scene-view-planner 阶段 C 自检工具）。

用途：
    当反打 / 左侧 / 右侧等视角都生成完后，用本脚本把【原视角 / 反打 / 左侧 / 右侧】按固定机位
    顺序拼成一张四宫格，便于一次性检索：四个视角的位置关系是否错乱、风格色调是否统一、
    门窗与固定物数量是否跨视角对得上。纯 Pillow 实现，不依赖 matplotlib。

固定排布（与相机几何方位一致，勿随意改顺序）：
    左上 = 原视角 Front(F0)      右上 = 反打 Reverse(180°)
    左下 = 左侧 Left            右下 = 右侧 Right

命令行：
    python make_grid.py --front front.png --reverse rev.png --left l.png --right r.png -o grid.png
    # 某个视角还没生成可直接省略对应参数，该格留"未生成 N/A"占位；
    # 自定义四个格子标题（用 | 分隔，顺序同上）：
    python make_grid.py --front a.png --reverse b.png --titles "正面|反打|左|右" -o grid.png
    # --cell 控制每格图像区的像素尺寸（默认 880x520，适配 16:9 成图）
"""

import argparse
import os

from PIL import Image, ImageDraw, ImageFont

GAP, PAD, BAR = 20, 24, 52           # 格间距 / 外边距 / 每格底部标签条高度
LINE = (210, 210, 210)
INK = (17, 17, 17)
WHITE = (255, 255, 255)

DEFAULT_TITLES = ["原视角 Front (F0)", "反打 Reverse (180°)",
                  "左侧 Left", "右侧 Right"]


def load_font(size):
    for p in [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              "/System/Library/Fonts/PingFang.ttc",
              "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
              "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


FONT = load_font(28)
FONT_NA = load_font(30)


def contain(im, w, h):
    """等比缩放并居中放进 w×h 的白底画布（contain，不裁剪不变形）。"""
    canvas = Image.new("RGB", (w, h), WHITE)
    s = min(w / im.width, h / im.height)
    nw, nh = max(1, int(im.width * s)), max(1, int(im.height * s))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    canvas.paste(im2, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def draw_cell(path, title, cw, ch):
    """画一格：上图（contain 到 cw×ch）下标签，整体带细边框。"""
    cell = Image.new("RGB", (cw, ch + BAR), WHITE)
    d = ImageDraw.Draw(cell)
    if path and os.path.exists(path):
        img = contain(Image.open(path).convert("RGB"), cw, ch)
        cell.paste(img, (0, 0))
    else:
        # 占位：虚线感斜纹框 + N/A
        d.rectangle([0, 0, cw - 1, ch - 1], outline=LINE, width=2)
        na = "未生成  N/A"
        tb = d.textbbox((0, 0), na, font=FONT_NA)
        d.text(((cw - (tb[2] - tb[0])) / 2, (ch - (tb[3] - tb[1])) / 2),
               na, font=FONT_NA, fill=(150, 150, 150))
    # 标签条
    d.line([(0, ch), (cw, ch)], fill=LINE, width=2)
    tb = d.textbbox((0, 0), title, font=FONT)
    d.text(((cw - (tb[2] - tb[0])) / 2, ch + 10), title, font=FONT, fill=INK)
    d.rectangle([0, 0, cw - 1, ch + BAR - 1], outline=LINE, width=2)
    return cell


def main():
    ap = argparse.ArgumentParser(description="同一空间多视角 -> 2x2 四宫格总览")
    ap.add_argument("--front")
    ap.add_argument("--reverse")
    ap.add_argument("--left")
    ap.add_argument("--right")
    ap.add_argument("--titles", help='四格标题，用 | 分隔，顺序：前|反打|左|右')
    ap.add_argument("--cell", default="880x520", help="每格图像区尺寸 宽x高，默认 880x520")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args()

    cw, ch = (int(v) for v in args.cell.lower().split("x"))
    titles = (args.titles.split("|") if args.titles else DEFAULT_TITLES)
    while len(titles) < 4:
        titles.append(DEFAULT_TITLES[len(titles)])

    slots = [(args.front, titles[0].strip()), (args.reverse, titles[1].strip()),
             (args.left, titles[2].strip()), (args.right, titles[3].strip())]
    cells = [draw_cell(p, t, cw, ch) for p, t in slots]

    W = 2 * cw + GAP + 2 * PAD
    H = 2 * (ch + BAR) + GAP + 2 * PAD
    grid = Image.new("RGB", (W, H), WHITE)
    pos = [(PAD, PAD), (PAD + cw + GAP, PAD),
           (PAD, PAD + ch + BAR + GAP),
           (PAD + cw + GAP, PAD + ch + BAR + GAP)]
    for cell, (x, y) in zip(cells, pos):
        grid.paste(cell, (x, y))

    grid.save(args.out)
    print(f"[ok] 四宫格已输出 {args.out}  尺寸 {grid.size}")


if __name__ == "__main__":
    main()
