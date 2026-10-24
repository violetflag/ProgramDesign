#!/usr/bin/env node
// WCAG 2.x contrast for colour pairs. Give pairs on the command line or in a JSON file.
//
//   node contrast.js "#5b5b57" "#ffffff"                 → one pair
//   node contrast.js pairs.json                           → many pairs
//   node contrast.js --css app/src/index.css              → every --color-* token against the light surface
//                                                            (and, under [data-theme="dark"], against the dark one)
//
// pairs.json: [{ "label": "주 버튼 글자", "fg": "#ffffff", "bg": "#3b7f5c", "need": 4.5 }, ...]
//   need: 4.5 text, 3 large text (24px / 19px bold) and non-text (borders, icons, focus rings)
//
// Tailwind v4 default colours are oklch; the few that come up in reviews are given as sRGB below, so a
// pair like "amber-800 on amber-50" can be written by name.
const fs = require("fs");

const NAMED = {
  "yellow-100": "#fef9c2", "yellow-200": "#fff085", "green-100": "#dcfce7", "pink-100": "#fce7f3", "sky-100": "#dff2fe",
  "amber-50": "#fffbeb", "amber-100": "#fef3c6", "amber-300": "#ffd230", "amber-400": "#ffb900", "amber-500": "#fd9a00",
  "amber-600": "#e17100", "amber-700": "#bb4d00", "amber-800": "#973c00", "amber-900": "#7b3306",
  "red-50": "#fef2f2", "red-200": "#ffc9c9", "red-600": "#e7000b", "red-700": "#c10007",
  "gray-400": "#99a1af", "gray-500": "#6a7282", "violet-700": "#7008e7", "sky-500": "#00a6f4",
};

const hex = (h) => {
  h = (NAMED[h] ?? h).replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return h.match(/.{2}/g).map((x) => parseInt(x, 16) / 255);
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** alpha-blend fg over bg when fg is given as "#rrggbb@0.7" */
const flatten = (fg, bg) => {
  const m = /^([^@]+)@([\d.]+)$/.exec(fg);
  if (!m) return fg;
  const a = Number(m[2]);
  const f = hex(m[1]);
  const b = hex(bg);
  return "#" + f.map((c, i) => Math.round((c * a + b[i] * (1 - a)) * 255).toString(16).padStart(2, "0")).join("");
};
const ratio = (fg, bg) => {
  const [x, y] = [lum(flatten(fg, bg)), lum(bg)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const verdict = (r, need) => (r >= need ? "✅" : r >= need - 0.5 ? "🟡" : "❌");

/** The pairs a review actually checks: text tokens on the surface, the boundary token as a border,
 *  and white text on the action colours. Tints (-50…-300) are backgrounds and are skipped. */
function fromCss(file) {
  const css = fs.readFileSync(file, "utf8");
  const [light, dark = ""] = css.split(/:root\[data-theme="dark"\]/);
  const rows = [];
  for (const [theme, text] of [["light", light], ["dark", dark]]) {
    const tokens = Object.fromEntries([...text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
    const surface = tokens.surface ?? (theme === "light" ? "#ffffff" : "#1d1d1b");
    for (const [name, value] of Object.entries(tokens)) {
      const m = /^([a-z]+)-(\d+)$/.exec(name);
      if (name === "line") rows.push({ label: `${theme} line as border on surface`, fg: value, bg: surface, need: 3 });
      else if (name === "time") rows.push({ label: `${theme} time text on surface`, fg: value, bg: surface, need: 4.5 });
      else if (!m) continue;
      else if (m[1] === "gray" && Number(m[2]) >= 400) rows.push({ label: `${theme} ${name} text on surface`, fg: value, bg: surface, need: 4.5 });
      else if (m[1] !== "gray" && (m[2] === "500" || m[2] === "600")) rows.push({ label: `${theme} white text on ${name}`, fg: "#ffffff", bg: value, need: 4.5 });
      else if (m[1] !== "gray" && Number(m[2]) >= 700) rows.push({ label: `${theme} ${name} text on surface`, fg: value, bg: surface, need: 4.5 });
    }
  }
  return rows;
}

const args = process.argv.slice(2);
let pairs;
if (args[0] === "--css") pairs = fromCss(args[1]);
else if (args.length === 1 && args[0].endsWith(".json")) pairs = JSON.parse(fs.readFileSync(args[0], "utf8"));
else if (args.length >= 2) pairs = [{ label: `${args[0]} on ${args[1]}`, fg: args[0], bg: args[1], need: Number(args[2] ?? 4.5) }];
else {
  console.error("usage: node contrast.js <fg> <bg> [need] | pairs.json | --css index.css");
  process.exit(2);
}
console.log("| 쌍 | 대비 | 기준 | 판정 |\n|---|---|---|---|");
for (const p of pairs) {
  const r = ratio(p.fg, p.bg);
  console.log(`| ${p.label} (${p.fg} / ${p.bg}) | ${r.toFixed(2)}:1 | ${p.need ?? 4.5}:1 | ${verdict(r, p.need ?? 4.5)} |`);
}
