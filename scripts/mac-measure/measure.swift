// A small Mac app that shows Apple's own controls, so scripts/mac-measure/run.mjs can
// measure them: buttons, pop-up menus, segmented controls, text boxes, search boxes,
// switches, a grouped settings form, glass buttons, and three menus.
// Andy, 2026-11-18: "take a look at the mac and measure it all". Read docs/corners.md.
//
// Run: swiftc -swift-version 5 -O -o MacMeasure measure.swift && ./MacMeasure <out dir>
// It writes <out>/info.json (sizes in points, letter sizes, screen scale), 4x renders
// of both windows, then <out>/ready. It then reads commands from <out>/cmd:
// "context" opens a right-click menu, "popup" opens the pop-up menu, "quit" quits.

import AppKit
import SwiftUI

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let app = NSApplication.shared
app.setActivationPolicy(.regular)

func menuItem(_ title: String, _ key: String = "", _ symbol: String? = nil) -> NSMenuItem {
  let i = NSMenuItem(title: title, action: nil, keyEquivalent: key)
  if let s = symbol { i.image = NSImage(systemSymbolName: s, accessibilityDescription: nil) }
  return i
}

func makeMenu(_ title: String, _ items: [NSMenuItem?]) -> NSMenu {
  let m = NSMenu(title: title)
  m.autoenablesItems = false
  for i in items { m.addItem(i ?? NSMenuItem.separator()) }
  return m
}

// Menu bar: an Edit menu (plain rows with shortcuts) and a Message menu (rows with icons).
let mainMenu = NSMenu()
for (title, menu) in [
  ("MacMeasure", makeMenu("MacMeasure", [menuItem("Quit MacMeasure", "q")])),
  ("Edit", makeMenu("Edit", [menuItem("Undo", "z"), menuItem("Redo", "Z"), nil, menuItem("Cut", "x"), menuItem("Copy", "c"), menuItem("Paste", "v"), menuItem("Select All", "a")])),
  ("Message", makeMenu("Message", [menuItem("Reply", "r", "arrowshape.turn.up.left"), menuItem("Edit", "e", "pencil"), menuItem("Share", "", "square.and.arrow.up"), nil, menuItem("Delete", "", "trash")])),
] {
  let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
  top.submenu = menu
  mainMenu.addItem(top)
}
app.mainMenu = mainMenu

// The right-click menu, like the Edit / Share / Delete menu on a message.
let contextMenu = makeMenu("", [menuItem("Edit", "", "pencil"), menuItem("Share", "", "square.and.arrow.up"), nil, menuItem("Delete", "", "trash")])

// Window 1: AppKit controls, one row per control size.
var sizes: [(String, NSControl.ControlSize)] = [("mini", .mini), ("small", .small), ("regular", .regular), ("large", .large)]
if #available(macOS 26.0, *), let xl = NSControl.ControlSize(rawValue: 4) { sizes.append(("extraLarge", xl)) }

var tracked: [(String, String, NSView, CGFloat)] = []
var regularPop: NSPopUpButton? = nil

let stack = NSStackView()
stack.orientation = .vertical
stack.alignment = .leading
stack.spacing = 18
stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)

for (name, size) in sizes {
  let fontPt = NSFont.systemFontSize(for: size)
  let font = NSFont.systemFont(ofSize: fontPt)
  func ctl<T: NSControl>(_ kind: String, _ v: T) -> T {
    v.controlSize = size
    v.font = font
    tracked.append((kind, name, v, fontPt))
    return v
  }
  let label = NSTextField(labelWithString: name)
  label.widthAnchor.constraint(equalToConstant: 80).isActive = true
  let button = ctl("button", NSButton(title: "Button", target: nil, action: nil))
  let save = ctl("defaultButton", NSButton(title: "Save", target: nil, action: nil))
  save.keyEquivalent = "\r"
  let pop = ctl("popUp", NSPopUpButton(frame: .zero, pullsDown: false))
  pop.addItems(withTitles: ["Newest", "Oldest", "Most Liked", "Nearest"])
  if name == "regular" { regularPop = pop }
  let seg = ctl("segmented", NSSegmentedControl(labels: ["Day", "Week", "Month"], trackingMode: .selectOne, target: nil, action: nil))
  seg.selectedSegment = 0
  let text = ctl("textField", NSTextField(string: ""))
  text.placeholderString = "Text box"
  text.bezelStyle = .roundedBezel
  text.widthAnchor.constraint(equalToConstant: 130).isActive = true
  let search = ctl("searchField", NSSearchField())
  search.placeholderString = "Search"
  search.widthAnchor.constraint(equalToConstant: 130).isActive = true
  let toggle = ctl("switch", NSSwitch())
  toggle.state = .on
  let row = NSStackView(views: [label, button, save, pop, seg, text, search, toggle])
  row.orientation = .horizontal
  row.alignment = .centerY
  row.spacing = 14
  stack.addArrangedSubview(row)
}

let w1 = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 400), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
w1.title = "Controls"
let c1 = NSView()
w1.contentView = c1
stack.translatesAutoresizingMaskIntoConstraints = false
c1.addSubview(stack)
NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: c1.topAnchor), stack.leadingAnchor.constraint(equalTo: c1.leadingAnchor)])
c1.layoutSubtreeIfNeeded()
w1.setContentSize(stack.fittingSize)

// Window 2: SwiftUI. A grouped settings form (Apple's card with rows) and buttons.
struct Sz: Identifiable {
  let id: String
  let size: ControlSize
}

#if compiler(>=6.2)
struct GlassButtons: View {
  var body: some View {
    if #available(macOS 26.0, *) {
      Button("Glass") {}.buttonStyle(.glass)
      Button("Glass Prominent") {}.buttonStyle(.glassProminent)
    }
  }
}
#else
struct GlassButtons: View {
  var body: some View { EmptyView() }
}
#endif

struct ButtonRows: View {
  let sizes = [Sz(id: "mini", size: .mini), Sz(id: "small", size: .small), Sz(id: "regular", size: .regular), Sz(id: "large", size: .large), Sz(id: "extraLarge", size: .extraLarge)]
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(sizes) { s in
        HStack(spacing: 10) {
          Text(s.id).frame(width: 80, alignment: .leading)
          Button("Bordered") {}.buttonStyle(.bordered)
          Button("Prominent") {}.buttonStyle(.borderedProminent)
          GlassButtons()
          TextField("Text", text: .constant("")).textFieldStyle(.roundedBorder).frame(width: 110)
        }
        .controlSize(s.size)
      }
    }
  }
}

struct FormDemo: View {
  @State private var on = true
  @State private var pick = "Newest"
  @State private var name = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Form {
        Section("Notifications") {
          Toggle("Email me", isOn: $on)
          Picker("Sort", selection: $pick) {
            Text("Newest").tag("Newest")
            Text("Oldest").tag("Oldest")
          }
          TextField("Name", text: $name)
        }
        Section {
          LabeledContent("Plan", value: "Free")
          LabeledContent("Joined", value: "Nov 2026")
        }
      }
      .formStyle(.grouped)
      .frame(width: 460, height: 320)
      ButtonRows()
    }
    .padding(20)
  }
}

let host = NSHostingView(rootView: FormDemo())
let w2 = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 620), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
w2.title = "Form"
w2.contentView = host
host.layoutSubtreeIfNeeded()
w2.setContentSize(host.fittingSize)

let screen = NSScreen.main!
w1.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.minX + 20, y: screen.visibleFrame.maxY - 10))
let rightX = w1.frame.maxX + 20
if rightX + w2.frame.width <= screen.visibleFrame.maxX {
  w2.setFrameTopLeftPoint(NSPoint(x: rightX, y: screen.visibleFrame.maxY - 10))
} else {
  w2.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.minX + 20, y: w1.frame.minY - 20))
}
w2.orderFront(nil)
w1.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)

// A crisp 4x picture of a window's content, drawn by AppKit itself (no screen needed).
func render(_ w: NSWindow, _ name: String) {
  guard let v = w.contentView else { return }
  for (tag, look) in [("dark", NSAppearance.Name.darkAqua), ("light", NSAppearance.Name.aqua)] {
    w.appearance = NSAppearance(named: look)
    v.layoutSubtreeIfNeeded()
    v.display()
    let b = v.bounds
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(b.width * 4), pixelsHigh: Int(b.height * 4), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { continue }
    rep.size = b.size
    v.cacheDisplay(in: b, to: rep)
    if let png = rep.representation(using: .png, properties: [:]) {
      try? png.write(to: URL(fileURLWithPath: "\(out)/render-\(name)-\(tag)-4x.png"))
    }
  }
  w.appearance = nil
}

DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
  w1.makeFirstResponder(nil)
  let contentH = w1.contentView!.bounds.height
  var controls: [[String: Any]] = []
  for (kind, size, v, fontPt) in tracked {
    let fr = v.convert(v.bounds, to: nil)
    let al = v.alignmentRect(forFrame: v.frame)
    controls.append([
      "kind": kind, "size": size, "fontPt": fontPt,
      "frameW": fr.width, "frameH": fr.height, "alignW": al.width, "alignH": al.height,
      "x": fr.minX, "yFromTop": contentH - fr.maxY, "intrinsicH": v.intrinsicContentSize.height,
    ])
  }
  var sizeFonts: [String: Any] = [:]
  for (name, size) in sizes { sizeFonts[name] = NSFont.systemFontSize(for: size) }
  let info: [String: Any] = [
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "scale": screen.backingScaleFactor,
    "screenW": screen.frame.width,
    "screenH": screen.frame.height,
    "fonts": [
      "system": NSFont.systemFontSize,
      "smallSystem": NSFont.smallSystemFontSize,
      "label": NSFont.labelFontSize,
      "menu": NSFont.menuFont(ofSize: 0).pointSize,
      "menuBar": NSFont.menuBarFont(ofSize: 0).pointSize,
      "body": NSFont.preferredFont(forTextStyle: .body).pointSize,
      "headline": NSFont.preferredFont(forTextStyle: .headline).pointSize,
      "title3": NSFont.preferredFont(forTextStyle: .title3).pointSize,
      "callout": NSFont.preferredFont(forTextStyle: .callout).pointSize,
      "subheadline": NSFont.preferredFont(forTextStyle: .subheadline).pointSize,
      "footnote": NSFont.preferredFont(forTextStyle: .footnote).pointSize,
      "controlSizes": sizeFonts,
    ],
    "windows": ["controls": w1.windowNumber, "form": w2.windowNumber],
    "windowFrames": [
      "controls": [w1.frame.minX, screen.frame.height - w1.frame.maxY, w1.frame.width, w1.frame.height],
      "form": [w2.frame.minX, screen.frame.height - w2.frame.maxY, w2.frame.width, w2.frame.height],
    ],
    "controls": controls,
  ]
  if let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted, .sortedKeys]) {
    try? data.write(to: URL(fileURLWithPath: "\(out)/info.json"))
  }
  render(w1, "controls")
  render(w2, "form")
  FileManager.default.createFile(atPath: "\(out)/ready", contents: Data())
}

// Commands from run.mjs. The timer is in the common modes, so it also fires while a
// menu is open.
let cmdPath = "\(out)/cmd"
let timer = Timer(timeInterval: 0.2, repeats: true) { _ in
  guard let raw = try? String(contentsOfFile: cmdPath, encoding: .utf8) else { return }
  try? FileManager.default.removeItem(atPath: cmdPath)
  let cmd = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  DispatchQueue.main.async {
    app.activate(ignoringOtherApps: true)
    w1.makeKeyAndOrderFront(nil)
    switch cmd {
    case "context":
      _ = contextMenu.popUp(positioning: nil, at: NSPoint(x: 260, y: 60), in: w1.contentView!)
    case "popup":
      regularPop?.performClick(nil)
    case "quit":
      app.terminate(nil)
    default:
      break
    }
  }
}
RunLoop.main.add(timer, forMode: .common)
app.run()
