// Draws the app icon into an .iconset directory: swift make-icon.swift OUT.iconset
import AppKit

let out = URL(filePath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(size: CGFloat) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = size / 1024

    // Squircle-ish tile with the standard macOS icon margins.
    let tile = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
    let path = NSBezierPath(roundedRect: tile, xRadius: 185 * s, yRadius: 185 * s)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
    shadow.shadowOffset = NSSize(width: 0, height: -10 * s)
    shadow.shadowBlurRadius = 24 * s
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor.white.setFill()
    path.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(
        starting: NSColor(calibratedRed: 1, green: 1, blue: 1, alpha: 1),
        ending: NSColor(calibratedRed: 0.91, green: 0.93, blue: 0.96, alpha: 1)
    )!.draw(in: path, angle: -90)

    // Faint ruled lines, like a page.
    NSColor(calibratedRed: 0.80, green: 0.84, blue: 0.90, alpha: 1).setFill()
    for i in 0..<3 {
        let y = (250 + CGFloat(i) * 70) * s
        NSBezierPath(roundedRect: NSRect(x: 230 * s, y: y, width: (i == 2 ? 330 : 564) * s, height: 26 * s),
                     xRadius: 13 * s, yRadius: 13 * s).fill()
    }

    // The mark: a bold "M" and a down arrow, in accent blue.
    let accent = NSColor(calibratedRed: 0.13, green: 0.42, blue: 0.95, alpha: 1)
    let font = NSFont.systemFont(ofSize: 360 * s, weight: .heavy)
    let m = NSAttributedString(string: "M", attributes: [.font: font, .foregroundColor: accent])
    let mSize = m.size()
    m.draw(at: NSPoint(x: 230 * s, y: 455 * s - (mSize.height - 360 * s) / 2))

    let arrow = NSBezierPath()
    let ax = 700 * s, top = 760 * s, bottom = 500 * s, w = 54 * s, head = 120 * s
    arrow.move(to: NSPoint(x: ax - w / 2, y: top))
    arrow.line(to: NSPoint(x: ax + w / 2, y: top))
    arrow.line(to: NSPoint(x: ax + w / 2, y: bottom + head))
    arrow.line(to: NSPoint(x: ax + head, y: bottom + head))
    arrow.line(to: NSPoint(x: ax, y: bottom))
    arrow.line(to: NSPoint(x: ax - head, y: bottom + head))
    arrow.line(to: NSPoint(x: ax - w / 2, y: bottom + head))
    arrow.close()
    arrow.lineJoinStyle = .round
    accent.setFill()
    arrow.fill()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        try draw(size: CGFloat(base * scale)).write(to: out.appending(path: name))
    }
}
