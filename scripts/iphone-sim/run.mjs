// Opens our pages in real iPhone and iPad Safari, in Apple's simulator, on
// GitHub's Mac (iphone-sim.yml). Read docs/team-memory/iphone-sim-test.md.
//
// Our Windows check (`pnpm check:phone --devices --engine webkit`) runs Safari's
// engine at every size, but not iPhone Safari itself. This one does, so it also
// sees the three things only an iPhone does:
//   1. Tapping a field with text under 16px zooms the page in. The size is read
//      inside iPhone Safari. (A real tap cannot be made: Apple's driver never
//      focuses a field, tested 2026-11-07.)
//   2. Safari's toolbar covers the bottom of the screen. Anything pinned to the
//      bottom that reaches under it is reported.
//   3. Date fields open Apple's wheels. That cannot be judged by a script; the
//      screenshots show the page as the phone shows it.
// On every page it also runs scripts/phone-width/measure.js, the same check
// `pnpm check:phone` runs, inside iPhone Safari.
//
// node scripts/iphone-sim/run.mjs [--base URL] [--devices a,b] [--paths /a,/b | all]
//                                 [--no-sideways]
//   --base     the site to open. Default https://aicodejobs.com: GitHub's Mac
//              cannot reach a laptop's localhost, and a preview needs Vercel's
//              login. Signed-out pages only.
//   --devices  names from DEVICES below, or "all". Default: the phones and 1 iPad.
//   --paths    pages to open, or "all" for scripts/phone-width/pages.mjs.
//
// Exit 0: no problem. Exit 1: a problem (FAIL). Exit 2: COULD NOT CHECK, with the
// cause (no Mac, no simulator, Safari would not start).

import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { DEFAULT_PATHS } from "../phone-width/pages.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "iphone-sim-output";
const MEASURE = readFileSync(new URL("../phone-width/measure.js", import.meta.url), "utf8");

// Apple's own devices, picked from what the Mac has installed. `match` finds the
// newest model of each kind, so a new Xcode does not break the list.
export const DEVICES = [
  { key: "small", label: "small iPhone", match: /^iPhone (SE|\d+e)\b/ },
  { key: "iphone", label: "iPhone", match: /^iPhone \d+$/ },
  { key: "promax", label: "Pro Max", match: /^iPhone \d+ Pro Max$/ },
  { key: "ipadmini", label: "iPad mini", match: /^iPad mini/, ipad: true },
  { key: "ipadpro", label: "iPad Pro", match: /^iPad Pro 13/, ipad: true },
];
const DEFAULT_DEVICES = ["small", "iphone", "promax", "ipadmini"];
// The pages most people land on. "all" opens every page check:phone opens.
const SHORT_PATHS = ["/", "/jobs", "/builders", "/explore", "/pricing", "/faq", "/login", "/signup"];

const couldNotCheck = (cause) => {
  console.error(`COULD NOT CHECK: ${cause}`);
  summary(`**COULD NOT CHECK:** ${cause}\n`);
  process.exit(2);
};
const summary = (md) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
};

// ── arguments
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const base = (opt("--base", "") || "https://aicodejobs.com").replace(/\/$/, "");
const deviceArg = opt("--devices", "") || DEFAULT_DEVICES.join(",");
const wantKeys = deviceArg === "all" ? DEVICES.map((d) => d.key) : deviceArg.split(",").map((s) => s.trim()).filter(Boolean);
const unknown = wantKeys.filter((k) => !DEVICES.some((d) => d.key === k));
if (unknown.length) couldNotCheck(`unknown device ${unknown.join(", ")}. Use: ${DEVICES.map((d) => d.key).join(", ")}, all`);
const pathArg = opt("--paths", "");
const paths = pathArg === "all" ? DEFAULT_PATHS : pathArg ? pathArg.split(",").map((s) => s.trim()).filter(Boolean) : SHORT_PATHS;
// Git Bash on Windows rewrites `-f paths=/pricing` into "C:/Program Files/Git/pricing"
// before gh sends it (2026-11-07). Say so, with the fix.
if (paths.some((p) => /^[A-Za-z]:\//.test(p))) couldNotCheck(`a page arrived as a Windows path (${paths.join(", ")}): Git Bash rewrote it. Start the run with MSYS_NO_PATHCONV=1 gh workflow run ..., or from PowerShell`);
if (paths.some((p) => !p.startsWith("/"))) couldNotCheck(`every page must start with /: ${paths.join(", ")}`);
const sideways = !args.includes("--no-sideways");

if (process.platform !== "darwin") couldNotCheck(`this needs a Mac, and this is ${process.platform}`);

// ── the simulator
const simctl = async (...a) => (await run("xcrun", ["simctl", ...a], { timeout: 240_000, maxBuffer: 64 << 20 })).stdout;
let installed;
try {
  installed = JSON.parse(await simctl("list", "devices", "available", "-j")).devices;
} catch (e) {
  couldNotCheck(`xcrun simctl did not answer (is Xcode installed?): ${e.message}`);
}
// Newest iOS first: "com.apple.CoreSimulator.SimRuntime.iOS-18-4" -> [18, 4].
const version = (rt) => (rt.match(/iOS-([\d-]+)$/)?.[1] ?? "0").split("-").map(Number);
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
  return 0;
};
const runtimes = Object.keys(installed).filter((rt) => /iOS-/.test(rt) && installed[rt].length).sort((a, b) => newer(version(a), version(b)));
if (!runtimes.length) couldNotCheck("no iOS simulator is installed on this Mac");
const pick = (d) => {
  for (const rt of runtimes) {
    const found = installed[rt].filter((x) => d.match.test(x.name)).sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }));
    if (found.length) return { ...found[0], ios: version(rt).join(".") };
  }
  return null;
};
console.log(`iOS simulators: ${runtimes.map((r) => version(r).join(".")).join(", ")}`);

// ── safaridriver: Apple's own WebDriver for Safari, iPhone Safari included
try {
  await run("sudo", ["safaridriver", "--enable"], { timeout: 60_000 });
} catch (e) {
  couldNotCheck(`safaridriver --enable failed: ${e.stderr || e.message}`);
}
const PORT = 4723;
const driver = spawn("safaridriver", ["-p", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
driver.stdout.on("data", (d) => (driverLog += d));
driver.stderr.on("data", (d) => (driverLog += d));
process.on("exit", () => driver.kill());
const wd = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.value?.error) throw new Error(`${method} ${path}: ${json.value?.error ?? res.status} ${json.value?.message ?? ""}`.trim());
  return json.value;
};
for (let i = 0; ; i++) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/status`);
    break;
  } catch {
    if (i > 50) couldNotCheck(`safaridriver did not start: ${driverLog}`);
    await sleep(200);
  }
}

// Things only iPhone Safari shows, run after measure.js. One expression.
const IOS_CHECKS = `(() => {
  const vv = window.visualViewport;
  const seen = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => {
    const t = (el.getAttribute("aria-label") || el.innerText || el.placeholder || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    const c = typeof el.className === "string" ? el.className.split(/\\s+/).slice(0, 3).join(".") : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "") + ' "' + t + '"';
  };
  // Pinned to the screen and reaching below what Safari leaves visible: the
  // toolbar covers that part. 100vh is the screen WITHOUT the toolbar, so h-screen
  // on a fixed box is the usual cause; dvh is the fix.
  const visible = vv ? vv.height : innerHeight;
  const underBar = [];
  for (const el of document.body.querySelectorAll("*")) {
    const pos = getComputedStyle(el).position;
    if (pos !== "fixed" && pos !== "sticky") continue;
    if (!seen(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top < visible && r.bottom > visible + 2) underBar.push(label(el) + " ends at " + Math.round(r.bottom) + "px, the screen shows " + Math.round(visible) + "px");
  }
  return { innerWidth, innerHeight, visible: Math.round(visible), scale: vv ? vv.scale : 1, underBar: [...new Set(underBar)].slice(0, 10) };
})()`;

// In brackets: measure.js starts with comment lines, and `return` followed by a
// line break returns nothing (the first trial run measured null that way).
const exec = (sid, script) => wd("POST", `/session/${sid}/execute/sync`, { script: `return (\n${script}\n);`, args: [] });
const fileName = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "home";

// Turn the simulator sideways or back, through the Simulator app's own menu keys.
const turn = async (udid, left) => {
  await run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]).catch(() => {});
  await sleep(1500);
  const key = left ? 123 : 124; // left / right arrow
  await run("osascript", ["-e", 'tell application "Simulator" to activate', "-e", `tell application "System Events" to key code ${key} using command down`], { timeout: 20_000 });
  await sleep(2500);
};

// ── the self-test: proof that each check can still fail on this iOS
// Two pages served from the Mac itself (the simulator shares its network). /bad
// holds one of each problem; /good holds the fixed version. The first device opens
// both before any real page. If a check misses its problem on /bad, or flags /good,
// the run is COULD NOT CHECK: a clean result would mean nothing.
const PAGE_HEAD = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;font:16px system-ui">`;
const SELF_TEST = {
  "/bad": `${PAGE_HEAD}<input aria-label="small field" style="font-size:13px;width:200px;margin:80px 20px">
<div style="width:150vw;height:20px;background:#c33">too wide</div>
<div aria-label="tall box" style="position:fixed;right:0;top:0;width:30px;height:100vh;background:#36c"></div>`,
  "/good": `${PAGE_HEAD}<input aria-label="big field" style="font-size:16px;width:200px;margin:80px 20px">
<div style="width:100%;height:20px;background:#3a3">fits</div>
<div aria-label="tall box" style="position:fixed;right:0;top:0;width:30px;height:100dvh;background:#36c"></div>`,
};
const EXPECT_BAD = [
  ["past the edge", /^page is \d+px wide|^past the edge|^Safari shrank the page/],
  ["under Safari's toolbar", /^under Safari's toolbar: .*tall box/],
  ["field under 16px", /^field under 16px.*small field/],
];
const { createServer } = await import("node:http");
const selfServer = createServer((req, res) => {
  const page = SELF_TEST[req.url];
  res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(page ?? "not found");
});
await new Promise((r) => selfServer.listen(0, "127.0.0.1", r));
const selfBase = `http://127.0.0.1:${selfServer.address().port}`;
process.on("exit", () => selfServer.close());

mkdirSync(OUT, { recursive: true });
const report = [];
let fails = 0;
let unchecked = 0;
let selfTested = false;

// Open one page and run every check on it.
const checkPage = async (sid, sim, url, shot) => {
  const failed = [];
  const warned = [];
  await wd("POST", `/session/${sid}/url`, { url });
  // Let client components settle and skeletons clear, as check:phone does.
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (i >= 2 && !(await exec(sid, "!!document.querySelector('.animate-pulse')"))) break;
  }
  // The screen's own width. iPhone Safari zooms OUT to fit a page that is too
  // wide, which widens innerWidth with it and would hide exactly that bug; the
  // visible width times the zoom stays the screen's.
  const r = await exec(sid, `(() => { const vv = window.visualViewport; window.__PHONE_WIDTH = vv ? Math.round(vv.width * vv.scale) : innerWidth; return (\n${MEASURE.trim().replace(/;?\s*$/, "")}\n); })()`);
  const ios = await exec(sid, IOS_CHECKS);
  if (!r || !ios) throw new Error(`the page check returned nothing (${JSON.stringify({ r: !!r, ios: !!ios })})`);
  if (shot) await simctl("io", sim.udid, "screenshot", shot).catch(() => {});

  if (ios.scale < 0.99) failed.push(`Safari shrank the page to ${Math.round(ios.scale * 100)}% to fit it on the screen`);
  if (r.pageWidth > r.width) failed.push(`page is ${r.pageWidth}px wide on a ${r.width}px screen`);
  failed.push(...r.sideways.map((x) => `past the edge: ${x}`));
  failed.push(...ios.underBar.map((x) => `under Safari's toolbar: ${x}`));
  // iPhone Safari zooms in on a field under 16px when it is tapped. The size is
  // read inside iPhone Safari, so this is what the phone itself computes. A real
  // tap cannot be made: safaridriver's clicks and touches reach the page but
  // never focus a field (probe on iOS 26.2, 2026-11-07). It fails on iPads too:
  // the first run found 14px fields there, and Andy chose 16px on every touch
  // screen (globals.css, 2026-11-07).
  failed.push(...r.smallFields.map((x) => `field under 16px, Safari zooms in when it is tapped: ${x}`));
  warned.push(...r.wrapped.map((x) => `wraps: ${x}`), ...r.clipped.map((x) => `cut off: ${x}`), ...r.smallTaps.map((x) => `small tap target: ${x}`), ...r.stretched.map((x) => `squashed picture: ${x}`));
  return { r, ios, failed, warned };
};

for (const key of wantKeys) {
  const d = DEVICES.find((x) => x.key === key);
  const sim = pick(d);
  if (!sim) {
    console.log(`\n?     ${d.label}: no such simulator on this Mac`);
    report.push({ device: d.label, path: "-", status: "could not check", notes: ["no such simulator on this Mac"] });
    unchecked++;
    continue;
  }
  const name = `${sim.name}, iOS ${sim.ios}`;
  console.log(`\n── ${name}`);
  let sid = null;
  // Safari sometimes will not start on a freshly booted simulator: "The host
  // application never became ready" (iPhone 17 Pro Max, 2026-11-09, run
  // 42565392196). GitHub's Mac is slow and the simulator's Safari host app was
  // not ready in time. A clean shutdown and re-boot fixes it, so try 2 more times
  // before calling the device "could not check".
  const TRIES = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= TRIES && !sid; attempt++) {
    try {
      if (attempt > 1 || sim.state !== "Booted") await simctl("boot", sim.udid).catch((e) => { if (!/current state: Booted/.test(e.stderr ?? "")) throw e; });
      await simctl("bootstatus", sim.udid, "-b");
      // A new iPhone's Safari shows Apple's own "View Bookmarks, Share Menu..." tip
      // over the page (first full run, 2026-11-07). TipKit hides every tip when this
      // is set, before Safari starts.
      for (const domain of ["-g", "com.apple.mobilesafari"]) {
        await simctl("spawn", sim.udid, "defaults", "write", domain, "com.apple.TipKit.HideAllTips", "-bool", "YES").catch(() => {});
      }
      const session = await wd("POST", "/session", {
        capabilities: { alwaysMatch: { browserName: "safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceUDID": sim.udid } },
      });
      sid = session.sessionId;
    } catch (e) {
      lastError = e;
      await simctl("shutdown", sim.udid).catch(() => {});
      if (attempt < TRIES) console.log(`      Safari did not start on ${name} (try ${attempt} of ${TRIES}): ${e.message}. Restarting the simulator and trying again.`);
    }
  }
  if (!sid) {
    console.log(`?     could not start Safari on ${name} after ${TRIES} tries: ${lastError?.message}\n${driverLog.slice(-2000)}`);
    report.push({ device: name, path: "-", status: "could not check", notes: [`Safari would not start after ${TRIES} tries: ${lastError?.message}`] });
    unchecked++;
    continue;
  }
  if (lastError) console.log(`      Safari started on ${name} after a simulator restart.`);

  if (!selfTested) {
    selfTested = true;
    const misses = [];
    try {
      const bad = await checkPage(sid, sim, `${selfBase}/bad`, `${OUT}/self-test-bad.png`);
      const badNotes = [...bad.failed];
      for (const [what, re] of EXPECT_BAD) if (!badNotes.some((n) => re.test(n))) misses.push(`missed "${what}" on the test page with that problem`);
      const good = await checkPage(sid, sim, `${selfBase}/good`, `${OUT}/self-test-good.png`);
      if (good.failed.length) misses.push(`flagged the fixed test page: ${good.failed.join("; ")}`);
      console.log(`self-test on ${name}: ${misses.length ? misses.join("; ") : "every check caught its problem, and the fixed page passed"}`);
      for (const n of bad.failed) console.log(`        (bad page) ${n}`);
    } catch (e) {
      misses.push(`the self-test pages did not open: ${e.message}`);
    }
    report.push({ device: name, path: "self-test", status: misses.length ? "could not check" : "ok", notes: misses });
    if (misses.length) {
      await wd("DELETE", `/session/${sid}`).catch(() => {});
      couldNotCheck(`the checks did not pass their self-test, so a clean result would mean nothing: ${misses.join("; ")}`);
    }
  }

  const ways = sideways && !d.ipad ? ["upright", "sideways"] : ["upright"];
  for (const way of ways) {
    if (way === "sideways") await turn(sim.udid, true);
    for (const path of paths) {
      const shownAs = `${name}${way === "sideways" ? ", sideways" : ""}`;
      const shot = `${OUT}/${fileName(sim.name)}${way === "sideways" ? "-sideways" : ""}-${fileName(path)}.png`;
      let res;
      try {
        res = await checkPage(sid, sim, base + path, shot);
        // The simulator saves the screen upright; turn a sideways picture to read normally.
        if (way === "sideways") await run("sips", ["-r", "270", shot], { timeout: 30_000 }).catch(() => {});
      } catch (e) {
        console.log(`?     ${path} (${shownAs}): ${e.message}`);
        report.push({ device: shownAs, path, status: "could not check", notes: [e.message] });
        unchecked++;
        continue;
      }
      const { r, ios, failed, warned } = res;
      if (way === "sideways" && ios.innerWidth < ios.innerHeight) {
        console.log(`?     ${path} (${shownAs}): the simulator did not turn sideways`);
        report.push({ device: shownAs, path, status: "could not check", notes: ["the simulator did not turn sideways"] });
        unchecked++;
        break;
      }

      fails += failed.length;
      const status = failed.length ? "FAIL" : warned.length ? "warn" : "ok";
      console.log(`${status.padEnd(5)} ${path} (${shownAs}, ${ios.innerWidth}x${ios.visible})${r.url !== path ? ` -> ${r.url}` : ""}`);
      for (const f of failed) console.log(`        FAIL  ${f}`);
      for (const x of warned) console.log(`        warn  ${x}`);
      report.push({ device: shownAs, size: `${ios.innerWidth}x${ios.visible}`, path, status, notes: [...failed.map((f) => `FAIL ${f}`), ...warned] });
    }
    if (way === "sideways") await turn(sim.udid, false).catch(() => {});
  }
  await wd("DELETE", `/session/${sid}`).catch(() => {});
  await simctl("shutdown", sim.udid).catch(() => {});
}

writeFileSync(`${OUT}/report.json`, JSON.stringify({ base, paths, report }, null, 2));
const line = `${report.length} page views on ${base}: ${fails} FAIL, ${unchecked} could not be checked. Screenshots are in the run's iphone-sim-output download.`;
console.log(`\n${line}`);
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
summary(
  `## iPhone Safari, in Apple's simulator\n\n${line}\n\n| Result | Device | Screen | Page | What |\n|---|---|---|---|---|\n` +
    report.map((x) => `| ${x.status} | ${esc(x.device)} | ${x.size ?? ""} | ${esc(x.path)} | ${esc(x.notes.slice(0, 4).join("; "))} |`).join("\n") +
    "\n",
);
process.exit(fails ? 1 : unchecked ? 2 : 0);
