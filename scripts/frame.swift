import AppKit

let args = CommandLine.arguments
let out = args[1]
let shot = Int(args[2]) ?? 0
let subtitle = args[3]
let width = 360
let height = 640
let image = NSImage(size: NSSize(width: width, height: height))
image.lockFocus()
func color(_ hex: Int, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ hex: Int, _ radius: CGFloat = 0) {
    color(hex).setFill()
    NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h), xRadius: radius, yRadius: radius).fill()
}
func dot(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ hex: Int) {
    color(hex).setFill()
    NSBezierPath(ovalIn: NSRect(x: x-r, y: y-r, width: r*2, height: r*2)).fill()
}
func person(_ x: CGFloat, _ y: CGFloat, _ scale: CGFloat, _ coat: Int, _ face: Bool) {
    rect(x-24*scale, y, 48*scale, 108*scale, coat, 16*scale)
    dot(x, y+123*scale, 21*scale, face ? 0xBD8A70 : 0x282830)
    if face { dot(x-5*scale, y+130*scale, 17*scale, 0x262830) }
}
func bag(_ x: CGFloat, _ y: CGFloat, _ s: CGFloat, _ crooked: Bool) {
    rect(x+30*s, y+34*s, 4*s, 44*s, 0xA4A5B2, 1)
    rect(x+18*s, y+77*s, (crooked ? 38 : 24)*s, 5*s, 0xA4A5B2, 2)
    rect(x, y, 50*s, 57*s, 0x232732, 7*s)
    dot(x+10*s, y-2*s, 4*s, 0x787584)
    dot(x+39*s, y-2*s, 4*s, 0x787584)
}
func text(_ content: String, _ y: CGFloat, _ size: CGFloat, _ foreground: Int, _ weight: NSFont.Weight) {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    let text = NSAttributedString(string: content, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color(foreground), .paragraphStyle: style])
    text.draw(in: NSRect(x: 14, y: y, width: 332, height: size * 2.7))
}
if shot >= 0 {
    NSGradient(starting: color(0x10131D), ending: color(0x4A3B50))!.draw(in: NSRect(x: 0, y: 0, width: width, height: height), angle: 90)
    rect(24, 138, 312, 360, 0x211E2F, 14)
    for i in 0..<5 {
        rect(CGFloat(42+i*58), 157, 40, 276, i % 2 == 0 ? 0x2D2E40 : 0x37374D, 4)
    }
    rect(107, 457, 146, 29, 0xA27852, 3)
    text("EXIT   出口", 450, 13, 0xF7DFAB, .semibold)
    rect(0, 134, 360, 3, 0x585367)
    switch shot {
    case 0: person(114, 215, 1.1, 0x253C58, true)
    case 6: person(240, 200, 1.45, 0x8F929D, true)
    case 1: person(210, 172, 1.23, 0x8F929D, false); bag(247, 136, 1.1, false)
    case 2: person(184, 144, 1.75, 0x8F929D, false); person(78, 182, 0.83, 0x253C58, true)
    case 3: person(133, 171, 1.42, 0x253C58, true); person(281, 158, 1.18, 0x8F929D, false)
    case 4, 14: bag(96, 137, 2.75, shot == 14); rect(169, 332, 56, 28, 0xAF7769, 11)
    default: person(297, 92, 2.52, 0x8F929D, true)
    }
    text("末班车之后", 523, 25, 0xF2E7D7, .semibold)
    text("模拟分镜  /  S0" + String(shot == 14 ? 4 : shot), 37, 12, 0xB9AAC8, .medium)
}
if !subtitle.isEmpty {
    color(0x101015, 0.88).setFill()
    NSBezierPath(roundedRect: NSRect(x: 12, y: 73, width: 336, height: 49), xRadius: 7, yRadius: 7).fill()
    text(subtitle, 74, 17, 0xFFFFFF, .semibold)
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
