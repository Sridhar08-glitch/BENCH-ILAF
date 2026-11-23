"""Three starter templates a designer can copy into a new face. They are written in the template language (see
sanitize.py and the README) and are also used by the tests and the documentation."""

STARTERS = {
    "clean": {
        "name": "Clean, left aligned",
        "tags": ["corporate", "minimal"],
        "template": """<div class="edge"></div>
<div class="hd">
  <div class="co">{{company}}</div>
  <div class="n">{{name}}</div>
  <div class="t1">{{title}}</div>
</div>
<div class="pw">{{photo}}</div>
<div class="cl">{{phone_line}}{{email_line}}{{web_line}}</div>
{{#if logo}}<div class="lg">{{logo}}</div>{{/if}}
""",
        "css": """.edge{position:absolute;left:0;top:0;bottom:0;width:2.4cqw;background:var(--cacc)}
.hd{position:absolute;left:8cqw;top:9cqw;right:32cqw}
.co{font-size:2.3cqw;letter-spacing:.18em;text-transform:uppercase;opacity:.7}
.n{font-size:7cqw;font-weight:800;line-height:1.05;margin-top:2cqw;letter-spacing:-.02em}
.t1{font-size:3cqw;margin-top:1.4cqw;opacity:.85}
.pw{position:absolute;right:8cqw;top:9cqw;width:20cqw;height:20cqw;border-radius:50%;overflow:hidden;box-shadow:0 0 0 .8cqw var(--cacc)}
.cl{position:absolute;left:8cqw;bottom:8cqw;display:grid;gap:1.2cqw}
.lg{position:absolute;right:8cqw;bottom:8cqw;width:18cqw;height:8cqw}
.lg .cfm{width:100%;height:100%;object-fit:contain;object-position:right bottom}
""",
        "palettes": [
            {"name": "Ink", "bg": "#101114", "bg2": "#1b1d22", "fg": "#f6f7f9", "acc": "#ff6b35", "on": "#101114"},
            {"name": "Paper", "bg": "#ffffff", "bg2": "#f1f2f4", "fg": "#101114", "acc": "#e8531f", "on": "#ffffff"},
            {"name": "Ocean", "bg": "#0b1f3a", "bg2": "#12305a", "fg": "#ffffff", "acc": "#60a5fa", "on": "#0b1f3a"},
            {"name": "Forest", "bg": "#0e2a22", "bg2": "#14392d", "fg": "#ecfdf5", "acc": "#34d399", "on": "#06231a"},
        ],
    },
    "monogram": {
        "name": "Centred monogram",
        "tags": ["luxury", "minimal"],
        "template": """<div class="fr"></div>
<div class="md">
  <div class="mk">{{initials}}</div>
  <div class="n">{{name}}</div>
  <div class="t1">{{title}}</div>
  <div class="rl"></div>
  <div class="cl">{{phone_line}}{{email_line}}</div>
</div>
{{#if logo}}<div class="lg">{{logo}}</div>{{/if}}
""",
        "css": """.fr{position:absolute;inset:3cqw;border:.25cqw solid var(--cacc);border-radius:1.6cqw;opacity:.7}
.md{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.mk{width:12cqw;height:12cqw;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--cacc);color:var(--con);font-size:4.4cqw;font-weight:800}
.n{font-size:5.6cqw;font-weight:700;line-height:1.1;margin-top:2.4cqw}
.t1{font-size:2.6cqw;letter-spacing:.14em;text-transform:uppercase;margin-top:1cqw;opacity:.8}
.rl{width:9cqw;height:.3cqw;background:var(--cacc);margin:2.6cqw 0}
.cl{display:grid;gap:.9cqw;justify-items:center}
.lg{position:absolute;left:0;right:0;bottom:4.6cqw;height:5cqw;display:flex;justify-content:center}
.lg .cfm{height:100%;width:auto;max-width:30cqw;object-fit:contain}
""",
        "palettes": [
            {"name": "Ivory", "bg": "#faf7f0", "bg2": "#ede6d6", "fg": "#1b1a17", "acc": "#a95a17", "on": "#ffffff"},
            {"name": "Night", "bg": "#0f1424", "bg2": "#1a2238", "fg": "#f2f5ff", "acc": "#7fa2ff", "on": "#0b1020"},
            {"name": "Rose", "bg": "#2b1220", "bg2": "#3d1a2e", "fg": "#fff1f5", "acc": "#fb7185", "on": "#2b1220"},
            {"name": "Slate", "bg": "#1f2933", "bg2": "#2b3a47", "fg": "#f5f7fa", "acc": "#fbbf24", "on": "#1f2933"},
        ],
    },
    "split": {
        "name": "Split colour block",
        "tags": ["bold", "corporate"],
        "template": """<div class="blk">
  <div class="pw">{{photo}}</div>
  {{#if logo}}<div class="lg">{{logo}}</div>{{/if}}
</div>
<div class="sd">
  <div class="co">{{company}}</div>
  <div class="n">{{name}}</div>
  <div class="t1">{{title}}</div>
  <div class="cl">{{phone_line}}{{email_line}}{{web_line}}</div>
</div>
""",
        "css": """.blk{position:absolute;left:0;top:0;bottom:0;width:36cqw;background:var(--cacc);color:var(--con)}
.pw{position:absolute;left:5cqw;top:6cqw;width:26cqw;height:26cqw;border-radius:2.4cqw;overflow:hidden;background:var(--cbg2)}
.lg{position:absolute;left:5cqw;right:5cqw;bottom:6cqw;height:8cqw}
.lg .cfm{width:100%;height:100%;object-fit:contain;object-position:left bottom}
.sd{position:absolute;left:42cqw;right:6cqw;top:8cqw;bottom:7cqw;display:flex;flex-direction:column}
.co{font-size:2.3cqw;letter-spacing:.16em;text-transform:uppercase;opacity:.7}
.n{font-size:6.2cqw;font-weight:800;line-height:1.05;margin-top:1.6cqw}
.t1{font-size:2.9cqw;margin-top:1.2cqw;opacity:.85}
.cl{display:grid;gap:1.1cqw;margin-top:auto}
""",
        "palettes": [
            {"name": "Sun", "bg": "#101114", "bg2": "#1b1d22", "fg": "#f6f7f9", "acc": "#ffb020", "on": "#101114"},
            {"name": "Coral", "bg": "#ffffff", "bg2": "#f6f1ec", "fg": "#101114", "acc": "#ff6b35", "on": "#101114"},
            {"name": "Azure", "bg": "#0b1f3a", "bg2": "#12305a", "fg": "#ffffff", "acc": "#3b82f6", "on": "#ffffff"},
            {"name": "Mint", "bg": "#10231d", "bg2": "#173528", "fg": "#ecfdf5", "acc": "#10b981", "on": "#04251a"},
        ],
    },
}
