// Mouse for the Mac measure: real clicks, double-clicks, right-clicks, hovers and drags,
// posted as macOS mouse events (Andy, 2026-11-22: "how every mouse click works, drag,
// swipe, right click, left click"). osascript already has the Accessibility grant the
// keyboard steps use, so events posted from it reach apps the same way.
//
//   osascript -l JavaScript scripts/mac-measure/mouse.js click 300 200
//   ... dclick X Y | rclick X Y | move X Y | drag X1 Y1 X2 Y2 [alt]
//
// Coordinates are screen points, top-left origin.

ObjC.import("CoreGraphics");

const DOWN = 1, UP = 2, RDOWN = 3, RUP = 4, MOVED = 5, DRAGGED = 6;
const CLICK_STATE = 1; // kCGMouseEventClickState
const ALT = 0x80000; // kCGEventFlagMaskAlternate

function post(type, x, y, button, clicks, flags) {
  const e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button);
  if (clicks) $.CGEventSetIntegerValueField(e, CLICK_STATE, clicks);
  if (flags) $.CGEventSetFlags(e, flags);
  $.CGEventPost(0, e); // kCGHIDEventTap
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- osascript calls run()
function run(argv) {
  const cmd = argv[0];
  const n = argv.slice(1, 5).map(Number);
  const flags = argv.includes("alt") ? ALT : 0;
  const [x, y] = n;
  if (cmd === "move") {
    post(MOVED, x, y, 0, 0, 0);
  } else if (cmd === "click") {
    post(MOVED, x, y, 0, 0, 0);
    delay(0.1);
    post(DOWN, x, y, 0, 1, flags);
    post(UP, x, y, 0, 1, flags);
  } else if (cmd === "dclick") {
    post(MOVED, x, y, 0, 0, 0);
    delay(0.1);
    post(DOWN, x, y, 0, 1, 0);
    post(UP, x, y, 0, 1, 0);
    delay(0.05);
    post(DOWN, x, y, 0, 2, 0);
    post(UP, x, y, 0, 2, 0);
  } else if (cmd === "rclick") {
    post(MOVED, x, y, 0, 0, 0);
    delay(0.1);
    post(RDOWN, x, y, 1, 1, 0);
    post(RUP, x, y, 1, 1, 0);
  } else if (cmd === "drag") {
    const [x1, y1, x2, y2] = n;
    post(MOVED, x1, y1, 0, 0, 0);
    delay(0.15);
    post(DOWN, x1, y1, 0, 1, flags);
    delay(0.25);
    for (let i = 1; i <= 15; i++) {
      post(DRAGGED, x1 + ((x2 - x1) * i) / 15, y1 + ((y2 - y1) * i) / 15, 0, 1, flags);
      delay(0.04);
    }
    delay(0.2);
    post(UP, x2, y2, 0, 1, flags);
  } else {
    return `unknown command ${cmd}`;
  }
  return "ok";
}
