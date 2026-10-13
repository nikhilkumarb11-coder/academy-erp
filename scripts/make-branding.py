"""
Makes an academy's app icons from its logo image.

    python scripts/make-branding.py <logo image> <slug> [--emblem-only]

The logo may be on a black or a white background. With --emblem-only (or when the logo is a
mark followed by text, as in "[emblem] RAYS ACADEMY"), the left-most graphic is cut out.
Writes tenants/branding/<slug>/:
  logo.png             transparent emblem, 512x512 (app header, login, receipts)
  icon-192.png         install icon (rounded white tile)
  icon-512.png
  maskable-512.png     Android adaptive icon (full white, emblem inside the safe zone)
  apple-touch-icon.png iPhone home screen, 180x180
Also prints the two most common strong colours, to use as the tenant theme.
"""
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent


def to_rgba(src: Image.Image) -> Image.Image:
    """Turns the plain background into transparency, keeping soft edges clean."""
    rgb = np.asarray(src.convert('RGB')).astype(np.float32)
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
    dark_bg = corners.mean() < 128
    if dark_bg:
        level = rgb.max(axis=2)
        alpha = np.clip((level - 22) / (70 - 22), 0, 1)
        # Remove the black that is blended into edge pixels.
        safe = np.maximum(alpha, 1e-3)[..., None]
        colour = np.clip(rgb / safe, 0, 255)
    else:
        level = 255 - rgb.min(axis=2)
        alpha = np.clip((level - 22) / (70 - 22), 0, 1)
        safe = np.maximum(alpha, 1e-3)[..., None]
        colour = np.clip(255 - (255 - rgb) / safe, 0, 255)
    out = np.dstack([colour, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def emblem_box(rgba: Image.Image, emblem_only: bool):
    alpha = np.asarray(rgba)[..., 3] > 40
    ys, xs = np.nonzero(alpha)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    if emblem_only:
        cols = alpha.sum(axis=0)
        # Nearly empty columns also count as the gap: a thin underline often runs up to the emblem.
        sparse = max(2, int(rgba.height * 0.012))
        min_gap = 3
        run = 0
        for x in range(x0 + int((x1 - x0) * 0.1), x1 + 1):
            run = run + 1 if cols[x] <= sparse else 0
            if run >= min_gap:
                x1 = x - run
                break
        rows = alpha[:, x0:x1 + 1].sum(axis=1)
        ys = np.nonzero(rows)[0]
        y0, y1 = ys.min(), ys.max()
    return int(x0), int(y0), int(x1) + 1, int(y1) + 1


def square(img: Image.Image, size: int, fill: float, background=None, radius=0.0) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if background:
        bg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(bg).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius), fill=background)
        canvas = Image.alpha_composite(canvas, bg)
    target = int(size * fill)
    scale = target / max(img.width, img.height)
    resized = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def brand_colours(rgba: Image.Image):
    px = np.asarray(rgba).reshape(-1, 4)
    px = px[px[:, 3] > 230][:, :3].astype(int)
    sat = px.max(axis=1) - px.min(axis=1)
    strong = px[sat > 40]
    counts = Counter(map(tuple, (strong // 16) * 16 + 8))
    return ['#%02X%02X%02X' % c for c, _ in counts.most_common(2)]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    source, slug = Path(sys.argv[1]), sys.argv[2]
    emblem_only = '--emblem-only' in sys.argv
    out = ROOT / 'tenants' / 'branding' / slug
    out.mkdir(parents=True, exist_ok=True)

    rgba = to_rgba(Image.open(source))
    emblem = rgba.crop(emblem_box(rgba, emblem_only))
    print(f'source {Image.open(source).size}, emblem {emblem.size}')

    white = (255, 255, 255, 255)
    square(emblem, 512, 0.96).save(out / 'logo.png', optimize=True)
    for size in (192, 512):
        square(emblem, size, 0.80, white, radius=0.22).save(out / f'icon-{size}.png', optimize=True)
    square(emblem, 512, 0.66, white).save(out / 'maskable-512.png', optimize=True)
    square(emblem, 180, 0.80, white).convert('RGB').save(out / 'apple-touch-icon.png', optimize=True)
    print('colours (most common first):', ', '.join(brand_colours(emblem)))
    print(f'written to {out}')


if __name__ == '__main__':
    main()
