#!/usr/bin/env node
// Keyboard-only pass: real Tab presses. Where does focus land, is :focus-visible shown, what name
// would a screen reader get, how big is the target. Also lists interactive targets under 24px.
//
//   node keyboard_pass.js plan.json
//
// plan.json:
// {
//   "url": "http://localhost:1420/", "ready": "text=바로 녹음", "initScript": "mock.js", "out": "shots",
//   "tests": [
//     { "name": "home tab order", "tabs": 14 },
//     { "name": "list rows", "click": { "role": "button", "name": "모든 노트" }, "focus": "input[placeholder*='찾기']", "tabs": 8 },
//     { "name": "row menu Shift+F10", "focus": "[data-note-row]", "press": ["Shift+F10"], "report": "active" },
//     { "name": "menu Escape", "press": ["Escape"], "report": "active" },
//     { "name": "palette focus restore", "focus": "input[aria-label='노트 제목']", "press": ["Control+k", "Escape"], "report": "active" },
//     { "name": "small targets", "small": true }
//   ]
// }
// Each test runs in order on the same page: optional click → focus → presses → N tabs (each logged) →
// report ("active" logs the focused element) → small (targets under 24px). Output: out/keyboard.json
// and a screenshot per test (k_<index>.png) with focus where it ended.
const fs = require("fs");
const path = require("path");

// playwright is usually global (NODE_PATH); axe-core is looked up next to the plan, in the working
// folder, beside this script, and on NODE_PATH. If missing: `npm i axe-core` in the working folder.
function need(name, paths) {
  try {
    return require.resolve(name, { paths });
  } catch {
    console.error(`cannot find ${name}. Run: npm i ${name.split("/")[0]} (in ${paths[0]})`);
    process.exit(2);
  }
}
const { chromium } = require(need("playwright", [process.cwd(), __dirname, ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean)]));

const planPath = process.argv[2];
if (!planPath) {
  console.error("usage: node keyboard_pass.js plan.json");
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const base = path.dirname(path.resolve(planPath));
const OUT = path.resolve(base, plan.out ?? "shots");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // the accessible name as far as attributes tell it (a full computation needs the AX tree)
    const labelled = el.getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    const name = el.getAttribute("aria-label") || labelled || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) || (el.textContent || "").trim().slice(0, 40) || el.getAttribute("placeholder") || el.getAttribute("title") || "";
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      name,
      focusVisible: el.matches(":focus-visible"),
      outline: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : "none",
      outlineOffset: cs.outlineOffset,
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      clipped: (() => {
        let p = el.parentElement;
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflow;
          if (o === "hidden" || o === "clip") return p.tagName.toLowerCase() + (p.className ? "." + String(p.className).split(" ")[0] : "");
          p = p.parentElement;
        }
        return null;
      })(),
    };
  });

const small = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, [role=button], input:not([type=hidden]), select, a[href], [tabindex='0']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 24 || r.height < 24) out.push({ name: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30) || el.tagName, size: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
    return out.slice(0, 60);
  });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: plan.viewport ?? { width: 1280, height: 800 }, locale: plan.locale ?? "ko-KR" });
  if (plan.initScript) await ctx.addInitScript(fs.readFileSync(path.resolve(base, plan.initScript), "utf8"));
  const page = await ctx.newPage();
  await page.goto(plan.url);
  if (plan.ready) await page.waitForSelector(plan.ready, { timeout: 60000 });
  await sleep(800);
  const log = [];
  let i = 0;
  for (const tst of plan.tests) {
    i++;
    const entry = { test: tst.name };
    try {
      if (tst.click) {
        const c = tst.click;
        const loc = c.selector ? page.locator(c.selector) : page.getByRole(c.role ?? "button", { name: c.name, exact: c.exact ?? false });
        await loc.first().click();
        await sleep(c.wait ?? 500);
      }
      if (tst.focus) await page.locator(tst.focus).first().focus();
      for (const k of tst.press ?? []) {
        await page.keyboard.press(k);
        await sleep(250);
      }
      if (tst.tabs) {
        entry.order = [];
        for (let n = 0; n < tst.tabs; n++) {
          await page.keyboard.press("Tab");
          entry.order.push(await active(page));
        }
        entry.notVisible = entry.order.filter((o) => o && o.tag !== "body" && !o.focusVisible).map((o) => `${o.tag} ${o.name}`);
      }
      if (tst.report === "active" || tst.press) entry.focus = await active(page);
      if (tst.small) entry.small = await small(page);
      await page.screenshot({ path: path.join(OUT, `k_${String(i).padStart(2, "0")}.png`) });
    } catch (e) {
      entry.error = String(e).split("\n")[0].slice(0, 300);
    }
    log.push(entry);
    console.log(JSON.stringify({ test: entry.test, focus: entry.focus?.name, tabs: entry.order?.length, notVisible: entry.notVisible?.length, small: entry.small?.length, error: entry.error }));
  }
  fs.writeFileSync(path.join(OUT, "keyboard.json"), JSON.stringify(log, null, 2));
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
