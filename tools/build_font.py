"""Build the web fonts used by the title (fonts/*.woff).

Both title options come from this one script.  What it does to a font:

  * replaces the mark-positioning (GPOS) with generic rules, the same for every
    letter: niqqud and cantillation marks are centred under their letter, the
    holam sits above its left side, the dagesh inside the letter, and when a
    niqqud and a cantillation mark share a letter they stand side by side, the
    pair centred;
  * adds a cmap entry for U+05C7 (qamats qatan) when the font lacks it
    (otherwise browsers fall back to another font for the whole letter);
  * optionally takes the outline of some letters/marks from a second font.

usage: python tools/build_font.py [source_font output_font [donor_font codepoints]]

  option 2 (default):
      python tools/build_font.py
      (tools/STAM.TTF -> fonts/GuttmanStam.woff)

  option 1:
      python tools/build_font.py tools/StamAshkenazBase.woff fonts/StamAshkenazFull.woff tools/STAM.TTF 05DC,05B8,05C7
      (the straight lamed and the qamats of Guttman Stam are copied into the
       Ashkenaz font; code points are hexadecimal, separated by commas)

Needs: pip install fonttools
"""
import sys

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

# ---- Settings (font units, 1000 per em) -----------------------------------------

LETTER_SCALE = 0.88  # letters borrowed from the donor font are drawn a bit smaller...
LETTER_DX = -7  # ...and moved this much to the left
NUDGE = {0x5AD: 60}  # extra shift to the right for a mark (dehi), by code point
FOOT_CENTRED = {0x5D7}  # letters whose marks go under the middle of their legs (chet)
GAP = 20  # space between a niqqud and the cantillation mark beside it
BELOW_BASELINE = -35  # marks under a letter hang from here (or lower, for letters with a tail)
BELOW_CLEARANCE = 30  # distance under a letter's lowest point
ABOVE_CLEARANCE = 25  # distance over a letter's highest point
DAGESH_DROP = 50  # the dagesh sits this much below the middle of the letter
ABOVE_MARK_MIN_Y = 250  # a mark whose middle is higher than this is drawn above its letter

HEBREW_LETTERS = range(0x5D0, 0x5EB)
QAMATS, QAMATS_QATAN = 0x5B8, 0x5C7


def is_mark(cp):
    return 0x591 <= cp <= 0x5AF or 0x5B0 <= cp <= 0x5BD or cp in (0x5BF, 0x5C1, 0x5C2, 0x5C4, 0x5C5, QAMATS_QATAN)


# ---- Arguments ----------------------------------------------------------------------

SRC, OUT = sys.argv[1:3] if len(sys.argv) > 2 else ("tools/STAM.TTF", "fonts/GuttmanStam.woff")
DONOR_FONT = sys.argv[3] if len(sys.argv) > 4 else None
DONOR_CODEPOINTS = [int(c, 16) for c in sys.argv[4].split(",")] if len(sys.argv) > 4 else []

font = TTFont(SRC)
glyf = font["glyf"]


# ---- 1. Letters and marks copied from the donor font ----------------------------------

if DONOR_FONT:
    donor = TTFont(DONOR_FONT)
    donor_cmap, donor_glyphs = donor.getBestCmap(), donor.getGlyphSet()
    unit_ratio = font["head"].unitsPerEm / donor["head"].unitsPerEm
    for cp in DONOR_CODEPOINTS:
        mark = is_mark(cp)
        scale = unit_ratio if mark else unit_ratio * LETTER_SCALE  # marks keep their size...
        dx = 0 if mark else LETTER_DX  # ...and place (the GPOS positions them)
        source = cp if cp in donor_cmap else QAMATS  # Guttman has no qamats qatan: use qamats
        pen = TTGlyphPen(None)
        donor_glyphs[donor_cmap[source]].draw(TransformPen(pen, (scale, 0, 0, scale, dx, 0)))
        glyph = pen.glyph()
        glyph.recalcBounds(glyf)
        name = font.getBestCmap()[cp]
        glyf[name] = glyph
        advance = 0 if mark else round(donor["hmtx"][donor_cmap[source]][0] * scale)
        # the left side bearing must equal xMin, or rasterizers slide the outline
        font["hmtx"][name] = (advance, glyph.xMin)


# ---- 2. Qamats qatan ------------------------------------------------------------------

for table in font["cmap"].tables:
    if table.isUnicode() and QAMATS in table.cmap:
        table.cmap.setdefault(QAMATS_QATAN, table.cmap[QAMATS])
cmap = font.getBestCmap()
glyphset = font.getGlyphSet()


# ---- 3. Geometry helpers --------------------------------------------------------------

def box(name):
    g = glyf[name]
    return g.xMin, g.yMin, g.xMax, g.yMax


def is_inside(name, x, y):
    pen = PointInsidePen(glyphset, (x, y))
    glyphset[name].draw(pen)
    return pen.getResult()


def counter_centre(name):
    """x of the middle of the widest empty gap across the letter at mid height
    (e.g. between the legs of tav); falls back to the middle of the ink."""
    x0, y0, x1, y1 = box(name)
    y = y0 + (y1 - y0) * 0.35
    inside = [is_inside(name, x, y) for x in range(x0, x1 + 1, 4)]
    gaps, start = [], None
    for i, ink in enumerate(inside):
        if not ink and start is None:
            start = i
        if ink and start is not None:
            gaps.append((start, i))
            start = None
    gaps = [g for g in gaps if g[0] > 0]  # ignore the outside of the letter
    if not gaps:
        return (x0 + x1) // 2
    a, b = max(gaps, key=lambda g: g[1] - g[0])
    return x0 + (a + b) * 2


def foot_centre(name):
    """x of the middle of the ink just above the baseline (the legs of the letter)."""
    x0, y0, x1, y1 = box(name)
    xs = [x for y in range(0, 160, 20) for x in range(x0, x1 + 1, 6) if is_inside(name, x, y)]
    return (min(xs) + max(xs)) // 2 if xs else (x0 + x1) // 2


def width(name):
    x0, y0, x1, y1 = box(name)
    return x1 - x0


# ---- 4. Collect letters and marks -----------------------------------------------------

letters = [cmap[c] for c in HEBREW_LETTERS if c in cmap]
foot_names = {cmap[c] for c in FOOT_CENTRED if c in cmap}

marks = {}  # glyph name -> code point (qamats qatan shares the qamats glyph)
for c in sorted(cmap):
    if is_mark(c) and glyf[cmap[c]].numberOfContours:
        marks.setdefault(cmap[c], c)

trop, niqqud = [], []  # marks under a letter: cantillation / vowel
fea = ["languagesystem DFLT dflt;", "languagesystem hebr dflt;"]
for name, cp in marks.items():
    x0, y0, x1, y1 = box(name)
    cx = (x0 + x1) // 2
    if cp in (0x5B9, 0x5BA):  # holam: above the left side of the letter
        mark_class, anchor = "holam", (cx, y0)
    elif cp == 0x5BC:  # dagesh / mappiq: inside the letter
        mark_class, anchor = "mid", (cx, (y0 + y1) // 2)
    elif (y0 + y1) / 2 > ABOVE_MARK_MIN_Y:
        mark_class, anchor = "above", (cx, y0)
    else:
        mark_class, anchor = "below", (cx - NUDGE.get(cp, 0), y1)
        (trop if cp < 0x5B0 else niqqud).append(name)
    fea.append(f"markClass {name} <anchor {anchor[0]} {anchor[1]}> @{mark_class};")


# ---- 5. Rules: every letter gets the same anchors -------------------------------------

anchors = {"below": [], "above": [], "mid": [], "holam": []}
for name in letters:
    x0, y0, x1, y1 = box(name)
    cx = (x0 + x1) // 2
    below_x = foot_centre(name) if name in foot_names else cx
    anchors["below"].append((name, below_x, min(BELOW_BASELINE, y0 - BELOW_CLEARANCE)))
    anchors["above"].append((name, cx, y1 + ABOVE_CLEARANCE))
    anchors["mid"].append((name, counter_centre(name), (y0 + y1) // 2 - DAGESH_DROP))
    anchors["holam"].append((name, x0 + (x1 - x0) // 5, y1 + ABOVE_CLEARANCE))

lookup_names = {"below": "centre_below", "above": "centre_above", "mid": "centre_mid", "holam": "holam_left"}
for mark_class, lookup in lookup_names.items():
    rules = " ".join(f"pos base {n} <anchor {x} {y}> mark @{mark_class};" for n, x, y in anchors[mark_class])
    fea.append(f"lookup {lookup} {{ {rules} }} {lookup};")


# ---- 6. A niqqud and a cantillation mark under one letter stand side by side ----------
# The second mark is attached to the first one, on its left.  (The shaper reorders
# marks, so both orders are covered.)

for name in trop:
    x0, y0, x1, y1 = box(name)
    fea.append(f"markClass {name} <anchor {x1 - NUDGE.get(marks[name], 0)} {y1}> @trop_beside;")
for name in niqqud:
    x0, y0, x1, y1 = box(name)
    fea.append(f"markClass {name} <anchor {x0} {y1}> @niqqud_beside;")

trop_after_niqqud = " ".join(
    f"pos mark {n} <anchor {box(n)[0] - GAP} {box(n)[3]}> mark @trop_beside;" for n in niqqud
)
niqqud_after_trop = " ".join(
    f"pos mark {n} <anchor {box(n)[2] + GAP - NUDGE.get(marks[n], 0)} {box(n)[3]}> mark @niqqud_beside;" for n in trop
)
fea.append("lookup trop_after_niqqud { " + trop_after_niqqud + " } trop_after_niqqud;")
fea.append("lookup niqqud_after_trop { " + niqqud_after_trop + " } niqqud_after_trop;")

# ...and the pair as a whole is centred under the letter: the first mark of the
# pair moves by half of the second mark's width plus the gap.
centre_pair = []
for t in trop:
    fea.append(f"lookup right_{t} {{ pos [{' '.join(niqqud)}] <{(width(t) + GAP) // 2} 0 0 0>; }} right_{t};")
    centre_pair.append(f"pos [{' '.join(niqqud)}]' lookup right_{t} {t};")
for n in niqqud:
    fea.append(f"lookup left_{n} {{ pos [{' '.join(trop)}] <-{(width(n) + GAP) // 2} 0 0 0>; }} left_{n};")
    centre_pair.append(f"pos [{' '.join(trop)}]' lookup left_{n} {n};")

fea.append(
    "feature mark { "
    + " ".join(f"lookup {lookup};" for lookup in lookup_names.values())
    + " lookup trop_after_niqqud; lookup niqqud_after_trop; "
    + " ".join(centre_pair)
    + " } mark;"
)


# ---- 7. Write the font ----------------------------------------------------------------

if "GPOS" in font:
    del font["GPOS"]
addOpenTypeFeaturesFromString(font, "\n".join(fea), tables=["GPOS"])
font.flavor = "woff"
font.save(OUT)
print("wrote", OUT)
