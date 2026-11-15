// Discord's keyboard shortcuts for /messages and the call screen. Read
// docs/messaging.md "Keyboard shortcuts". The rules in one place, so the shortcut
// list on screen and the handlers cannot disagree.

type KeyEventLike = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export type ChatKey =
  | "switcher" | "shortcut-list"
  | "chat-prev" | "chat-next" | "unread-prev" | "unread-next"
  | "edit-last" | "oldest-unread" | "upload"
  | "mute" | "deafen";

export const isMacKeyboard = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

// Cmd on a Mac, where Ctrl moves the caret (Ctrl+A, B, E, K). Ctrl everywhere else.
const shortcutMod = (e: KeyEventLike, mac: boolean) => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

// An IME is picking a character. The key belongs to it, whatever it looks like.
const composing = (e: KeyEventLike) => Boolean(e.isComposing) || e.keyCode === 229;

/** Which shortcut this key press is, or null. It says nothing about where focus is. */
export function chatKey(e: KeyEventLike, mac = isMacKeyboard()): ChatKey | null {
  if (composing(e)) return null;
  const k = e.key.toLowerCase();
  if (shortcutMod(e, mac) && !e.altKey) {
    if (!e.shiftKey && k === "k") return "switcher";
    if (k === "/" || e.code === "Slash") return "shortcut-list";
    if (e.shiftKey && k === "u") return "upload";
    if (e.shiftKey && k === "m") return "mute";
    if (e.shiftKey && k === "d") return "deafen";
    return null;
  }
  if (e.ctrlKey || e.metaKey) return null;
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    if (e.shiftKey) return e.key === "ArrowUp" ? "unread-prev" : "unread-next";
    return e.key === "ArrowUp" ? "chat-prev" : "chat-next";
  }
  if (e.altKey || !e.shiftKey) return null;
  if (e.key === "ArrowUp") return "edit-last";
  if (e.key === "PageUp") return "oldest-unread";
  return null;
}

export type FormatMark = "**" | "*" | "__" | "`" | "||";

/**
 * The format a key adds in a box that keeps its formats. Ctrl+Shift+M is listed by
 * Discord for both inline code and mute: in one of these boxes it is code, and
 * anywhere else in a call it is mute (each box says so with `data-format-box`).
 */
export function formatMarkKey(e: KeyEventLike, mac = isMacKeyboard()): FormatMark | null {
  if (composing(e) || !shortcutMod(e, mac) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === "m" ? "`" : null;
  return k === "b" ? "**" : k === "i" ? "*" : k === "u" ? "__" : null;
}

export type MarkEdit = { from: number; to: number; text: string; selStart: number; selEnd: number };

/**
 * Is `mark` around the words, reading outward from them? Stars next to each other
 * hold italic (an odd count) and bold (2 or more). `inside` reads a selection that
 * includes its own marks, where the marks are the selection's two ends.
 */
function hasMark(before: string, after: string, mark: FormatMark, inside = false): boolean {
  const [open, close] = inside ? [after, before] : [before, after];
  if (mark === "*") {
    const lead = /^\**/.exec(inside ? open : close)?.[0].length ?? 0;
    const tail = /\**$/.exec(inside ? close : open)?.[0].length ?? 0;
    return Math.min(lead, tail) % 2 === 1;
  }
  return inside ? open.startsWith(mark) && close.endsWith(mark) : open.endsWith(mark) && close.startsWith(mark);
}

/**
 * What pressing a format key does to the selected text: adds the marks, or takes
 * them off if they are already there. The selection stays on the same words. A
 * space on the edge of a selection goes outside the marks, or the format would
 * not count (`**word **`). No selection puts the caret between a new pair.
 */
export function markEdit(value: string, start: number, end: number, mark: FormatMark): MarkEdit {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(value[a])) a++;
  while (b > a && /\s/.test(value[b - 1])) b--;
  const sel = value.slice(a, b);
  const m = mark.length;
  if (hasMark(value.slice(0, a), value.slice(b), mark)) {
    return { from: a - m, to: b + m, text: sel, selStart: a - m, selEnd: b - m };
  }
  if (sel.length >= 2 * m && hasMark(sel, sel, mark, true)) {
    const inner = sel.slice(m, sel.length - m);
    return { from: a, to: b, text: inner, selStart: a, selEnd: a + inner.length };
  }
  // Several lines of code are a block, because inline code stays on one line.
  if (mark === "`" && sel.includes("\n")) {
    const text = `\`\`\`\n${sel}\n\`\`\``;
    return { from: a, to: b, text, selStart: a + 4, selEnd: a + 4 + sel.length };
  }
  return { from: a, to: b, text: `${mark}${sel}${mark}`, selStart: a + m, selEnd: a + m + sel.length };
}

/**
 * Apply a format key to a text box. Through the browser's own insert, so it fires
 * onChange and stays on the undo trail: writing the value wipes that trail.
 */
export function applyMark(el: HTMLTextAreaElement | HTMLInputElement, mark: FormatMark): void {
  const value = el.value;
  const edit = markEdit(value, el.selectionStart ?? value.length, el.selectionEnd ?? value.length, mark);
  el.focus();
  el.setSelectionRange(edit.from, edit.to);
  const done = edit.text ? document.execCommand("insertText", false, edit.text) : document.execCommand("delete");
  if (!done) {
    el.setRangeText(edit.text, edit.from, edit.to);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(edit.selStart, edit.selEnd);
}

/** The same for a contentEditable box. A selection holding a picture is left alone. */
export function applyMarkToEditable(mark: FormatMark): void {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.cloneContents().querySelector("img")) return;
  // Inside one run of text the marks around the words can be read, so a second press
  // takes them off and the selection stays on the same words, as in a text box.
  const node = range.startContainer;
  if (node === range.endContainer && node.nodeType === Node.TEXT_NODE) {
    const edit = markEdit(node.textContent ?? "", range.startOffset, range.endOffset, mark);
    const place = new Range();
    place.setStart(node, edit.from);
    place.setEnd(node, edit.to);
    sel.removeAllRanges();
    sel.addRange(place);
    if (edit.text) document.execCommand("insertText", false, edit.text);
    else document.execCommand("delete");
    const now = sel.anchorNode;
    if (now?.nodeType === Node.TEXT_NODE && (now.textContent?.length ?? 0) >= edit.selEnd) sel.setBaseAndExtent(now, edit.selStart, now, edit.selEnd);
    return;
  }
  const text = sel.toString();
  const edit = markEdit(text, 0, text.length, mark);
  document.execCommand("insertText", false, text.slice(0, edit.from) + edit.text + text.slice(edit.to));
  // An empty box: the caret goes between the new marks.
  if (!text) for (let i = 0; i < mark.length; i++) sel.modify("move", "backward", "character");
}

/** A field or a player, where arrows and letters already mean something. */
export const isKeyOwner = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && Boolean(t.closest('input, textarea, select, video, audio, [contenteditable="true"]'));

export type ShortcutRow = { label: string; keys: string };
export type ShortcutGroup = { title: string; rows: ShortcutRow[] };

/** The Shortcut List pop-up, with the right keys for this person's system. */
export function shortcutGroups(mac: boolean): ShortcutGroup[] {
  const mod = mac ? "Cmd" : "Ctrl";
  const alt = mac ? "Option" : "Alt";
  return [
    {
      title: "Chats",
      rows: [
        { label: "Find or Start a Chat", keys: `${mod}+K` },
        { label: "Next or Last Chat", keys: `${alt}+Up/Down` },
        { label: "Next Unread Chat", keys: `${alt}+Shift+Up/Down` },
        { label: "Mark Chat Read", keys: "Esc" },
        { label: "Show This List", keys: `${mod}+/` },
      ],
    },
    {
      title: "Message Box",
      rows: [
        { label: "Go to Message Box", keys: "Tab" },
        { label: "Edit Your Last Message", keys: "Shift+Up" },
        { label: "Upload a File", keys: `${mod}+Shift+U` },
        { label: "Oldest Unread Message", keys: "Shift+Page Up" },
      ],
    },
    {
      title: "Text",
      rows: [
        { label: "Bold", keys: `${mod}+B` },
        { label: "Italic", keys: `${mod}+I` },
        { label: "Underline", keys: `${mod}+U` },
        { label: "Code", keys: `${mod}+Shift+M` },
      ],
    },
    {
      title: "Pick a Message",
      rows: [
        { label: "Pick a Message", keys: "Up in an Empty Box" },
        { label: "Move", keys: "Up/Down" },
        { label: "Reply", keys: "R" },
        { label: "Edit", keys: "E" },
        { label: "Pin", keys: "P" },
        { label: "Add Reaction", keys: "+" },
      ],
    },
    {
      title: "In a Call",
      rows: [
        { label: "Mute", keys: `${mod}+Shift+M` },
        { label: "Deafen", keys: `${mod}+Shift+D` },
      ],
    },
  ];
}
