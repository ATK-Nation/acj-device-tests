// Lists what macOS's Accessibility system knows about an app's windows or menus: each
// element's role, name, position and size in points (exact, not read from pixels).
// Run by scripts/mac-measure/run.mjs:
//   osascript -l JavaScript ax-dump.js <process name> <mode> <limit>
// mode: "windows" (every window), "menus" (open menus, skipping the menu bar),
// or "menubar:<title>" (the open menu under that menu bar title).

// osascript calls run() itself, so nothing in this file uses it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  const procName = argv[0];
  const mode = argv[1] || "windows";
  const limit = Number(argv[2]) || 1500;
  const se = Application("System Events");
  const p = se.processes.byName(procName);
  const out = [];
  function walk(e, d) {
    if (out.length >= limit || d > 25) return;
    let pr = {};
    try {
      pr = e.properties();
    } catch {
      return;
    }
    const r = { d: d, role: pr.role, sub: pr.subrole, name: pr.name, desc: pr.description, pos: pr.position, size: pr.size };
    if (typeof pr.value === "string" && pr.value.length < 60) r.value = pr.value;
    out.push(r);
    let kids = [];
    try {
      kids = e.uiElements();
    } catch {}
    for (const k of kids) walk(k, d + 1);
  }
  if (mode === "windows") {
    for (const w of p.windows()) walk(w, 0);
  } else if (mode === "menus") {
    for (const e of p.uiElements()) {
      let role = "";
      try {
        role = e.role();
      } catch {}
      if (role !== "AXMenuBar") walk(e, 0);
    }
  } else if (mode.indexOf("menubar:") === 0) {
    walk(p.menuBars[0].menuBarItems.byName(mode.slice(8)).menus[0], 0);
  }
  return JSON.stringify(out);
}
