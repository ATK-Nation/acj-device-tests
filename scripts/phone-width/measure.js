// Phone-width check, run INSIDE a page. One expression, so it can be pasted
// into a browser console, sent through a browser tool, or evaluated by
// scripts/check-phone-width.mjs. Rules: docs/phone-width.md.
//
// Returns { width, pageWidth, sideways, wrapped, pillWraps, clipped, smallTaps, smallFields, stretched }.
// Measure at a real phone width (about 390px). A page measured while skeletons
// are still showing measures the skeleton, so wait for content first.
(() => {
  // The phone width asked for. A phone browser widens its own viewport to fit
  // a page that is too wide, so innerWidth alone would hide exactly that bug.
  const W = window.__PHONE_WIDTH || window.innerWidth;
  const out = { url: location.pathname, width: W, pageWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth), sideways: [], wrapped: [], pillWraps: [], clipped: [], smallTaps: [], smallFields: [], stretched: [] };
  const shown = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => {
    const t = (el.getAttribute("aria-label") || el.title || el.innerText || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const c = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
    return `${el.tagName.toLowerCase()}${c ? "." + c : ""} "${t}"`;
  };
  // Inside a box that scrolls or clips sideways, and that box fits the screen.
  const inStrip = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return p.getBoundingClientRect().right <= W + 1;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement) && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName));

  // Inside a CSS `zoom` (the builder letter cards are zoom: 0.75 on phones),
  // WebKit reports the box BEFORE the zoom, so a card that fits looks a third
  // wider than it is. Chromium reports it after. The page-wide scroll check
  // still catches a real overflow there.
  const zoomed = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) if (+getComputedStyle(p).zoom !== 1) return true;
    return false;
  };

  // 1. Past the right edge, not inside a scroll strip (rule 4). Outermost only.
  for (const el of all) {
    if (!shown(el) || zoomed(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 1 || r.left >= W || inStrip(el)) continue;
    const pr = el.parentElement?.getBoundingClientRect();
    if (!pr || pr.right <= W + 1 || el.parentElement === document.body) out.sideways.push(`${label(el)} reaches ${Math.round(r.right)}px`);
  }

  // 2. Short labels that wrap onto 2+ lines (rule 1). Prose is skipped.
  for (const el of document.body.querySelectorAll("button, a, [role=tab], label, th, td, span, div")) {
    if (!shown(el) || el.closest(".sr-only, p, li, h1, h2")) continue;
    const text = (el.innerText || "").trim();
    if (!text || text.length > 32 || text.includes("\n") || el.children.length > 3) continue;
    const tops = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1) tops.push(r.top);
    }
    const lines = tops.sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 8).length;
    if (lines > 1) out.wrapped.push(`${label(el)} on ${lines} lines`);
  }

  // 2b. A PILL WHOSE TEXT WRAPS (Andy, 2026-11-21, of the cancel reasons
  // wrapping to 3 lines inside fully round bubbles: "it's absolutely ugly.
  // Let's make sure we never have a display look like that on those type of
  // bubbles"). A pill is a box rounded to half its height or more; its text
  // must sit on ONE line at every width. Any length counts, unlike check 2:
  // a long option still belongs on one line, or the layout gives it a row.
  const textLines = (el) => {
    const tops = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      // Screen-reader-only text is a 1px clipped box: it is not seen, so it
      // is not a line (the header search bar's "Keyword search for...").
      const host = n.parentElement;
      if (!n.textContent.trim() || !host || !shown(host) || host.getBoundingClientRect().width <= 1 || host.closest(".sr-only")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1) tops.push(r.top);
    }
    return tops.sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 8).length;
  };
  for (const el of all) {
    if (!shown(el) || el.closest(".sr-only") || !(el.innerText || "").trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 30) continue; // one line of text-sm with padding is under this
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    if (radius < r.height / 2 - 1) continue;
    const lines = textLines(el);
    if (lines > 1) out.pillWraps.push(`${label(el)} on ${lines} lines`);
  }

  // 3. Text cut off with no "…", and placeholders cut mid-letter (rule 1).
  const ctx = document.createElement("canvas").getContext("2d");
  for (const el of all) {
    // Screen-reader-only text (`sr-only`, `max-sm:sr-only`) is a 1px box on purpose.
    if (!shown(el) || el.closest(".sr-only") || el.clientWidth <= 1) continue;
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText && el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis") out.clipped.push(`${label(el)} cut at ${el.clientWidth}px`);
    if (el.tagName === "INPUT" && el.placeholder && !el.value && s.textOverflow !== "ellipsis") {
      ctx.font = s.font;
      const inner = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (ctx.measureText(el.placeholder).width > inner + 1) out.clipped.push(`${label(el)} placeholder cut`);
    }
  }

  // 4. Tap targets under 24px (rule 3). Links inside running text are skipped.
  for (const el of document.querySelectorAll("a[href], button, [role=button], [role=tab], select, summary")) {
    if (!shown(el) || el.closest(".sr-only")) continue;
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li, td, label")) continue;
    // Also a link with sentence text right beside it, in a box that is not a
    // <p> (the summary box on /copyright, 2026-11-07).
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && [...el.parentElement.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    // An inline [role=button] is a piece of text (a spoiler cover in a
    // message): as tall as its line, like a link in a sentence.
    if (el.getAttribute("role") === "button" && getComputedStyle(el).display === "inline") continue;
    // So is a button that reads as a link in a sentence: underlined, no box
    // (copy an email address, copy-email.tsx). A bigger invisible tap area
    // there covered the next link in the sentence (2026-11-07).
    if (el.tagName === "BUTTON" && el.closest("p, li, td, label") && getComputedStyle(el).textDecorationLine.includes("underline") && getComputedStyle(el).borderTopWidth === "0px") continue;
    // `.hit` draws an invisible tap area 12px past each side on touch, so
    // even a tiny glyph is a 24px+ target there (globals.css).
    if (el.classList.contains("hit") && matchMedia("(pointer: coarse)").matches) continue;
    // A stretched link (after:inset-0) makes its whole card the tap target.
    if (typeof el.className === "string" && el.className.includes("after:inset-0")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) out.smallTaps.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }

  // 5. Fields under 16px: iPhone zooms the page when one is tapped.
  for (const el of document.querySelectorAll('input:not([type=checkbox],[type=radio],[type=range],[type=hidden],[type=file],[type=color]), textarea, select, [contenteditable="true"]')) {
    if (!shown(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) out.smallFields.push(`${label(el)} ${size}px`);
  }

  // 6. Pictures squashed or stretched (object-fit: fill with the wrong shape).
  for (const el of document.querySelectorAll("img")) {
    if (!shown(el) || !el.naturalWidth || getComputedStyle(el).objectFit !== "fill") continue;
    const r = el.getBoundingClientRect();
    const want = el.naturalWidth / el.naturalHeight;
    if (Math.abs(r.width / r.height - want) / want > 0.06) out.stretched.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }

  for (const k of ["sideways", "wrapped", "pillWraps", "clipped", "smallTaps", "smallFields", "stretched"]) out[k] = [...new Set(out[k])].slice(0, 25);
  return out;
})()
