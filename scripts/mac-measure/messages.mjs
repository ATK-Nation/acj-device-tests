// Shows real Mac Messages bubbles on GitHub's Mac, with no Apple account, so their
// shapes can be measured: a pill on 1 line, a box on more (Andy, 2026-11-19: "i
// meant the Messages app, from the mac that youre using"). Read docs/corners.md.
//
// GitHub's Mac has no Apple account, and we never sign in to anything. Messages
// shows the chats in its local history file (~/Library/Messages/chat.db) even
// when signed out, so this writes a made-up chat there (a fictional 555 number,
// on a Mac that is thrown away after the run), opens Messages, and pictures it.
// Run by mac-measure.yml with -f part=messages.
//
// Exit 0 always: every step that could not be done is named in summary.md.

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve("mac-measure-output");
const AX = resolve("scripts/mac-measure/ax-dump.js");
const DB = join(homedir(), "Library", "Messages", "chat.db");
const notes = [];
const note = (line) => {
  console.log(line);
  notes.push(line);
};
mkdirSync(OUT, { recursive: true });

const text = async (cmd, args, ms = 30_000) => {
  try {
    return (await run(cmd, args, { timeout: ms, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
  } catch (e) {
    return `FAILED: ${String(e.stderr || e.message).trim().slice(0, 400)}`;
  }
};
const osa = (script, ms = 20_000) => text("osascript", ["-e", script], ms);
const shot = (name) => text("screencapture", ["-x", `${OUT}/${name}.png`]);
const sql = (q, json = false) => text("sqlite3", json ? ["-json", DB, q] : [DB, q], 60_000);
const axDump = async (file, mode = "windows") => {
  const r = await text("osascript", ["-l", "JavaScript", AX, "Messages", mode, "2500"], 150_000);
  if (!r.startsWith("FAILED")) writeFileSync(`${OUT}/${file}`, r);
  return r;
};
const finish = () => {
  const report = ["# Mac Messages", "", ...notes.map((n) => `- ${n}`)].join("\n");
  writeFileSync(`${OUT}/summary.md`, `${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  process.exit(0);
};

note(`macOS: ${(await text("sw_vers", [])).replace(/\s+/g, " ")}`);
await osa('tell application "System Events" to tell appearance preferences to set dark mode to true');

// 1. First launch: Messages makes its history file. Picture what it shows.
await text("open", ["-a", "Messages"]);
await sleep(15_000);
await osa('tell application "Messages" to activate');
await sleep(1500);
await shot("messages-1-first-launch");
const first = await axDump("ax-messages-first-launch.json");
note(`first launch: ${first.startsWith("FAILED") ? first : `${JSON.parse(first).filter((e) => e.role === "AXWindow").length} window(s)`}`);
await osa('tell application "Messages" to quit');
await sleep(3000);
await text("pkill", ["-x", "Messages"]);
await sleep(1000);

if (!existsSync(DB)) {
  note(`could not check: Messages made no history file at ${DB}`);
  finish();
}
const tables = await sql(".tables");
if (tables.startsWith("FAILED")) {
  note(`could not check: macOS refused to open the Messages history file (${tables}). It needs Full Disk Access, which this Mac does not give.`);
  finish();
}
writeFileSync(`${OUT}/chat-db-schema.sql`, await sql(".schema"));

// 2. Text as Messages stores it: an archived NSAttributedString (newer Messages
//    reads this, not the plain text column).
const LINES = [
  { me: false, text: "Hey, are you free today?" },
  { me: true, text: "Yes" },
  { me: true, text: "Sure, I can look at it this afternoon. Send me the link to the repo and a short note on what is broken, and I will start there." },
  { me: false, text: "Great, thanks! I will send it in a minute." },
  { me: false, text: "Here is the plan: first the login page, then the settings page, then the tag editor, and last the checkout. Tell me if that order works for you or if you want to change anything." },
  { me: true, text: "Works for me 👍" },
];
const swift = `import Foundation
let texts = CommandLine.arguments.dropFirst()
for t in texts {
  let d = NSArchiver.archivedData(withRootObject: NSAttributedString(string: t))
  print(d.map { String(format: "%02x", $0) }.joined())
}`;
writeFileSync(`${OUT}/archive.swift`, swift);
const hexOut = await text("swift", [`${OUT}/archive.swift`, ...LINES.map((l) => l.text)], 300_000);
const hexes = hexOut.startsWith("FAILED") ? [] : hexOut.split("\n").map((h) => h.trim());
if (hexes.length !== LINES.length) note(`archived text not made (${hexOut.slice(0, 200)}); writing plain text only`);

// 3. Write the made-up chat. Messages' triggers call its own functions, which the
//    sqlite3 tool does not have, so they come off for the write and go back after.
const cols = async (table) => {
  const r = await sql(`PRAGMA table_info(${table})`, true);
  return r.startsWith("FAILED") || !r ? [] : JSON.parse(r);
};
const quote = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : typeof v === "object" ? v.raw : `'${String(v).replace(/'/g, "''")}'`);
async function insert(table, values) {
  const info = await cols(table);
  const row = { ...values };
  // Fill every NOT NULL column with no default that we did not set.
  for (const c of info) if (c.notnull && c.dflt_value === null && !(c.name in row) && !c.pk) row[c.name] = /INT/i.test(c.type) ? 0 : "";
  const names = Object.keys(row).filter((k) => info.some((c) => c.name === k));
  return `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map((k) => quote(row[k])).join(",")});`;
}
const triggers = await sql("SELECT name, sql FROM sqlite_master WHERE type='trigger'", true);
const trigList = triggers.startsWith("FAILED") || !triggers ? [] : JSON.parse(triggers);
const PHONE = "+15555550100";
const nowNs = (s) => Math.round((Date.now() / 1000 - 978307200 - 3600 + s * 60) * 1e9);
const statements = ["BEGIN;", ...trigList.map((t) => `DROP TRIGGER IF EXISTS "${t.name}";`)];
statements.push(await insert("handle", { ROWID: 9001, id: PHONE, country: "us", service: "iMessage", uncanonicalized_id: null }));
statements.push(await insert("chat", { ROWID: 9001, guid: `iMessage;-;${PHONE}`, style: 45, state: 3, service_name: "iMessage", chat_identifier: PHONE, display_name: "Sam", last_read_message_timestamp: nowNs(10) }));
statements.push(await insert("chat_handle_join", { chat_id: 9001, handle_id: 9001 }));
for (const [i, l] of LINES.entries()) {
  const id = 9001 + i;
  const date = nowNs(i);
  const guid = `ACJ-MEASURE-${String(i).padStart(4, "0")}-0000-0000-000000000000`;
  statements.push(await insert("message", {
    ROWID: id, guid, text: l.text, attributedBody: hexes[i] ? { raw: `X'${hexes[i]}'` } : null,
    handle_id: 9001, service: "iMessage", date, date_read: date, date_delivered: date,
    is_from_me: l.me ? 1 : 0, is_delivered: 1, is_finished: 1, is_sent: l.me ? 1 : 0, is_read: 1, is_empty: 0, item_type: 0,
  }));
  statements.push(await insert("chat_message_join", { chat_id: 9001, message_id: id, message_date: date }));
}
statements.push(...trigList.map((t) => `${t.sql};`), "COMMIT;");
writeFileSync(`${OUT}/fixture.sql`, statements.join("\n"));
const wrote = await text("sqlite3", [DB, `.read ${OUT}/fixture.sql`], 60_000);
const count = await sql("SELECT count(*) FROM message WHERE ROWID >= 9001");
note(`made-up chat written: ${wrote.startsWith("FAILED") ? wrote : `yes, ${count} messages`}`);

// 4. Open Messages again, pick the chat, picture it.
await text("open", ["-a", "Messages"]);
await sleep(15_000);
await osa('tell application "Messages" to activate');
await osa(`tell application "System Events" to tell process "Messages"
  set position of window 1 to {40, 40}
  set size of window 1 to {980, 700}
end tell`);
await sleep(1500);
await shot("messages-2-with-chat");
// Signed out, Messages may open no window by itself (seen 2026-11-19). Ask for
// its main window (Window > Messages, Cmd+0), and list what the Window and File
// menus offer, so the next try knows the names.
for (const m of ["Window", "File"]) {
  const r = await axDump(`ax-menu-${m.toLowerCase()}.json`, `menubar:${m}`);
  if (!r.startsWith("FAILED")) note(`${m} menu: ${JSON.parse(r).filter((e) => e.role === "AXMenuItem").map((e) => e.name || "-").join(", ")}`);
}
const windows = async () => {
  const r = await osa('tell application "System Events" to tell process "Messages" to get name of every window');
  return r.startsWith("FAILED") ? r : `[${r}]`;
};
await osa('tell application "System Events" to tell process "Messages" to keystroke "0" using {command down}');
await sleep(3000);
note(`after Cmd+0: windows ${await windows()}`);
await shot("messages-2b-after-cmd-0");
for (const item of ["Messages", "Chats"]) {
  await osa(`tell application "System Events" to tell process "Messages"
  try
    click menu item "${item}" of menu 1 of menu bar item "Window" of menu bar 1
  end try
end tell`);
}
await sleep(3000);
note(`after Window menu: windows ${await windows()}`);
await osa(`tell application "System Events" to tell process "Messages"
  set position of window 1 to {40, 40}
  set size of window 1 to {980, 700}
end tell`);
await sleep(1500);
await shot("messages-2c-after-window-menu");
// The chat list is the window's first table or list; pick its first row.
await osa(`tell application "System Events" to tell process "Messages"
  try
    select row 1 of table 1 of scroll area 1 of splitter group 1 of window 1
  end try
end tell`);
await sleep(2500);
await shot("messages-3-chat-open");
const after = await axDump("ax-messages-chat-open.json");
if (!after.startsWith("FAILED")) {
  const els = JSON.parse(after);
  const bubbles = els.filter((e) => e.size && LINES.some((l) => (e.name ?? e.desc ?? e.value ?? "").includes(l.text.slice(0, 12))));
  note(`bubbles found by Accessibility: ${bubbles.length}`);
  for (const b of bubbles) note(`  ${b.role} ${b.size[0]} x ${b.size[1]} at ${b.pos}: ${(b.name ?? b.desc ?? b.value ?? "").slice(0, 40)}`);
} else note(`sizes from Messages: ${after}`);
finish();
