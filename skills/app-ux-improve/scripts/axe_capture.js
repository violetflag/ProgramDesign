#!/usr/bin/env node
// Screens → PNG + axe-core. Drives a running web app (or a desktop app's web view, with a shell mock)
// through a list of steps and leaves one screenshot and one axe result per screen.
//
//   node axe_capture.js plan.json
//
// plan.json:
// {
//   "url": "http://localhost:1420/",
//   "ready": "text=바로 녹음",                 // a selector that means the app has loaded
//   "initScript": "mock.js",                   // optional: a file run before the page scripts (shell mock)
//   "viewport": { "width": 1280, "height": 800 },
//   "out": "shots",                            // where PNGs and results.json go
//   "locale": "ko-KR",
//   "steps": [
//     { "name": "01_home", "axe": "home" },
//     { "name": "03_list", "click": { "role": "button", "name": "모든 노트", "within": "nav[aria-label='메뉴']" }, "axe": "list" },
//     { "name": "11_note", "click": { "selector": "[data-note-row]" }, "wait": 800, "axe": "note" },
//     { "name": "12_tab", "click": { "role": "tab", "name": "스크립트" } },
//     { "name": "20_dark", "evaluate": "document.documentElement.setAttribute('data-theme','dark')" },
//     { "name": "30_narrow", "viewport": { "width": 640, "height": 400 } },
//     { "name": "40_key", "press": "Escape" },
//     { "name": "50_type", "fill": { "selector": "#q", "text": "…" } },
//     { "name": "60_route", "route": { "url": "**/live/*", "status": 200, "body": { "...": "..." } } },
//     { "name": "61_unroute", "unroute": "**/live/*" },
//     { "name": "70_full", "full": true }      // full-page screenshot
//   ]
// }
// A step may have any mix of click / fill / press / evaluate / viewport / route / unroute; they run in
// that order, then `wait` (ms, default 500), then the screenshot (if `name`), then axe (if `axe`).
// `name` matching: a string is a substring match (so "할 일" finds "할 일 5"); "/…/" is a RegExp.
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
  console.error("usage: node axe_capture.js plan.json");
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const base = path.dirname(path.resolve(planPath));
const OUT = path.resolve(base, plan.out ?? "shots");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(need("axe-core/axe.min.js", [base, process.cwd(), __dirname, ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean)]), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { axe: {}, errors: [] };

const nameOf = (s) => (typeof s === "string" && /^\/.*\/$/.test(s) ? new RegExp(s.slice(1, -1)) : s);

async function locate(page, c) {
  let scope = page;
  if (c.within) scope = page.locator(c.within);
  let loc = c.selector ? scope.locator(c.selector) : scope.getByRole(c.role ?? "button", { name: nameOf(c.name), exact: c.exact ?? false });
  if (c.hasText) loc = loc.filter({ hasText: c.hasText });
  return c.nth != null ? loc.nth(c.nth) : loc.first();
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: plan.viewport ?? { width: 1280, height: 800 }, locale: plan.locale ?? "ko-KR" });
  if (plan.initScript) await ctx.addInitScript(fs.readFileSync(path.resolve(base, plan.initScript), "utf8"));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.errors.push({ kind: "pageerror", msg: String(e).slice(0, 300) }));
  page.on("console", (m) => m.type() === "error" && results.errors.push({ kind: "console", msg: m.text().slice(0, 300) }));
  await page.goto(plan.url);
  if (plan.ready) await page.waitForSelector(plan.ready, { timeout: 60000 });
  await sleep(800);

  for (const step of plan.steps) {
    try {
      if (step.route) {
        const r = step.route;
        await page.route(r.url, (route) => route.fulfill({ status: r.status ?? 200, contentType: "application/json", body: JSON.stringify(r.body ?? {}) }));
      }
      if (step.unroute) await page.unroute(step.unroute);
      if (step.viewport) await page.setViewportSize(step.viewport);
      if (step.evaluate) await page.evaluate(step.evaluate);
      if (step.click) await (await locate(page, step.click)).click();
      if (step.fill) await page.locator(step.fill.selector).fill(step.fill.text);
      if (step.press) await page.keyboard.press(step.press);
      await sleep(step.wait ?? 500);
      if (step.name) {
        await page.screenshot({ path: path.join(OUT, `${step.name}.png`), fullPage: !!step.full });
        console.log("shot", step.name);
      }
      if (step.axe) {
        await page.addScriptTag({ content: AXE });
        const r = await page.evaluate(async () => {
          const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
          return res.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            count: v.nodes.length,
            nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), summary: n.failureSummary?.slice(0, 220) })),
          }));
        });
        results.axe[step.axe] = r;
        console.log("axe", step.axe, r.map((v) => `${v.id}:${v.count}`).join(", ") || "clean");
      }
    } catch (e) {
      results.errors.push({ kind: "step", step: step.name ?? step.axe, msg: String(e).split("\n")[0].slice(0, 300) });
      console.log("step failed", step.name ?? step.axe, String(e).split("\n")[0]);
    }
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
  const total = Object.values(results.axe).reduce((n, v) => n + v.reduce((m, x) => m + x.count, 0), 0);
  console.log(`done · ${Object.keys(results.axe).length} screens · ${total} violating nodes · ${results.errors.length} errors`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
