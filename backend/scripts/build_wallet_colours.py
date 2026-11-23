"""Copies the card colour table from the web design library into backend/wallet/card_colours.json.

The pass colour in Google Wallet follows the card's own colour set, and those colours are only defined in the web
library (web/src/lib/library/generated/meta.ts). Run this again after the library is regenerated:

    python scripts/build_wallet_colours.py

A test compares the JSON with meta.ts, so a forgotten re-run shows up in the test run.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT.parent / "web" / "src" / "lib" / "library" / "generated" / "meta.ts"
TARGET = ROOT / "wallet" / "card_colours.json"


def read_table():
    text = META.read_text(encoding="utf-8")
    palettes = json.loads(re.search(r"PALETTES: PaletteMeta\[\] = (\[.*?\]);\n", text, re.S).group(1))
    faces = json.loads(re.search(r"FACE_META: FaceMeta\[\] = (\[.*?\]);\n", text, re.S).group(1))
    return {
        "palettes": [{k: p[k] for k in ("bg", "bg2", "fg", "acc", "on")} for p in palettes],
        "faces": [f["p"] for f in faces],
    }


if __name__ == "__main__":
    TARGET.write_text(json.dumps(read_table(), separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {TARGET}")
