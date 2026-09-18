#!/usr/bin/env python3
"""Copy DualLane brand marks from the web public assets into the Android client."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "duallane" / "apps" / "web" / "public" / "icon-512.png"
CREAM = (247, 242, 234, 255)
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SPLASH = {"mdpi": 288, "hdpi": 432, "xhdpi": 576, "xxhdpi": 864, "xxxhdpi": 1152}
ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/icon_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""


def fit(image: Image.Image, box: int, background=CREAM) -> Image.Image:
    canvas = Image.new("RGBA", (box, box), background)
    scaled = image.resize((box, box), Image.Resampling.LANCZOS)
    canvas.paste(scaled, (0, 0), scaled)
    return canvas


def circled(image: Image.Image) -> Image.Image:
    box = image.size[0]
    mask = Image.new("L", (box, box), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, box - 1, box - 1), fill=255)
    out = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    out.paste(image, (0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    source = Image.open(SRC).convert("RGBA")
    assets = ROOT / "assets"
    assets.mkdir(exist_ok=True)
    source.save(assets / "icon.png", "PNG")

    adaptive = Image.new("RGBA", (1024, 1024), CREAM)
    inner = 880
    scaled = source.resize((inner, inner), Image.Resampling.LANCZOS)
    adaptive.paste(scaled, ((1024 - inner) // 2, (1024 - inner) // 2), scaled)
    adaptive.save(assets / "adaptive-icon.png", "PNG")

    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for density, size in LEGACY.items():
        folder = res / f"mipmap-{density}"
        folder.mkdir(exist_ok=True)
        icon = fit(source, size)
        icon.save(folder / "ic_launcher.webp", "WEBP", quality=92)
        circled(icon).save(folder / "ic_launcher_round.webp", "WEBP", quality=92)
        foreground = int(round(size * 108 / 48))
        fit(source, foreground).save(folder / "ic_launcher_foreground.webp", "WEBP", quality=92)

    for density, size in SPLASH.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inner = min(size, source.size[0])
        mark = source if inner == source.size[0] else source.resize((inner, inner), Image.Resampling.LANCZOS)
        canvas.paste(mark, ((size - inner) // 2, (size - inner) // 2), mark)
        canvas.save(res / f"drawable-{density}" / "splashscreen_logo.png", "PNG", optimize=True, compress_level=9)

    anydpi = res / "mipmap-anydpi-v26"
    anydpi.mkdir(exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(ADAPTIVE_XML, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(ADAPTIVE_XML, encoding="utf-8")


if __name__ == "__main__":
    main()
