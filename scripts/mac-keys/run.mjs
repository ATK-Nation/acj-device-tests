// Presses our shortcuts on a real Mac, in real Safari, through macOS itself.
// Read docs/team-memory/mac-key-test.md. It runs on GitHub's Mac (mac-keys.yml) and
// needs nothing installed: the page holds the real src/lib/message-keys.ts with its
// types stripped, so the answers it checks are the ones the site gives.
//
// Exit 0: every key did what we expect. Exit 1: a key did not, or Safari took it.
// Exit 2: COULD NOT CHECK (no Mac, no permission, Safari never opened), with the cause.

import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { promisify } from "node:util";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "mac-keys-output";

// macOS key codes are places on the keyboard, not letters.
const K = { k: 40, slash: 44, u: 32, m: 46, d: 2, b: 11, i: 34, up: 126, down: 125, pageUp: 116 };
const CMD = "command down";
const SHIFT = "shift down";
const OPT = "option down";
const CTRL = "control down";

// `value` is what the box holds after the key, when the key adds a format.
const KEYS = [
  { label: "Cmd+K", code: K.k, mods: [CMD], chat: "switcher" },
  { label: "Cmd+/", code: K.slash, mods: [CMD], chat: "shortcut-list" },
  { label: "Cmd+Shift+U", code: K.u, mods: [CMD, SHIFT], chat: "upload" },
  { label: "Cmd+Shift+M", code: K.m, mods: [CMD, SHIFT], chat: "mute", mark: "`", value: "`word`" },
  { label: "Cmd+Shift+D", code: K.d, mods: [CMD, SHIFT], chat: "deafen" },
  { label: "Option+Up", code: K.up, mods: [OPT], chat: "chat-prev" },
  { label: "Option+Down", code: K.down, mods: [OPT], chat: "chat-next" },
  { label: "Option+Shift+Up", code: K.up, mods: [OPT, SHIFT], chat: "unread-prev" },
  { label: "Option+Shift+Down", code: K.down, mods: [OPT, SHIFT], chat: "unread-next" },
  { label: "Shift+Up", code: K.up, mods: [SHIFT], chat: "edit-last" },
  { label: "Shift+Page Up", code: K.pageUp, mods: [SHIFT], chat: "oldest-unread" },
  { label: "Cmd+B", code: K.b, mods: [CMD], mark: "**", value: "**word**" },
  { label: "Cmd+I", code: K.i, mods: [CMD], mark: "*", value: "*word*" },
  { label: "Cmd+U", code: K.u, mods: [CMD], mark: "__", value: "__word__" },
  // Ctrl moves the caret on a Mac, so it must never be a shortcut.
  { label: "Ctrl+K stays the Mac's own", code: K.k, mods: [CTRL] },
  { label: "Ctrl+B stays the Mac's own", code: K.b, mods: [CTRL] },
];

const couldNotCheck = (cause) => {
  console.error(`COULD NOT CHECK: ${cause}`);
  process.exit(2);
};

if (process.platform !== "darwin") couldNotCheck(`this needs a Mac, and this is ${process.platform}`);

const source = stripTypeScriptTypes(readFileSync("src/lib/message-keys.ts", "utf8"));
const PAGE = `<!doctype html><meta charset="utf-8"><title>Mac keys</title>
<textarea id="box" rows="4" cols="40"></textarea>
<script type="module">
${source}
const box = document.getElementById("box");
const send = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) });
const reset = () => { box.value = "word"; box.focus(); box.select(); };
reset();
window.addEventListener("focus", reset);
window.addEventListener("keydown", (e) => {
  if (["Meta", "Shift", "Alt", "Control"].includes(e.key)) return;
  const chat = chatKey(e);
  const mark = formatMarkKey(e);
  if (chat || mark) e.preventDefault();
  if (mark) applyMark(box, mark);
  const seen = { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, chat, mark };
  // Long enough for anything Safari does with the key to take the focus away.
  setTimeout(() => {
    send("/key", { ...seen, value: box.value, focus: document.hasFocus() });
    reset();
  }, 200);
}, true);
send("/ready", { mac: isMacKeyboard(), userAgent: navigator.userAgent });
</script>`;

let ready = null;
let readyCount = 0;
let lastKey = null;
const server = createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.url === "/ready") {
      ready = JSON.parse(body);
      readyCount++;
    }
    if (req.url === "/key") lastKey = JSON.parse(body);
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const osa = (script) => run("osascript", ["-e", script], { timeout: 20_000 });
const until = async (test, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(50);
  }
  return test();
};

const openPage = async () => {
  const before = readyCount;
  await run("open", ["-a", "Safari", url]);
  if (!(await until(() => readyCount > before, 60_000))) return false;
  await osa('tell application "Safari" to activate');
  await sleep(800);
  return true;
};

const picture = (name) =>
  run("screencapture", ["-x", `${OUT}/${name.replace(/[^a-zA-Z0-9]+/g, "-")}.png`]).catch(() => {});

mkdirSync(OUT, { recursive: true });
if (!(await openPage())) couldNotCheck("Safari never opened the test page in 60 seconds");
if (!ready.mac) couldNotCheck(`the page does not think this is a Mac: ${ready.userAgent}`);

const { stdout: safari } = await run("defaults", ["read", "/Applications/Safari.app/Contents/Info", "CFBundleShortVersionString"]);

const rows = [];
for (const key of KEYS) {
  lastKey = null;
  const using = key.mods.length ? ` using {${key.mods.join(", ")}}` : "";
  try {
    await osa(`tell application "System Events" to key code ${key.code}${using}`);
  } catch (err) {
    couldNotCheck(`macOS refused the key press for ${key.label}: ${String(err.stderr || err.message).trim()}`);
  }
  await until(() => lastKey, 2_000);

  const problems = [];
  if (!lastKey) {
    problems.push("the page never saw it: Safari or macOS took it");
  } else {
    if ((lastKey.chat ?? undefined) !== key.chat) problems.push(`chat answer ${lastKey.chat}, expected ${key.chat ?? "none"}`);
    if ((lastKey.mark ?? undefined) !== key.mark) problems.push(`format answer ${lastKey.mark}, expected ${key.mark ?? "none"}`);
    if (key.value && lastKey.value !== key.value) problems.push(`the box holds ${JSON.stringify(lastKey.value)}, expected ${JSON.stringify(key.value)}`);
    if (!lastKey.focus) problems.push("the page lost focus: Safari opened something");
  }
  rows.push({ label: key.label, problems, seen: lastKey });

  if (problems.length) {
    await picture(key.label);
    // Whatever opened gets closed, so one bad key does not fail every key after it.
    await osa('tell application "System Events" to key code 53').catch(() => {});
    await sleep(300);
    if (!(await openPage())) couldNotCheck(`Safari did not come back after ${key.label}`);
  }
}
server.close();

const failed = rows.filter((r) => r.problems.length);
const report = [
  `### Mac keys: ${rows.length - failed.length} of ${rows.length} passed (Safari ${safari.trim()})`,
  "",
  "| Key | Result |",
  "|---|---|",
  ...rows.map((r) => `| ${r.label} | ${r.problems.length ? `FAILED: ${r.problems.join("; ")}` : "passed"} |`),
].join("\n");
console.log(report);
writeFileSync(`${OUT}/results.json`, JSON.stringify({ safari: safari.trim(), userAgent: ready.userAgent, rows }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exit(failed.length ? 1 : 0);
