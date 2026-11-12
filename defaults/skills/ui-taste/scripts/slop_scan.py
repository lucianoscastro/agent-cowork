#!/usr/bin/env python3
"""Flag tells of generated UI in front-end source files.

Looks for default faces, violet/indigo palettes, the cream+terracotta and
near-black+acid combos, template chrome (eyebrows, arrows, 01/02/03), decorative
and scroll-driven motion, and stock copy in English and Portuguese.
A flag is a question, not a verdict: fix it, or keep it and say why.
Standard library only.

    python3 slop_scan.py PATH [PATH ...]    files and/or directories
    python3 slop_scan.py --self-test

Exit status: 0 nothing flagged, 1 findings, 2 usage error.
"""
import colorsys
import math
import os
import re
import sys

EXTS = {".html", ".htm", ".css", ".scss", ".sass", ".less", ".js", ".jsx", ".ts",
        ".tsx", ".vue", ".svelte", ".astro", ".mdx"}
STYLE_EXTS = {".css", ".scss", ".sass", ".less"}   # no copy rules: no user-visible text
PROSE_EXTS = {".md", ".mdx"}                        # copy rules on whole lines
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
             ".astro", "coverage", "vendor", ".turbo", ".cache", "storybook-static"}
MAX_BYTES = 1_000_000
SHOW = 6  # line numbers listed per finding


def _key(name):
    """'Space_Grotesk', 'space-grotesk', 'Inter var' -> 'spacegrotesk', 'inter'."""
    return re.sub(r"(variable|var|vf)$", "", re.sub(r"[^a-z0-9]", "", name.lower()))


FACES = {}
for _names, _why in (
    ("Inter, Inter Tight, Inter Display, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, "
     "Nunito, Nunito Sans, Source Sans Pro, Arial, Helvetica, Helvetica Neue",
     "a zero-decision default face"),
    ("Space Grotesk, Geist, Geist Sans, Geist Mono, Satoshi, Cabinet Grotesk, Clash Display, "
     "General Sans, Syne, Unbounded, Instrument Serif, Instrument Sans, Fraunces, Playfair Display, "
     "DM Sans, DM Serif Display, Plus Jakarta Sans, Manrope, Outfit, Urbanist, Sora, Cormorant, "
     "Cormorant Garamond, Bebas Neue, Oswald, Anton, Orbitron, Michroma, Press Start 2P, VT323, "
     "JetBrains Mono, Space Mono",
     "a face of the moment, picked because it is 'not Inter'"),
):
    for _n in _names.split(","):
        FACES[_key(_n)] = (_n.strip(), _why)

FONT_SOURCES = [re.compile(p) for p in (
    r"font-family\s*:\s*['\"]?([A-Za-z][\w \-]*?)['\"]?\s*[,;}!]",           # first family only
    r"[?&]family=([A-Za-z0-9+]+)",                                            # Google / Bunny URL
    r"@fontsource(?:-variable)?/([a-z0-9-]+)",
    r"\b(?:sans|serif|display|heading|body|mono)\s*:\s*\[\s*['\"]{1,2}([^'\"]+)",  # Tailwind config
    r"--font-[\w-]+\s*:\s*['\"]?([A-Za-z][\w \-]*?)['\"]?\s*[,;]",           # tokens, Tailwind @theme
    r"\bfont-\[['\"]?([A-Za-z][\w \-]*?)['\"]?[,\]]",                         # font-['Inter']
)]
NEXT_FONT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]next/font/google['\"]")
GEIST_PKG = re.compile(r"from\s*['\"]geist/font/")

HEX = re.compile(r"(?<!&)#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b", re.I)
OKLCH = re.compile(r"oklch\(\s*([\d.]+)(%?)\s+([\d.]+)%?\s+([\d.]+)", re.I)
HSL = re.compile(r"(?:hsla?\(\s*|--[\w-]+\s*:\s*)([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%", re.I)
TW_DEFAULTS = {"#6366f1", "#4f46e5", "#8b5cf6", "#7c3aed", "#a855f7", "#3b82f6", "#2563eb",
               "#10b981", "#0f172a", "#1e293b", "#64748b", "#f8fafc", "#09090b", "#18181b",
               "#71717a", "#f4f4f5", "#111827", "#6b7280", "#e5e7eb", "#f9fafb"}
NUMBERED = re.compile(r"""(?:>|["'`])\s*(0[1-9])\s*[./]?\s*(?:<|["'`])""")

# Comments are blanked (newlines kept, so line numbers hold) before scanning.
COMMENTS = re.compile(r"<!--.*?-->|(?:^[ \t]*|(?<=\{))/\*.*?\*/", re.S | re.M)
META_LINE = ("//", "* ", "import ", "@import", "export {", "require(")
# In code, copy is what sits in string literals, between tags, or alone on a text line.
COPY_SEGMENT = re.compile(r"\"((?:[^\"\\\n]|\\.)*)\"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)<")
CODE_HINT = re.compile(r"[;(){}=<>]|^\s*(?:const|let|var|return|if|else|function|export|case|type)\b")

# (id, copy_only, pattern, message): flagged on every matching line.
LINE_RULES = [(rid, copy_only, re.compile(rx, re.I), msg) for rid, copy_only, rx, msg in (
    ("violet", False,
     r"\b(?:from|via|to|bg|text|border|ring|shadow|fill|stroke|outline|decoration|accent|caret|divide)"
     r"-(?:indigo|violet|purple|fuchsia)-\d{2,3}\b",
     "indigo/violet/purple utility: the AI-product palette. Keep it only if the brand owns it."),
    ("gradient-text", False, r"\bbg-clip-text\b|background-clip\s*:\s*text",
     "gradient text: decoration standing in for a message. Let size, weight and words carry it."),
    ("glass", False, r"\bbackdrop-blur\b|backdrop-filter\s*:\s*blur",
     "glass/blur surface: keep blur for overlays above moving content, never as a card style."),
    ("hover-scale", False, r"\b(?:group-)?hover:scale-(?:10[5-9]|1[1-9]\d)\b",
     "hover scale of 1.05 or more: decorative motion. Interactive things answer subtly "
     "(a 1-2px lift, a colour step); static things stay still."),
    ("decor-motion", False,
     r"\banimate-(?:bounce|ping|float|blob|aurora|glow|marquee|gradient)\b"
     r"|@keyframes\s+(?:float|blob|aurora|glow|marquee|ticker|typewriter|gradient)"
     r"|<marquee\b|react-fast-marquee|feTurbulence|\b(?:grain|noise)-(?:overlay|texture|bg)\b"
     r"|\brounded-full\b[^\n]*\bblur-(?:2xl|3xl)\b|\bblur-(?:2xl|3xl)\b[^\n]*\brounded-full\b",
     "decorative atmosphere (floating blobs, glow, marquee, grain): cut it, or make it the one "
     "signature with a stated purpose."),
    ("scroll-motion", False,
     r"\bwhileInView\b|\bdata-aos\b|\bAOS\.init\b|\bScrollReveal\b|\buseInView\b"
     r"|\bIntersectionObserver\b|\bparallax\b|\blenis\b|locomotive-scroll|\bScrollSmoother\b"
     r"|vanilla-tilt|parallax-tilt|\bmagnetic\b",
     "scroll reveal / parallax / smooth scroll / tilt / magnetic: the generic motion kit. Nothing "
     "moves because the page scrolled, except one deliberate moment."),
    ("emoji", True, "[\U0001F300-\U0001FAFF✨⚡⭐✅❌]",
     "emoji as icon, bullet or garnish: use one icon set, or none."),
    ("slop-word", True,
     r"\b(?:elevates?|unlock(?:s|ed|ing)?|unleash(?:es|ed)?|empower(?:s|ed|ing)?|supercharged?"
     r"|turbocharged?|seamless(?:ly)?|effortless(?:ly)?|cutting-edge|revolutionary"
     r"|revolutioni[sz]e[sd]?|transformative|game-chang(?:er|ing)|next-level|world-class"
     r"|best-in-class|state-of-the-art|synerg(?:y|ies)|reimagine[sd]?|delve|tapestry|embark"
     r"|beacon|plethora|myriad|unparalleled|nestled|curated|eleve|desbloqueie|potencialize"
     r"|impulsione|alavanque|revolucione|revolucionári[oa]s?|inovador(?:a|es|as)?"
     r"|de ponta(?! a ponta)|ecossistema)\b",
     "stock word standing in for a fact: write the fact (the step, the number, the thing), "
     "not a synonym."),
    ("stock-phrase", True,
     r"in today[’']s fast-paced|unlock the power|say goodbye to|whether you[’']re|join thousands"
     r"|look no further|at your fingertips|in just a few clicks|it[’']s not just|all-in-one"
     r"|one-stop|ready to (?:transform|get started|take)|the future of [\w ]{2,30} is here"
     r"|tudo em um só lugar|sem complicaç|de forma simples e rápida|próximo nível"
     r"|pronto para começar|feito para você|não é (?:só|apenas)|diga adeus|junte-se a milhares"
     r"|com apenas alguns cliques|solução completa|experiência (?:única|incrível)",
     "stock line that fits any company: say what this one does, for whom."),
    ("fake-content", True,
     r"lorem ipsum|\[company name\]|\bacme\b|\bnorthwind\b|\bcontoso\b|john doe|jane doe"
     r"|\bfieldnote\b|\bkestrel\b|\bhalcyon\b|\bbrightloop\b|\bpriya\b|\bokafor\b|fulano de tal"
     r"|jo[aã]o (?:da )?silva|maria (?:da )?silva",
     "placeholder or default-cast name: names come from the brief, mock data fits its market, "
     "placeholders are never dressed as real."),
    ("proof-figure", True,
     r"\b\d{1,3}(?:[.,]\d{3})*[km]?\+(?=[\s<'\"`]|$)|\b99[.,]9+\s?%|\b24/7\b"
     r"|\b\d+(?:[.,]\d)?x\s+(?:faster|more|better|mais)",
     "round, unsourced proof figure (10k+, 99.9%, 24/7, 5x): only figures from the brief, each in "
     "the sentence it proves."),
    ("template-label", True,
     r"\bmost popular\b|\bmais popular\b|\btrusted by\b|\bget started\b|\blearn more\b"
     r"|\bsaiba mais\b|\bcomece agora\b|\bclique aqui\b|\bclick here\b",
     "template label: name the action and its object ('Book a table', 'Read the API guide')."),
    ("ui-stock", True,
     r"\bwelcome back\b|\bbem-vindo de volta\b|something went wrong|algo deu errado"
     r"|\bno data(?: yet| available)?(?![\w-])|\bnenhum dado\b|\boops\b",
     "stock product-UI copy: say what happened and what to do, or what will appear here and the "
     "action that fills it."),
)]

# (id, copy_only, pattern, minimum per file, message): flagged only when frequent.
COUNT_RULES = [(rid, copy_only, re.compile(rx, re.I), minimum, msg)
               for rid, copy_only, rx, minimum, msg in (
    ("eyebrow", False,
     r"\buppercase\b[^\"'`\n]*?\btracking-(?:wide|\[)"
     r"|\btracking-(?:wide|\[)[^\"'`\n]*?\buppercase\b|text-transform\s*:\s*uppercase", 3,
     "tracked all-caps labels on many elements (eyebrows above headings): template chrome. "
     "Keep 1-2 that carry information."),
    ("arrow", False, r"→|&rarr;|&#8594;|<(?:ArrowRight|ArrowUpRight|MoveRight)\b", 3,
     "an arrow on many links or buttons: keep it only where it means 'goes elsewhere'."),
    ("middot", True, r"\s(?:·|&middot;|&#183;)\s", 3,
     "'A · B · C' meta strings: write the facts as a sentence or a real list."),
    ("em-dash", True, r"—|&mdash;|&#8212;", 6,
     "em dashes as a tic: vary the punctuation instead of deleting them all."),
    ("contrast-frame", True,
     r"\bnot just\b|\bisn[’']t just\b|\bnot only\b|\brather than\b|\binstead of\b|\bwithout the\b"
     r"|\bnão é (?:só|apenas)\b|\bem vez de\b|\bao invés de\b", 3,
     "'not X but Y' and its substitutes over the budget of 2: state the positive fact alone."),
    ("virtue", True,
     r"\b(?:honest(?:ly)?|calm|quiet(?:ly)?|genuine(?:ly)?|truly|simply|thoughtful(?:ly)?"
     r"|carefully|intentional(?:ly)?)\b", 3,
     "virtue words about ourselves (honest, calm, simply...): show it with a fact instead."),
    ("kpi-chip", True, r"[+↑▲]\s?\d{1,3}(?:[.,]\d+)?\s?%", 2,
     "'+12.5%' change chips: give each number its period and comparison, and lead with what "
     "needs action."),
    ("radius", False, r"\brounded-(?:2xl|3xl)\b", 8,
     "one large radius on everything: radius follows size and hierarchy (nested = outer minus "
     "padding)."),
)]


def fonts_in(line):
    names = []
    for rx in FONT_SOURCES:
        names += rx.findall(line)
    for group in NEXT_FONT.findall(line):
        names += [n.strip().split(" as ")[0] for n in group.split(",") if n.strip()]
    if GEIST_PKG.search(line):
        names.append("Geist")
    return [k for k in dict.fromkeys(_key(n) for n in names) if k in FACES]


def _oklch_rgb(lightness, chroma, hue):
    """OKLCH -> gamma-encoded sRGB in 0..1 (Ottosson's OKLab matrices), clamped."""
    a, b = chroma * math.cos(math.radians(hue)), chroma * math.sin(math.radians(hue))
    l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    linear = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
              -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
              -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    clamp = (min(max(x, 0.0), 1.0) for x in linear)
    return tuple(12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055 for x in clamp)


def colours_in(line):
    """Yield (literal, (r, g, b)) for hex, hsl() / bare-HSL tokens and oklch() colours."""
    for m in HEX.finditer(line):
        digits = m.group(1)
        digits = "".join(c * 2 for c in digits[:3]) if len(digits) <= 4 else digits[:6]
        yield m.group(0), tuple(int(digits[i:i + 2], 16) / 255 for i in (0, 2, 4))
    for m in HSL.finditer(line):
        hue, sat, light = float(m.group(1)), float(m.group(2)), float(m.group(3))
        if hue <= 360 and sat <= 100 and light <= 100:
            yield m.group(0).strip(), colorsys.hls_to_rgb(hue / 360, light / 100, sat / 100)
    for m in OKLCH.finditer(line):
        lightness = float(m.group(1)) / (100 if m.group(2) else 1)
        yield m.group(0) + ")", _oklch_rgb(lightness, float(m.group(3)), float(m.group(4)))


def classify(rgb):
    hue, light, sat = colorsys.rgb_to_hls(*rgb)
    hue *= 360
    if 235 <= hue <= 300 and sat >= 0.3 and 0.25 <= light <= 0.97:
        return "violet"
    if 25 <= hue <= 55 and 0.15 <= sat <= 0.85 and 0.89 <= light <= 0.975:
        return "cream"
    if 5 <= hue <= 45 and 0.35 <= sat < 0.85 and 0.38 <= light <= 0.68:
        return "clay"
    if 0 < light < 0.13:
        return "near-black"
    if 65 <= hue <= 125 and sat >= 0.7 and 0.4 <= light <= 0.8:
        return "acid"
    if (hue <= 20 or hue >= 350) and sat >= 0.85 and 0.42 <= light <= 0.6:
        return "vermilion"
    return None


def copy_of(line, kind):
    """The user-visible text a copy rule may judge on this line."""
    if kind == "style" or line.lstrip().startswith(META_LINE):
        return ""
    if kind == "prose":
        return line
    parts = [next(g for g in m.groups() if g is not None) for m in COPY_SEGMENT.finditer(line)]
    if not parts and not CODE_HINT.search(line) and len(line.split()) >= 2:
        parts = [line]  # a bare text line inside JSX or a template
    return "\n".join(parts)


def scan_text(text, kind="code"):
    """kind: 'code' (markup and scripts), 'style' or 'prose'. Returns [(line_no, rule_id, message)]."""
    text = COMMENTS.sub(lambda m: re.sub(r"[^\n]", " ", m.group()), text)
    flags, counts, families, tw_hex, numbered = [], {}, {}, {}, {}
    for no, line in enumerate(text.splitlines(), 1):
        copy = copy_of(line, kind)
        for rid, copy_only, rx, msg in LINE_RULES:
            if rx.search(copy if copy_only else line):
                flags.append((no, rid, msg))
        for rid, copy_only, rx, _minimum, _msg in COUNT_RULES:
            counts.setdefault(rid, []).extend([no] * len(rx.findall(copy if copy_only else line)))
        for key in fonts_in(line):
            name, why = FACES[key]
            flags.append((no, "face", f"{name}: {why}. Choose from the subject "
                                      "(references/type-color.md), or keep it with a reason."))
        for literal, rgb in colours_in(line):
            colour_kind = classify(rgb)
            if colour_kind == "violet":
                flags.append((no, "violet", f"{literal}: violet/indigo/lavender hue, the AI-product "
                                            "palette. Keep it only if the brand owns it."))
            elif colour_kind:
                families.setdefault(colour_kind, no)
            if literal.lower() in TW_DEFAULTS:
                tw_hex.setdefault(literal.lower(), no)
        for m in NUMBERED.finditer(line):
            numbered.setdefault(m.group(1), no)

    for rid, _copy_only, _rx, minimum, msg in COUNT_RULES:
        if len(counts.get(rid, [])) >= minimum:
            flags += [(no, rid, msg) for no in counts[rid]]
    if "cream" in families and "clay" in families:
        flags.append((families["cream"], "palette-combo",
                      "warm cream ground with a clay/terracotta/brass accent: the commonest "
                      "'tasteful' default. Derive the palette from the subject's anchors."))
    if "near-black" in families and ({"acid", "vermilion"} & families.keys()):
        flags.append((families["near-black"], "palette-combo",
                      "near-black ground with one acid-green or vermilion accent: the 'bold' "
                      "default. Go dark only when the subject lives in the dark."))
    if len(tw_hex) >= 3:
        flags += [(no, "framework-palette", "unmodified Tailwind palette values as the brand: tune "
                   "them, or start from the subject's anchors.") for no in tw_hex.values()]
    if {"01", "02", "03"} <= numbered.keys():
        flags += [(numbered[k], "numbered", "01 / 02 / 03 markers: number only real sequences "
                   "(steps, timelines, rankings).") for k in ("01", "02", "03")]
    return flags


def group(flags):
    """{(rule_id, message): sorted line numbers}, in order of first appearance."""
    groups = {}
    for no, rid, msg in sorted(flags):
        groups.setdefault((rid, msg), []).append(no)
    return {key: sorted(set(nos)) for key, nos in groups.items()}


def kind_of(path):
    ext = os.path.splitext(path)[1].lower()
    return "style" if ext in STYLE_EXTS else "prose" if ext in PROSE_EXTS else "code"


def iter_files(paths):
    for path in paths:
        if os.path.isfile(path):
            yield path
            continue
        for root, dirs, files in os.walk(path):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() in EXTS and ".min." not in name:
                    yield os.path.join(root, name)


def main(argv):
    paths = argv[1:]
    if paths == ["--self-test"]:
        return self_test()
    if not paths or any(p.startswith("-") for p in paths):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        print("not found: " + ", ".join(missing), file=sys.stderr)
        return 2

    scanned, per_rule = 0, {}
    for path in iter_files(paths):
        try:
            if os.path.getsize(path) > MAX_BYTES:
                continue
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError as exc:
            print(f"skipped {path}: {exc}", file=sys.stderr)
            continue
        scanned += 1
        groups = group(scan_text(text, kind_of(path)))
        if not groups:
            continue
        shown = os.path.relpath(path)
        print(path if shown.startswith("..") else shown)
        for (rid, msg), nos in groups.items():
            where = ", ".join(map(str, nos[:SHOW])) + (f" (+{len(nos) - SHOW})" if len(nos) > SHOW else "")
            print(f"  [{rid}] line {where}: {msg}")
            per_rule[rid] = per_rule.get(rid, 0) + 1

    total = sum(per_rule.values())
    if not total:
        print(f"No tells found in {scanned} file(s). Still look at the render: composition-level "
              "tells are not in the code.")
        return 0
    summary = ", ".join(f"{rid} {n}" for rid, n in sorted(per_rule.items(), key=lambda kv: -kv[1]))
    print(f"\n{total} finding(s) in {scanned} file(s) scanned: {summary}.\n"
          "Each finding is a question: fix it, or keep it and say why (the brief, the brand).")
    return 1


SLOPPY = """<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
import { Space_Grotesk } from "next/font/google";
<style>
  :root { --bg: #F4F1EA; --accent: #D97757; --glow: #8B5CF6; }
</style>
<section class="text-center">
  <span class="text-xs uppercase tracking-widest">New</span>
  <h1 class="bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">Unlock the power of seamless workflows</h1>
  <p class="uppercase tracking-wider">Features</p><p class="uppercase tracking-wider">Pricing</p>
  <div class="backdrop-blur-md hover:scale-105">✨ Trusted by 10k+ teams</div>
  <div class="absolute rounded-full bg-purple-500 blur-3xl"></div>
  <motion.div whileInView={{ opacity: 1 }}>Priya Raman, Acme Inc.</motion.div>
  <span>01</span><span>02</span><span>03</span>
  <a>Learn more →</a><a>Docs →</a><a>Blog →</a>
</section>
"""

CLEAN = """<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap" rel="stylesheet">
<style>:root { --ground: #F2F5F3; --ink: #17201B; --accent: #1F5C99; --line: oklch(0.86 0.01 160); }</style>
<!-- no data-ground here: unlock nothing -->
<main>
  <h1>Bike repairs in Pinheiros, usually the same day</h1>
  <p>Bring it in before 11:00 and ride home after 18:00. Flat tyre: R$ 40.</p>
  <a class="button" href="/book">Book a repair</a>
</main>
"""

SCRIPT = """const unlock = () => setOpen(false);
const centre = width / 2 + offset;
export const Hero = () => <h1 className="text-5xl">Unlock the power of your data</h1>;
"""

STYLE = """.hero--quiet { color: #1d2b24; } /* calm side */
.card[data-calm] { padding: 24px; }
.simply { margin: 0; }
"""


def self_test():
    expected = {"face", "violet", "gradient-text", "glass", "hover-scale", "decor-motion",
                "scroll-motion", "emoji", "slop-word", "stock-phrase", "fake-content",
                "proof-figure", "template-label", "eyebrow", "arrow", "palette-combo", "numbered"}
    sloppy = scan_text(SLOPPY)
    found = {rid for _, rid, _ in sloppy}
    faces = {msg.split(":")[0] for _, rid, msg in sloppy if rid == "face"}
    script = {(no, rid) for no, rid, _ in scan_text(SCRIPT)}
    problems = []
    if expected - found:
        problems.append(f"sloppy sample missed: {sorted(expected - found)}")
    if faces != {"Inter", "Space Grotesk"}:
        problems.append(f"faces found: {sorted(faces)}")
    for name, text, kind in (("clean", CLEAN, "code"), ("style", STYLE, "style")):
        if scan_text(text, kind):
            problems.append(f"{name} sample flagged: {sorted({r for _, r, _ in scan_text(text, kind)})}")
    if script != {(3, "slop-word"), (3, "stock-phrase")}:
        problems.append(f"script sample: expected copy flags on line 3 only, got {sorted(script)}")
    if classify(_oklch_rgb(0.585, 0.233, 277.1)) != "violet":  # Tailwind v4 indigo-500
        problems.append("oklch indigo not classified as violet")
    print("self-test: " + ("ok" if not problems else "FAILED\n  " + "\n  ".join(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
