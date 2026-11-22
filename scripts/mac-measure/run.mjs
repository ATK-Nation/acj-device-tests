// Measures Apple's own Mac controls on a real Mac: letter sizes, control heights,
// menu rows and the gaps around them, the settings card, and real apps (Finder,
// System Settings, Safari, Messages, Notes, Reminders). Andy, 2026-11-18: "take a look
// at the mac and measure it all ... and how it all fits together". Read docs/corners.md.
//
// It runs on GitHub's Mac (mac-measure.yml), started from the main repo with
//   pnpm device-tests:run measure
// Sizes come from macOS itself (AppKit frames and the Accessibility system), in points.
// Corner sizes are read from the pictures it saves, after the run.
//
// It never signs in to anything. An app that only shows a sign-in window is pictured
// as it is, and the summary says so.
//
// Exit 0: measured. Exit 2: COULD NOT CHECK (no Mac, the app did not build or start).

import { execFile, spawn } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve("mac-measure-output");
const AX = resolve("scripts/mac-measure/ax-dump.js");
const notes = [];
const note = (line) => {
  console.log(line);
  notes.push(line);
};

const couldNotCheck = (cause) => {
  console.error(`COULD NOT CHECK: ${cause}`);
  writeFileSync(`${OUT}/summary.md`, `# Mac measure\n\nCOULD NOT CHECK: ${cause}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n`);
  process.exit(2);
};

mkdirSync(OUT, { recursive: true });
if (process.platform !== "darwin") couldNotCheck(`this needs a Mac, and this is ${process.platform}`);

const text = async (cmd, args, ms = 30_000) => {
  try {
    return (await run(cmd, args, { timeout: ms, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
  } catch (e) {
    return `FAILED: ${String(e.stderr || e.message).trim().slice(0, 300)}`;
  }
};
const osa = (script, ms = 20_000) => text("osascript", ["-e", script], ms);
const key = (code) => osa(`tell application "System Events" to key code ${code}`);
const DOWN = 125;
const ESC = 53;
const RETURN = 36;

const shot = async (name) => {
  const r = await text("screencapture", ["-x", `${OUT}/${name}.png`]);
  if (r.startsWith("FAILED")) note(`picture ${name}: ${r}`);
};
const windowShot = async (name, id) => {
  const r = await text("screencapture", ["-x", "-o", "-l", String(id), `${OUT}/${name}.png`]);
  if (r.startsWith("FAILED")) note(`window picture ${name}: ${r}`);
};
const axDump = async (proc, mode, file, limit = 1500) => {
  const r = await text("osascript", ["-l", "JavaScript", AX, proc, mode, String(limit)], 150_000);
  if (r.startsWith("FAILED")) {
    note(`sizes from ${proc} (${mode}): ${r}`);
    return [];
  }
  writeFileSync(`${OUT}/${file}`, r);
  try {
    return JSON.parse(r);
  } catch {
    note(`sizes from ${proc} (${mode}): not JSON`);
    return [];
  }
};
const until = async (test, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(200);
  }
  return test();
};

// 1. Which Mac this is.
const facts = {
  macos: await text("sw_vers", []),
  xcode: await text("xcodebuild", ["-version"]),
  swift: await text("swiftc", ["--version"]),
};
note(`macOS: ${facts.macos.replace(/\s+/g, " ")}`);
note(`Xcode: ${facts.xcode.replace(/\s+/g, " ")}`);

// Dark mode for the whole Mac: Andy looks at dark pictures (2026-11-17).
await osa('tell application "System Events" to tell appearance preferences to set dark mode to true');

// 2. Build and start the measuring app.
const build = await text("swiftc", ["-swift-version", "5", "-O", "-o", `${OUT}/MacMeasure`, "scripts/mac-measure/measure.swift"], 600_000);
if (build.startsWith("FAILED")) {
  writeFileSync(`${OUT}/build-error.txt`, build);
  couldNotCheck(`the measuring app did not build: ${build}`);
}
const appLog = createWriteStream(`${OUT}/app-log.txt`);
const child = spawn(`${OUT}/MacMeasure`, [OUT], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(appLog);
child.stderr.pipe(appLog);
if (!(await until(() => existsSync(`${OUT}/ready`), 90_000))) couldNotCheck("the measuring app did not show its windows in 90 seconds");
const info = JSON.parse(readFileSync(`${OUT}/info.json`, "utf8"));
note(`screen: ${info.screenW} x ${info.screenH} points, ${info.scale} pixels per point`);
await sleep(800);

// 3. Pictures of our two windows, and the whole screen.
for (const [name, id] of Object.entries(info.windows)) await windowShot(`window-${name}`, id);
await shot("screen-controls");
const own = await axDump("MacMeasure", "windows", "ax-own-windows.json", 800);

// 4. Menus: open each, read its rows, then press Down so a row shows the hover look.
const sendCmd = (c) => writeFileSync(`${OUT}/cmd`, c);
const menus = {};
const openMenu = async (name, open, mode) => {
  await open();
  await sleep(1500);
  await shot(`menu-${name}`);
  menus[name] = await axDump("MacMeasure", mode, `ax-menu-${name}.json`, 400);
  await key(DOWN);
  await sleep(500);
  await shot(`menu-${name}-hover`);
  await key(DOWN);
  await sleep(500);
  await shot(`menu-${name}-hover-2`);
  await key(ESC);
  await sleep(800);
};
await openMenu("context", () => sendCmd("context"), "menus");
await openMenu("popup", () => sendCmd("popup"), "menus");
for (const title of ["Edit", "Message"]) {
  await openMenu(
    `menubar-${title.toLowerCase()}`,
    () => osa(`tell application "System Events" to tell process "MacMeasure"
  set frontmost to true
  ignoring application responses
    click menu bar item "${title}" of menu bar 1
  end ignoring
end tell`),
    `menubar:${title}`,
  );
}
sendCmd("quit");
await sleep(1000);
child.kill();

// 5. Real apps. Nothing is signed in to, and nothing is typed.
const APPS = [
  { name: "Finder", open: ["open", [process.cwd()]] },
  { name: "System Settings", open: ["open", ["-a", "System Settings"]] },
  { name: "Safari", open: ["open", ["-a", "Safari"]] },
  { name: "Messages", open: ["open", ["-a", "Messages"]] },
  // A first-launch "What's New" card hides these two; Return closes it (no account).
  { name: "Notes", open: ["open", ["-a", "Notes"]], welcome: true },
  { name: "Reminders", open: ["open", ["-a", "Reminders"]], welcome: true },
];
for (const a of APPS) {
  const slug = a.name.toLowerCase().replace(/[^a-z]+/g, "-");
  const opened = await text(a.open[0], a.open[1]);
  if (opened.startsWith("FAILED")) {
    note(`${a.name}: did not open (${opened})`);
    continue;
  }
  await sleep(7000);
  await osa(`tell application "${a.name}" to activate`);
  await osa(`tell application "System Events" to tell process "${a.name}"
  set position of window 1 to {40, 60}
  set size of window 1 to {1100, 720}
end tell`);
  await sleep(1500);
  await shot(`app-${slug}`);
  if (a.welcome) {
    await key(RETURN);
    await sleep(1500);
    await shot(`app-${slug}-after-welcome`);
  }
  const els = await axDump(a.name, "windows", `ax-app-${slug}.json`, 2500);
  const titles = els.filter((e) => e.role === "AXWindow").map((e) => e.name || "(no title)");
  note(`${a.name}: ${els.length} sizes read, windows: ${titles.join(", ") || "none"}`);
}

// 5b. Apple's Calendar, for the calendar redesign (Andy, 2026-11-22: "go through
// like Google Calendar ... or even MacBooks calendar"). Month and Week view, in
// dark and light, a bigger window so a month grid has room. Nothing is signed in
// to or typed; the holiday calendar a new Mac has gives it something to show.
{
  const opened = await text("open", ["-a", "Calendar"]);
  if (opened.startsWith("FAILED")) note(`Calendar: did not open (${opened})`);
  else {
    await sleep(7000);
    await osa('tell application "Calendar" to activate');
    await key(RETURN); // a first-launch card, if any
    await sleep(1200);
    await osa(`tell application "System Events" to tell process "Calendar"
  set position of window 1 to {20, 40}
  set size of window 1 to {1400, 860}
end tell`);
    const view = async (n) => {
      await osa(`tell application "System Events" to tell process "Calendar" to keystroke "${n}" using command down`);
      await sleep(1800);
    };
    for (const dark of [true, false]) {
      await osa(`tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`);
      await sleep(1500);
      const mode = dark ? "dark" : "light";
      await view(3);
      await shot(`app-calendar-month-${mode}`);
      if (dark) await axDump("Calendar", "windows", "ax-app-calendar-month.json", 3000);
      await view(2);
      await shot(`app-calendar-week-${mode}`);
      if (dark) await axDump("Calendar", "windows", "ax-app-calendar-week.json", 3000);
      await view(4);
      await shot(`app-calendar-year-${mode}`);
      await view(1);
      await shot(`app-calendar-day-${mode}`);
    }
    await osa('tell application "System Events" to tell appearance preferences to set dark mode to true');
    // How Apple makes a new event (Andy, 2026-11-22: "even like how to create a task").
    // The calendar list (sidebar) first, then File > New Event in Week view, which opens
    // the event's own card. It is pictured, measured, then undone, so nothing is saved.
    await osa(`tell application "System Events" to tell process "Calendar"
  try
    click menu item "Show Calendar List" of menu "View" of menu bar 1
  end try
end tell`);
    await sleep(1200);
    await view(3);
    await shot("app-calendar-month-sidebar-dark");
    await view(2);
    await osa(`tell application "System Events" to tell process "Calendar" to keystroke "n" using command down`);
    await sleep(2000);
    await shot("app-calendar-new-event-dark");
    await axDump("Calendar", "windows", "ax-app-calendar-new-event.json", 3000);
    await key(ESC);
    await sleep(800);
    await shot("app-calendar-new-event-closed-dark");
    await osa(`tell application "System Events" to tell process "Calendar" to keystroke "z" using command down`);
    await sleep(800);
    note("Calendar: month, week, year and day pictured in dark and light; calendar list and a new event pictured in dark");
  }
}

// 6. The summary: letter sizes, control heights, menu rows.
const lines = ["# Mac measure", "", `${facts.macos.replace(/\n/g, " · ")}`, "", `Screen: ${info.screenW} x ${info.screenH} points at ${info.scale}x.`, ""];
lines.push("## Letter sizes (points)", "", "| Text | Size |", "|---|---|");
for (const [k, v] of Object.entries(info.fonts)) if (typeof v === "number") lines.push(`| ${k} | ${v} |`);
for (const [k, v] of Object.entries(info.fonts.controlSizes ?? {})) lines.push(`| control ${k} | ${v} |`);
lines.push("", "## AppKit controls (points; height = the visible shape)", "", "| Size | Control | Letters | Height | Width | Frame height |", "|---|---|---|---|---|---|");
for (const c of info.controls) lines.push(`| ${c.size} | ${c.kind} | ${c.fontPt} | ${round(c.alignH)} | ${round(c.alignW)} | ${round(c.frameH)} |`);
lines.push("", "## SwiftUI controls (from Accessibility, points)", "", "| Control | Name | Width | Height |", "|---|---|---|---|");
for (const e of own) if (["AXButton", "AXTextField", "AXPopUpButton", "AXCheckBox", "AXGroup", "AXRow", "AXCell"].includes(e.role) && e.size) lines.push(`| ${e.role}${e.sub ? ` (${e.sub})` : ""} | ${e.name ?? e.desc ?? ""} | ${e.size[0]} | ${e.size[1]} |`);
lines.push("", "## Menus (points)", "");
for (const [name, els] of Object.entries(menus)) {
  const menu = els.find((e) => e.role === "AXMenu");
  const rows = els.filter((e) => e.role === "AXMenuItem" && e.size);
  if (!menu || !rows.length) {
    lines.push(`- **${name}**: could not read (${els.length} elements)`);
    continue;
  }
  const first = rows[0];
  const heights = [...new Set(rows.map((r) => `${r.name || "separator"} ${r.size[1]}`))];
  lines.push(`- **${name}**: menu ${menu.size[0]} x ${menu.size[1]} at ${menu.pos}; first row starts ${first.pos[0] - menu.pos[0]} in and ${first.pos[1] - menu.pos[1]} down, ${first.size[0]} wide; rows: ${heights.join(", ")}`);
}
lines.push("", "## Notes", "", ...notes.map((n) => `- ${n}`));
const report = lines.join("\n");
writeFileSync(`${OUT}/summary.md`, report);
appendFileSync(`${OUT}/summary.md`, "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
console.log(report);

function round(n) {
  return Math.round(n * 10) / 10;
}
