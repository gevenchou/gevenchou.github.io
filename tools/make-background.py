#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「雪夜明月」背景图。纯代码绘制，不用外部素材。

两种色调：
  --variant dusk   暮色版（暖紫灰夜空 + 玫瑰色地平线 + 暖白雪）—— 和宣纸米色相容
  --variant night  深夜版（冷蓝紫夜空）—— 冷调，压在米色纸下会偏灰

用法：
  python tools/make-background.py                # 默认 dusk
  python tools/make-background.py --variant night
"""

import argparse
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 1920, 1280
SUPERSAMPLE = 2
SEED = 20261127
MOON_X, MOON_Y = 0.745, 0.300
MOON_R = 57
FLAKE_COUNT = 620

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VARIANTS = {
    # 暖调：整体色相偏紫灰与玫瑰，和 #f8f3e8 的纸色同族，压上去不会被冲成灰色
    "dusk": {
        "out": "assets/background.jpg",
        "sky": [
            (0.00, (44, 38, 58)),
            (0.28, (66, 56, 78)),
            (0.50, (92, 76, 96)),
            (0.68, (124, 100, 110)),
            (0.82, (160, 130, 130)),
            (0.92, (184, 156, 146)),
            (1.00, (198, 172, 158)),
        ],
        "moon_core": (255, 252, 244),
        "moon_halo": (236, 220, 214),
        "stars": 720,
        "star_rgb": (1.00, 0.96, 0.90),
        "mountains": [((72, 62, 84), 0.85), ((52, 45, 66), 0.92)],
        "snow": [((232, 222, 214), 0.94), ((246, 238, 230), 0.97)],
        "snow_shadow": (188, 176, 186),
        "flake": (255, 250, 244),
        "flake_alpha": 0.80,
        "reflect": (28.0, (1.0, 0.97, 0.92)),
    },
    # 冷调：最接近真实夜景，但和米色纸色冲突
    "night": {
        "out": "assets/background-night.jpg",
        "sky": [
            (0.00, (5, 9, 24)),
            (0.26, (14, 22, 50)),
            (0.48, (28, 36, 72)),
            (0.66, (55, 56, 94)),
            (0.80, (100, 85, 110)),
            (0.92, (148, 127, 132)),
            (1.00, (178, 158, 152)),
        ],
        "moon_core": (252, 250, 240),
        "moon_halo": (202, 210, 230),
        "stars": 1100,
        "star_rgb": (0.94, 0.96, 1.00),
        "mountains": [((58, 62, 96), 0.85), ((40, 44, 74), 0.92)],
        "snow": [((196, 198, 208), 0.94), ((222, 222, 228), 0.97)],
        "snow_shadow": (160, 168, 190),
        "flake": (255, 255, 255),
        "flake_alpha": 0.85,
        "reflect": (26.0, (1.0, 0.99, 0.95)),
    },
    # 月白：整体提亮的浅色版，最不抢字
    "pale": {
        "out": "assets/background-pale.jpg",
        "sky": [
            (0.00, (206, 210, 224)),
            (0.32, (218, 220, 231)),
            (0.58, (228, 228, 235)),
            (0.76, (234, 230, 228)),
            (1.00, (238, 233, 226)),
        ],
        "moon_core": (255, 255, 252),
        "moon_halo": (252, 252, 250),
        "stars": 0,
        "star_rgb": (1, 1, 1),
        "mountains": [((176, 182, 200), 0.85), ((158, 166, 188), 0.9)],
        "snow": [((248, 248, 250), 0.95), ((254, 254, 255), 0.97)],
        "snow_shadow": (214, 222, 236),
        "flake": (255, 255, 255),
        "flake_alpha": 0.55,
        "reflect": (16.0, (1.0, 1.0, 1.0)),
    },
}


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def vertical_gradient(stops, height, width):
    ys = np.linspace(0.0, 1.0, height)
    positions = np.array([s[0] for s in stops], dtype=np.float64)
    colors = np.array([s[1] for s in stops], dtype=np.float64)
    out = np.empty((height, width, 3), dtype=np.float32)
    for channel in range(3):
        out[:, :, channel] = np.interp(ys, positions, colors[:, channel])[:, None]
    return out


def ridge(width, height, base, waves):
    xs = np.arange(width, dtype=np.float64)
    y = np.full(width, float(base))
    for amplitude, cycles, phase in waves:
        y += amplitude * np.sin(xs / width * np.pi * cycles + phase)
    rows = np.arange(height)[:, None]
    return (rows >= y[None, :]).astype(np.float32), y.astype(np.float32)


def blur_mask(mask, radius):
    img = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0


def splat_stars(layer, rng, count, width, height, avoid_center, avoid_radius):
    if count <= 0:
        return layer
    xs = rng.integers(0, width, count)
    ys = rng.integers(0, int(height * 0.80), count)
    dist = np.hypot(xs - avoid_center[0], ys - avoid_center[1])
    keep = (dist > avoid_radius) | (rng.random(count) > 0.85)
    xs, ys = xs[keep], ys[keep]
    brightness = rng.random(xs.size) ** 3.4

    for x, y, b in zip(xs, ys, brightness):
        value = float(28 + 210 * b)
        r = 0.55 + 1.5 * b
        x0, x1 = max(0, int(x - r)), min(width, int(x + r) + 1)
        y0, y1 = max(0, int(y - r)), min(height, int(y + r) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        gy, gx = np.mgrid[y0:y1, x0:x1]
        falloff = np.exp(-(((gx - x) ** 2 + (gy - y) ** 2) / (2 * (r * 0.62) ** 2)))
        layer[y0:y1, x0:x1] += (falloff * value).astype(np.float32)
        if b > 0.86:
            arm = int(4 + 7 * b)
            layer[max(0, int(y) - arm):int(y) + arm + 1, int(x)] += value * 0.16
            layer[int(y), max(0, int(x) - arm):int(x) + arm + 1] += value * 0.16
    return layer


def render(variant):
    p = VARIANTS[variant]
    rng = np.random.default_rng(SEED)
    W, H = WIDTH * SUPERSAMPLE, HEIGHT * SUPERSAMPLE
    mx, my = MOON_X * W, MOON_Y * H
    mr = MOON_R * SUPERSAMPLE

    image = vertical_gradient(p["sky"], H, W)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dist = np.sqrt((xx - mx) ** 2 + (yy - my) ** 2)

    # ---- 月亮 ----
    t = dist / mr
    core = smoothstep(1.06, 0.86, t)
    outside = np.maximum(t - 1.0, 0.0)
    halo = 0.62 * np.exp(-outside / 3.4) + 0.13 * np.exp(-outside / 20.0)
    intensity = np.maximum(core, halo)

    surface = core.copy()
    for dx, dy, rad, amount in [
        (-0.30, -0.16, 0.46, 0.13),
        (0.26, 0.14, 0.30, 0.10),
        (-0.02, 0.34, 0.24, 0.07),
        (0.10, -0.34, 0.22, 0.06),
    ]:
        d2 = np.hypot(xx - (mx + dx * mr), yy - (my + dy * mr)) / (rad * mr)
        surface -= np.exp(-(d2 ** 2) * 1.6) * amount
    surface = np.clip(surface, 0.70, 1.0)

    halo_only = np.clip(intensity - core, 0, None)
    image += (surface * core)[..., None] * np.array(p["moon_core"], dtype=np.float32)
    image += halo_only[..., None] * np.array(p["moon_halo"], dtype=np.float32)
    del core, halo, intensity, surface, halo_only

    # ---- 星点 ----
    if p["stars"]:
        stars = splat_stars(
            np.zeros((H, W), dtype=np.float32), rng, p["stars"] * SUPERSAMPLE, W, H, (mx, my), mr * 3.2
        )
        image += np.stack([stars * p["star_rgb"][i] for i in range(3)], axis=2).astype(np.float32)
        del stars

    # ---- 远山 ----
    for (color, alpha), waves_spec in zip(
        p["mountains"],
        [
            [(H * 0.030, 1.7, 0.4), (H * 0.018, 3.9, 1.1), (H * 0.010, 7.3, 2.2)],
            [(H * 0.026, 2.3, 2.6), (H * 0.014, 5.1, 0.7), (H * 0.008, 9.7, 3.4)],
        ],
    ):
        base = H * (0.700 if color == p["mountains"][0][0] else 0.760)
        raw, _ = ridge(W, H, base, waves_spec)
        m = blur_mask(raw, 1.4 * SUPERSAMPLE) * alpha
        light = np.clip(1.0 + 0.30 * (xx / W) - 0.20 * (yy / H), 0.75, 1.45)
        tinted = np.stack([color[i] * light for i in range(3)], axis=2).astype(np.float32)
        image *= (1 - m[..., None])
        image += tinted * m[..., None]
        del raw, m, tinted, light

    # ---- 雪坡 ----
    for (color, alpha), base_f, waves_spec, soft in zip(
        p["snow"],
        [0.845, 0.925],
        [
            [(H * 0.022, 1.2, 0.9), (H * 0.012, 3.1, 2.4), (H * 0.006, 6.7, 0.2)],
            [(H * 0.016, 1.9, 3.1), (H * 0.009, 4.3, 1.6), (H * 0.004, 8.9, 2.8)],
        ],
        [2.4, 1.8],
    ):
        base = H * base_f
        raw, yline = ridge(W, H, base, waves_spec)
        m = blur_mask(raw, soft * SUPERSAMPLE) * alpha

        below = np.maximum(yy - yline[None, :], 0.0)
        crest = np.exp(-below / (7.0 * SUPERSAMPLE))
        depth_fade = 1.0 - 0.12 * np.clip(below / (H - base), 0, 1)

        # 背光面用阴影色，越深越明显
        shade = np.clip(below / (60.0 * SUPERSAMPLE), 0, 1) * (0.55 - 0.35 * (xx / W))
        lightness = (0.86 + 0.20 * (xx / W)) * depth_fade + 0.10 * crest
        tinted = np.empty((H, W, 3), dtype=np.float32)
        for i in range(3):
            base_c = color[i] * lightness
            mix = base_c * (1 - shade) + p["snow_shadow"][i] * shade
            tinted[:, :, i] = mix
        image *= (1 - m[..., None])
        image += tinted * m[..., None]
        del raw, m, below, crest, depth_fade, shade, lightness, tinted, yline

    # ---- 月光在雪面的反射 ----
    pool = np.exp(-(((xx - mx) ** 2) / (W * 0.30) ** 2 + ((yy - H * 0.93) ** 2) / (H * 0.10) ** 2))
    strength, rgb = p["reflect"]
    image += (pool * strength)[..., None] * np.array(rgb, dtype=np.float32)
    del pool

    # ---- 落雪 ----
    flake = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(flake)
    for _ in range(FLAKE_COUNT * SUPERSAMPLE // 2):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H)
        depth = rng.random() ** 1.7
        r = (0.9 + depth * 4.6) * SUPERSAMPLE * 0.55
        draw.ellipse([x - r, y - r, x + r, y + r], fill=int(24 + 120 * depth))
    f = np.asarray(flake.filter(ImageFilter.GaussianBlur(1.1 * SUPERSAMPLE)), dtype=np.float32)[..., None] / 255.0
    a = p["flake_alpha"]
    image = image * (1 - f * a) + np.array(p["flake"], dtype=np.float32) * (f * a)
    del flake, f

    # ---- 暗角 ----
    nx = (xx / W - 0.5) * 2.0
    ny = (yy / H - 0.5) * 2.0
    vignette = 1.0 - 0.26 * np.clip(np.sqrt(nx ** 2 + ny ** 2) / 1.45, 0, 1) ** 1.8
    image *= vignette[..., None]

    # ---- 颗粒 ----
    image += rng.normal(0.0, 1.8, (H, W, 1)).astype(np.float32)

    image = np.clip(image, 0, 255).astype(np.uint8)
    out = Image.fromarray(image, "RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)

    out_path = os.path.join(ROOT, p["out"])
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save(out_path, "JPEG", quality=92, optimize=True, progressive=True)
    print(f"{variant}: {p['out']}  {WIDTH}x{HEIGHT}  {os.path.getsize(out_path) / 1024:.0f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", default="dusk", choices=sorted(VARIANTS))
    args = parser.parse_args()
    render(args.variant)
