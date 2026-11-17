#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
floorplan.py — 把结构化"俯视平面 JSON"渲染成标准黑白俯视 CAD 工程图（PNG + SVG）。

用途（scene-view-planner Skill 的阶段 A 产物）：
    Agent 先视觉分析用户场景图，把空间抽象成下方 schema 的 plan JSON，
    再运行本脚本得到一张干净的黑白建筑平面图，供用户在其上画箭头指定想看的方向。

坐标系（务必统一，北朝上）：
    x 向右 = 东 E；y 向上 = 北 N；单位"米"，只需相对比例正确，不要求真实尺寸。
    矩形房间用 room.bounds = {xmin,ymin,xmax,ymax}；非矩形用 room.outline 多边形。

命令行：
    python floorplan.py plan.json -o floorplan.png
    python floorplan.py plan.json -o floorplan.png --svg floorplan.svg   # 同时导出矢量
    python floorplan.py plan.json -o marked.png --arrow 5,1,S           # 额外叠加一个红色箭头
    （--arrow 格式：x,y,dir；dir 可取 N/E/S/W 或 "dx,dy"）

plan JSON schema（字段除 room 外均可缺省）：
{
  "title": "可选，仅记录用，不画进图",
  "style": {"wall":3.0,"inner":2.0,"item":1.8,"margin":0.10,"compass":false},
  "room":  {"bounds":{"xmin":0,"ymin":0,"xmax":10,"ymax":12}}  或  {"outline":[[x,y],...]} ,
  "openings": [
     {"kind":"door|slide|opening|window|double", "wall":"N|S|E|W", "at":5.0, "width":0.9,
      "hinge":"start|end", "open_deg":30, "arc":false}
  ],
  "elements": [ ...图块，见 dispatch，支持类型如下... ],
  "camera": {"x":5,"y":1.1,"facing":"N","label":"原机位"}   // 存在才画机位
}

图块 element.type 一览（坐标均为该图块"锚点"，默认锚点=外接矩形中心，靠墙图块锚点=贴墙边中点）：
  wall      内墙/隔断 {"p1":[x,y],"p2":[x,y]} 或 {"x":,"y":,"length":,"orient":"N|S|E|W"}
  rect      矩形块（柜/台/柱/镜/门板）{"x":,"y":,"w":,"d":,"orient":"N","radius":0}
  circle    圆（地漏/拖把池/圆桌）{"x":,"y":,"r":}
  toilet    俯视马桶 {"x":,"y":,"orient":"N|S|E|W"}   orient=马桶贴墙方向(水箱所在边)
  sink      俯视洗手盆 {"x":,"y":,"w":0.5,"d":0.45,"orient":"N"}
  stall_row 一排卫生隔间 {"x":,"y":,"n":3,"cell_w":1.1,"depth":1.5,"orient":"S","toilet":true}
  sink_row  一排贴墙洗手盆 {"wall":"E","x":,"y0":,"n":4,"pitch":0.95,"w":0.55,"d":0.6}
  counter   长台面+台盆 {"x":,"y":,"w":,"d":,"orient":"N","basins":4}
  label     文字 {"x":,"y":,"text":"","size":9}
  arrow     红色方向箭头 {"at":[x,y],"dir":"S" 或 [dx,dy],"size":1.0}
  camera    机位（也可写在顶层 camera）
"""

import sys
import json
import argparse
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Circle, Polygon, Arc, FancyArrowPatch


def _setup_cjk_font():
    """挑选系统可用的中文字体，避免中文标注变成豆腐块；无中文字体时回退默认。"""
    candidates = ["Microsoft YaHei", "SimHei", "SimSun", "Noto Sans CJK SC",
                  "Source Han Sans SC", "PingFang SC", "Arial Unicode MS"]
    avail = {f.name for f in font_manager.fontManager.ttflist}
    chosen = [c for c in candidates if c in avail]
    if chosen:
        plt.rcParams["font.sans-serif"] = chosen + ["DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    return chosen


CJK_FONTS = _setup_cjk_font()

# ---------- 全局样式（黑白工程线稿） ----------
INK = "#111111"          # 线条颜色：近黑
ARROW_RED = "#E5322D"    # 用户方向箭头：红
LW_WALL = 3.0            # 外墙线宽
LW_INNER = 2.0           # 内墙/隔断线宽
LW_ITEM = 1.8            # 家具图块线宽


# ============================================================
# # 基础工具
# ============================================================
def wall_vector(orient, length):
    """沿 N/S/E/W 方向、长度 length 的方向向量（dx,dy），N=y+, E=x+。"""
    return {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}[orient]


def facing_vec(f):
    """朝向（N/E/S/W 或 [dx,dy]）归一化为单位向量。"""
    if isinstance(f, list):
        dx, dy = f
        m = math.hypot(dx, dy) or 1.0
        return dx / m, dy / m
    return {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}[f]


def merge_intervals(ivs):
    """合并一维重叠/相邻区间，返回排序后的 [(lo,hi),...]。"""
    if not ivs:
        return []
    ivs = sorted((min(a, b), max(a, b)) for a, b in ivs)
    out = [list(ivs[0])]
    for a, b in ivs[1:]:
        if a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def complement(lo, hi, holes):
    """在 [lo,hi] 上挖掉 holes（合并区间），返回剩余实线段。"""
    segs, cur = [], lo
    for a, b in merge_intervals(holes):
        if a > cur:
            segs.append((cur, min(a, hi)))
        cur = max(cur, b)
    if cur < hi:
        segs.append((cur, hi))
    return [(a, b) for a, b in segs if b - a > 1e-9]


# ============================================================
# # 外墙（矩形自动开洞 / 任意多边形）
# ============================================================
def draw_room(ax, plan):
    room = plan.get("room", {})
    lw = plan.get("style", {}).get("wall", LW_WALL)

    if "outline" in room:
        pts = [(float(p[0]), float(p[1])) for p in room["outline"]]
        poly = Polygon(pts, closed=True, fill=False, edgecolor=INK, lw=lw,
                       joinstyle="miter")
        ax.add_patch(poly)
        return pts

    b = room["bounds"]
    xmin, ymin, xmax, ymax = (float(b[k]) for k in ("xmin", "ymin", "xmax", "ymax"))

    # 收集每条边上的开洞
    holes = {"N": [], "S": [], "E": [], "W": []}
    for op in plan.get("openings", []):
        side = op["wall"]
        w = float(op.get("width", 0.9))
        at = float(op["at"])
        holes[side].append((at - w / 2.0, at + w / 2.0))

    def hseg(y, x0, x1):
        ax.plot([x0, x1], [y, y], color=INK, lw=lw, solid_capstyle="butt",
                zorder=2)

    def vseg(x, y0, y1):
        ax.plot([x, x], [y0, y1], color=INK, lw=lw, solid_capstyle="butt",
                zorder=2)

    # 四边挖洞后画实墙
    for a, c in complement(xmin, xmax, holes["N"]):
        hseg(ymax, a, c)
    for a, c in complement(xmin, xmax, holes["S"]):
        hseg(ymin, a, c)
    for a, c in complement(ymin, ymax, holes["E"]):
        vseg(xmax, a, c)
    for a, c in complement(ymin, ymax, holes["W"]):
        vseg(xmin, a, c)

    # 画开口符号（门/窗）
    for op in plan.get("openings", []):
        _draw_opening_symbol(ax, op, b)

    return [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]


def _draw_opening_symbol(ax, op, b):
    """在矩形房间某面墙的洞口处画门/窗符号。"""
    side, kind = op["wall"], op.get("kind", "door")
    w = float(op.get("width", 0.9))
    at = float(op["at"])
    xmin, ymin, xmax, ymax = (b[k] for k in ("xmin", "ymin", "xmax", "ymax"))
    lw = LW_ITEM

    # 洞口两端点 p_lo -> p_hi（沿边正向），法向 n 指向室内
    if side in ("N", "S"):
        y = ymax if side == "N" else ymin
        p_lo, p_hi = (at - w / 2, y), (at + w / 2, y)
        n = (0, -1) if side == "N" else (0, 1)   # 室内方向
        horizontal = True
    else:
        x = xmax if side == "E" else xmin
        p_lo, p_hi = (x, at - w / 2), (x, at + w / 2)
        n = (-1, 0) if side == "E" else (1, 0)
        horizontal = False

    if kind == "window":
        # 窗：洞口处三条平行细线
        offs = [-0.06, 0.0, 0.06]
        for o in offs:
            ox, oy = n[0] * o, n[1] * o
            ax.plot([p_lo[0] + ox, p_hi[0] + ox],
                    [p_lo[1] + oy, p_hi[1] + oy],
                    color=INK, lw=1.0, zorder=3)
        return

    hinge = op.get("hinge", "start")
    hinge_pt = p_lo if hinge == "start" else p_hi
    free_pt = p_hi if hinge == "start" else p_lo

    if kind == "opening":
        return  # 仅门洞，无门扇

    if kind == "slide":
        # 推拉门：两条错开半幅的线
        mid = ((p_lo[0] + p_hi[0]) / 2.0, (p_lo[1] + p_hi[1]) / 2.0)
        ax.plot([p_lo[0], mid[0]], [p_lo[1], mid[1]], color=INK, lw=lw, zorder=3)
        ax.plot([mid[0], p_hi[0]], [mid[1], p_hi[1]], color=INK, lw=lw, zorder=3)
        return

    if kind == "double":
        mid = ((p_lo[0] + p_hi[0]) / 2.0, (p_lo[1] + p_hi[1]) / 2.0)
        ax.plot([p_lo[0], mid[0]], [p_lo[1], mid[1]], color=INK, lw=lw, zorder=3)
        ax.plot([p_hi[0], mid[0]], [p_hi[1], mid[1]], color=INK, lw=lw, zorder=3)
        return

    # 普通平开门：一条门板线（默认画成关闭态直线，最干净，贴近样例）
    # open_deg>0 且 arc=true 时，画半开门扇 + 四分之一开启弧
    open_deg = float(op.get("open_deg", 0) or 0)
    if open_deg <= 0 or not op.get("arc", False):
        ax.plot([hinge_pt[0], free_pt[0]], [hinge_pt[1], free_pt[1]],
                color=INK, lw=lw, zorder=3)
        return

    # 沿"关闭方向"（hinge->free）向室内旋转 open_deg
    dx, dy = free_pt[0] - hinge_pt[0], free_pt[1] - hinge_pt[1]
    ang = math.radians(open_deg)
    c, s = math.cos(ang), math.sin(ang)
    # 让门扇转向室内：若旋转后跑到室外则反向
    leaf = (dx * c - dy * s, dx * s + dy * c)
    tip = (hinge_pt[0] + leaf[0], hinge_pt[1] + leaf[1])
    if (tip[0] - hinge_pt[0]) * n[0] + (tip[1] - hinge_pt[1]) * n[1] < 0:
        leaf = (dx * c + dy * s, -dx * s + dy * c)
        tip = (hinge_pt[0] + leaf[0], hinge_pt[1] + leaf[1])
    ax.plot([hinge_pt[0], tip[0]], [hinge_pt[1], tip[1]],
            color=INK, lw=lw, zorder=3)
    r = math.hypot(dx, dy)
    # 开启弧（简化：以 hinge 为心、门宽为半径画小弧）
    theta1 = math.degrees(math.atan2(dy, dx))
    theta2 = math.degrees(math.atan2(leaf[1], leaf[0]))
    ax.add_patch(Arc(hinge_pt, 2 * r, 2 * r, angle=0,
                     theta1=min(theta1, theta2), theta2=max(theta1, theta2),
                     edgecolor=INK, lw=0.8, zorder=3))


# ============================================================
# # 图块
# ============================================================
def _oriented_rect_pts(cx, cy, w, d, orient="N"):
    """以 (cx,cy) 为中心、w 沿 E-W、d 沿 N-S 的矩形四角；orient 做 90 度步进旋转。"""
    hx, hy = w / 2.0, d / 2.0
    base = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    rot = {"N": 0, "E": 1, "S": 2, "W": 3}[orient]
    out = []
    for x, y in base:
        for _ in range(rot):
            x, y = -y, x
        out.append((cx + x, cy + y))
    return out


def draw_rect(ax, e, lw=LW_ITEM, edge=INK, fill=False):
    pts = _oriented_rect_pts(float(e["x"]), float(e["y"]),
                             float(e.get("w", 1)), float(e.get("d", 1)),
                             e.get("orient", "N"))
    r = float(e.get("radius", 0))
    if r > 0:
        w, d = float(e.get("w", 1)), float(e.get("d", 1))
        r = min(r, w / 2, d / 2) - 1e-6
        patch = None
        # FancyBboxPatch 不支持旋转，圆角矩形仅在 orient=N/S 时直接用
        if e.get("orient", "N") in ("N", "S"):
            from matplotlib.patches import FancyBboxPatch
            patch = FancyBboxPatch((e["x"] - w / 2, e["y"] - d / 2), w, d,
                                   boxstyle=f"round,pad=0,rounding_size={r}",
                                   fill=fill, edgecolor=edge, lw=lw, zorder=3)
            ax.add_patch(patch)
            return
    ax.add_patch(Polygon(pts, closed=True, fill=fill, edgecolor=edge, lw=lw,
                         joinstyle="miter", zorder=3))


def draw_wall(ax, e, lw=LW_INNER):
    if "p1" in e and "p2" in e:
        p1, p2 = e["p1"], e["p2"]
    else:
        dx, dy = wall_vector(e.get("orient", "N"), float(e.get("length", 1)))
        x, y = float(e["x"]), float(e["y"])
        p1, p2 = (x - dx / 2, y - dy / 2), (x + dx / 2, y + dy / 2)
    ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=INK, lw=float(e.get("lw", lw)),
            solid_capstyle="butt", zorder=3)


def draw_circle(ax, e, lw=LW_ITEM):
    ax.add_patch(Circle((float(e["x"]), float(e["y"])), float(e["r"]),
                        fill=False, edgecolor=INK, lw=lw, zorder=3))


def draw_toilet(ax, e, lw=LW_ITEM):
    """俯视马桶：水箱小矩形 + 碗（圆）。orient=水箱贴墙方向。"""
    x, y = float(e["x"]), float(e["y"])
    o = e.get("orient", "N")
    # 以"碗中心偏锚点、水箱在贴墙侧"布局，整体沿 orient 旋转
    # 局部坐标：+y 朝贴墙方向；水箱在 y=+0.22，碗心在 y=-0.12
    tank = _oriented_rect_pts(x, y + 0.20, 0.42, 0.18, o)
    ax.add_patch(Polygon(tank, closed=True, fill=False, edgecolor=INK, lw=lw,
                         zorder=3))
    bowl = _oriented_rect_pts(x, y - 0.10, 0.40, 0.50, o)
    ax.add_patch(Polygon(bowl, closed=True, fill=False, edgecolor=INK, lw=lw,
                         zorder=3))
    ax.add_patch(Circle((x, y - 0.10), 0.13, fill=False, edgecolor=INK,
                        lw=lw - 0.4, zorder=3))


def draw_sink(ax, e, lw=LW_ITEM):
    """俯视洗手盆：轴对齐圆角矩形 + 偏贴墙侧的龙头小点（盆体对称，不随 orient 旋转）。"""
    from matplotlib.patches import FancyBboxPatch
    x, y = float(e["x"]), float(e["y"])
    w, d = float(e.get("w", 0.5)), float(e.get("d", 0.45))
    r = min(w, d) * 0.22
    ax.add_patch(FancyBboxPatch((x - w / 2, y - d / 2), w, d,
                                boxstyle=f"round,pad=0,rounding_size={r}",
                                fill=False, edgecolor=INK, lw=lw, zorder=3))
    o = e.get("orient", "N")
    vx, vy = facing_vec(o)
    ax.add_patch(Circle((x + vx * d * 0.28, y + vy * d * 0.28), 0.03,
                        fill=True, facecolor=INK, edgecolor=INK, lw=0.5,
                        zorder=4))


def draw_stall_row(ax, e, lw=LW_INNER):
    """一排卫生隔间。orient=开口朝向（人进入方向），隔间板在相反侧贴墙。"""
    x0, y0 = float(e["x"]), float(e["y"])      # 排列起点（第一个隔板位置，贴墙线）
    n = int(e.get("n", 1))
    cw = float(e.get("cell_w", 1.1))
    dep = float(e.get("depth", 1.5))
    o = e.get("orient", "S")                   # 开口朝南（隔间向北墙内凹）
    # 排列方向 t（垂直于开口朝向）、进深方向 f（=开口朝向，从墙指向房间）
    f = facing_vec(o)
    t = (-f[1], f[0])                          # 垂直于 f
    for i in range(n + 1):
        # n+1 块侧隔板：从贴墙线沿开口方向伸 depth
        bx, by = x0 + t[0] * cw * i, y0 + t[1] * cw * i
        ax.plot([bx, bx + f[0] * dep], [by, by + f[1] * dep], color=INK,
                lw=lw, solid_capstyle="butt", zorder=3)
    # 贴墙的背板线（连第一块到最后一块外侧）
    sx, sy = x0, y0
    ex, ey = x0 + t[0] * cw * n, y0 + t[1] * cw * n
    ax.plot([sx, ex], [sy, ey], color=INK, lw=lw, zorder=3)
    # 开口侧门板（每格一段，两侧留缝）
    gap = cw * 0.12
    for i in range(n):
        a = i + 0.0
        mx = x0 + t[0] * cw * (a + 0.0) + f[0] * dep
        my = y0 + t[1] * cw * (a + 0.0) + f[1] * dep
        nx = x0 + t[0] * cw * (a + 1.0) + f[0] * dep
        ny = y0 + t[1] * cw * (a + 1.0) + f[1] * dep
        # 沿 t 方向缩 gap
        ax.plot([mx + t[0] * gap, nx - t[0] * gap],
                [my + t[1] * gap, ny - t[1] * gap],
                color=INK, lw=lw, zorder=3)
        if e.get("toilet", False):
            # 隔间内放一个俯视马桶，贴背板（与开口相反方向）
            cx = x0 + t[0] * cw * (i + 0.5) + f[0] * dep * 0.30
            cy = y0 + t[1] * cw * (i + 0.5) + f[1] * dep * 0.30
            back = {"N": "S", "S": "N", "E": "W", "W": "E"}[o]
            draw_toilet(ax, {"x": cx, "y": cy, "orient": back}, lw=LW_ITEM)


def draw_sink_row(ax, e, lw=LW_ITEM):
    """沿一面墙排一列洗手盆。wall=盆所贴墙；x=贴墙方向坐标，y0=沿墙起始中心。"""
    wall = e.get("wall", "E")
    n = int(e.get("n", 1))
    pitch = float(e.get("pitch", 0.95))
    w = float(e.get("w", 0.55))
    d = float(e.get("d", 0.6))
    x = float(e["x"]); y0 = float(e["y0"])
    # 沿墙步进方向 & 盆的 orient（盆朝房间，即与墙相反）
    along = {"E": (0, 1), "W": (0, -1), "N": (1, 0), "S": (-1, 0)}[wall]
    face = {"E": "W", "W": "E", "N": "S", "S": "N"}[wall]
    # 让盆的"短边贴墙"：贴墙方向尺寸取 w，沿墙方向尺寸取 d*pitch 内
    for i in range(n):
        cx = x + along[0] * pitch * i
        cy = y0 + along[1] * pitch * i
        if wall in ("E", "W"):
            draw_sink(ax, {"x": cx, "y": cy, "w": d, "d": w, "orient": face}, lw=lw)
        else:
            draw_sink(ax, {"x": cx, "y": cy, "w": pitch * 0.8, "d": d,
                           "orient": face}, lw=lw)


def draw_counter(ax, e, lw=LW_ITEM):
    """长台面（大圆角矩形）+ 台面上 n 个盆轮廓。"""
    draw_rect(ax, e, lw=LW_INNER)
    n = int(e.get("basins", 0))
    if n <= 0:
        return
    x, y = float(e["x"]), float(e["y"])
    w, d = float(e.get("w", 1)), float(e.get("d", 1))
    o = e.get("orient", "N")
    # 沿长边均匀排盆（长边取 w/d 中较大者方向）
    if w >= d:
        for i in range(n):
            bx = x - w / 2 + w * (i + 0.5) / n
            draw_rect(ax, {"x": bx, "y": y, "w": w / n * 0.7, "d": d * 0.6,
                           "orient": o, "radius": min(w / n, d) * 0.15}, lw=lw)
    else:
        for i in range(n):
            by = y - d / 2 + d * (i + 0.5) / n
            draw_rect(ax, {"x": x, "y": by, "w": w * 0.6, "d": d / n * 0.7,
                           "orient": o, "radius": min(w, d / n) * 0.15}, lw=lw)


# ============================================================
# # 机位 / 箭头 / 指北针 / 文字
# ============================================================
def draw_camera(ax, cam, lw=LW_ITEM):
    x, y = float(cam["x"]), float(cam["y"])
    vx, vy = facing_vec(cam.get("facing", "N"))
    # 机位：身体小圆 + 前方三角形视锥
    ax.add_patch(Circle((x, y), 0.12, fill=True, facecolor="white",
                        edgecolor=INK, lw=lw, zorder=5))
    side = (-vy, vx)
    tip = (x + vx * 0.62, y + vy * 0.62)
    b1 = (x + side[0] * 0.22 - vx * 0.05, y + side[1] * 0.22 - vy * 0.05)
    b2 = (x - side[0] * 0.22 - vx * 0.05, y - side[1] * 0.22 - vy * 0.05)
    ax.add_patch(Polygon([tip, b1, b2], closed=True, fill=False,
                         edgecolor=INK, lw=lw, zorder=5))
    if cam.get("label"):
        ax.text(x - vx * 0.28 + side[0] * 0.3, y - vy * 0.28 + side[1] * 0.3,
                cam["label"], fontsize=8, ha="center", va="center",
                color=INK, zorder=6)


def draw_arrow(ax, a, lw=3.2):
    x, y = a["at"]
    vx, vy = facing_vec(a.get("dir", "S"))
    size = float(a.get("size", 1.0))
    L = 1.1 * size
    start = (x - vx * L, y - vy * L)
    end = (x + vx * L * 0.5, y + vy * L * 0.5)
    ax.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>",
                                 mutation_scale=22 * size, color=ARROW_RED,
                                 lw=lw, zorder=8, shrinkA=0, shrinkB=0))


def draw_compass(ax, x, y, r=0.5):
    ax.add_patch(Circle((x, y), r, fill=False, edgecolor=INK, lw=1.0, zorder=6))
    ax.annotate("", xy=(x, y + r * 0.9), xytext=(x, y - r * 0.9),
                arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.0), zorder=6)
    ax.text(x, y + r + 0.18, "N", fontsize=9, ha="center", va="bottom",
            color=INK, zorder=6)


DISPATCH = {
    "wall": draw_wall,
    "rect": draw_rect,
    "circle": draw_circle,
    "toilet": draw_toilet,
    "sink": draw_sink,
    "stall_row": draw_stall_row,
    "sink_row": draw_sink_row,
    "counter": draw_counter,
    "camera": draw_camera,
    "arrow": draw_arrow,
}


# ============================================================
# # 主渲染
# ============================================================
def render(plan, out_png, out_svg=None, extra_arrow=None):
    fig, ax = plt.subplots(figsize=(7.6, 7.6))
    ax.set_aspect("equal")
    ax.axis("off")

    room_pts = draw_room(ax, plan)

    for e in plan.get("elements", []):
        t = e.get("type")
        if t == "label":
            ax.text(float(e["x"]), float(e["y"]), e.get("text", ""),
                    fontsize=float(e.get("size", 9)), ha="center", va="center",
                    color=INK, zorder=6)
            continue
        fn = DISPATCH.get(t)
        if fn is None:
            print(f"[warn] 未知图块类型已跳过: {t}", file=sys.stderr)
            continue
        fn(ax, e)

    if plan.get("camera"):
        draw_camera(ax, plan["camera"])
    # 注：elements 内的 camera/arrow 已在上方主循环经 DISPATCH 绘制，此处不重复

    if extra_arrow:
        draw_arrow(ax, extra_arrow)

    # ---- 自适应范围：以房间外接矩形为基准，纳入可能落在室外的辅助元素 ----
    xs = [p[0] for p in room_pts]
    ys = [p[1] for p in room_pts]
    if plan.get("camera"):
        xs.append(float(plan["camera"]["x"])); ys.append(float(plan["camera"]["y"]))
    for e in plan.get("elements", []):
        if e.get("type") in ("camera",) and "x" in e:
            xs.append(float(e["x"])); ys.append(float(e["y"]))
        if e.get("type") == "arrow":
            xs.append(float(e["at"][0])); ys.append(float(e["at"][1]))
    if extra_arrow:
        xs.append(float(extra_arrow["at"][0])); ys.append(float(extra_arrow["at"][1]))

    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    dx = (xmax - xmin) or 1
    dy = (ymax - ymin) or 1
    m = plan.get("style", {}).get("margin", 0.12)
    pad = max(dx, dy) * m

    # 指北针放在房间右上角外侧，并把其位置纳入范围，避免压住外墙
    if plan.get("style", {}).get("compass", False):
        cr = max(dx, dy) * 0.055
        ccx, ccy = xmax + pad * 1.0, ymax + pad * 0.35
        draw_compass(ax, ccx, ccy, r=cr)
        xmax = ccx + cr

    ax.set_xlim(xmin - pad, xmax + pad)
    ax.set_ylim(ymin - pad, ymax + pad)

    fig.tight_layout(pad=0.4)
    fig.savefig(out_png, dpi=300, bbox_inches="tight", facecolor="white")
    if out_svg:
        fig.savefig(out_svg, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"[ok] 已输出 {out_png}" + (f" 与 {out_svg}" if out_svg else ""))


def parse_arrow(s):
    parts = s.split(",")
    if len(parts) == 3:
        return {"at": [float(parts[0]), float(parts[1])], "dir": parts[2].strip()}
    if len(parts) == 4:
        return {"at": [float(parts[0]), float(parts[1])],
                "dir": [float(parts[2]), float(parts[3])]}
    raise argparse.ArgumentTypeError("--arrow 格式应为 x,y,N/E/S/W 或 x,y,dx,dy")


def main():
    ap = argparse.ArgumentParser(description="结构化平面 JSON -> 俯视 CAD 工程图")
    ap.add_argument("plan", help="plan JSON 文件路径")
    ap.add_argument("-o", "--out", required=True, help="输出 PNG 路径")
    ap.add_argument("--svg", help="可选：同时输出 SVG 矢量路径")
    ap.add_argument("--arrow", type=parse_arrow, help="叠加红色箭头 x,y,dir")
    args = ap.parse_args()

    with open(args.plan, "r", encoding="utf-8") as f:
        plan = json.load(f)
    render(plan, args.out, args.svg, args.arrow)


if __name__ == "__main__":
    main()
