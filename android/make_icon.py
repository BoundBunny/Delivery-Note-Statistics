"""Install approved DNS artwork in Android and the offline web application.

Run with Python 3 from any directory; no third-party packages are required.
The approved artwork lives in design/dns-logo-v1 and is not redrawn here.
"""

from pathlib import Path
import re
import shutil
import struct
import xml.etree.ElementTree as ET


ANDROID = Path(__file__).resolve().parent
ARTWORK = ANDROID / "design" / "dns-logo-v1"
RES = ANDROID / "app" / "src" / "main" / "res"
WEB_APPS = (ANDROID.parent / "app", ANDROID / "app" / "src" / "main" / "assets" / "app")
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)


def attribute(name):
    return f"{{{ANDROID_NS}}}{name}"


def rectangle_path(element):
    x, y, width, height = (float(element.get(name, "0")) for name in ("x", "y", "width", "height"))
    radius = min(float(element.get("rx", "0")), width / 2, height / 2)
    right, bottom = x + width, y + height
    return (
        f"M{x + radius:g},{y:g} H{right - radius:g} "
        f"A{radius:g},{radius:g} 0 0 1 {right:g},{y + radius:g} V{bottom - radius:g} "
        f"A{radius:g},{radius:g} 0 0 1 {right - radius:g},{bottom:g} H{x + radius:g} "
        f"A{radius:g},{radius:g} 0 0 1 {x:g},{bottom - radius:g} V{y + radius:g} "
        f"A{radius:g},{radius:g} 0 0 1 {x + radius:g},{y:g} Z"
    )


def adaptive_foreground():
    source = ET.parse(ARTWORK / "dns-icon.svg").getroot()
    vector = ET.Element("vector", {
        attribute("width"): "108dp", attribute("height"): "108dp",
        attribute("viewportWidth"): "768", attribute("viewportHeight"): "768",
    })
    # Center approved 512-unit artwork inside the 768-unit adaptive layer.
    # The launcher supplies the amber background and its own outer mask.
    content = ET.SubElement(vector, "group", {attribute("translateX"): "128", attribute("translateY"): "128"})
    removed_background = False
    for element in source:
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "title":
            continue
        if tag == "rect" and element.get("width") == "496" and element.get("height") == "496":
            removed_background = True
            continue
        if tag not in ("rect", "path"):
            raise ValueError(f"Unsupported artwork element: {tag}")
        parent = content
        transform = element.get("transform", "")
        transforms = re.findall(r"(translate|scale)\(([^)]*)\)", transform)
        if re.sub(r"(translate|scale)\([^)]*\)", "", transform).strip():
            raise ValueError(f"Unsupported artwork transform: {transform}")
        for kind, arguments in transforms:
            values = arguments.replace(",", " ").split()
            if len(values) not in (1, 2):
                raise ValueError(f"Invalid artwork transform: {transform}")
            second = values[1] if len(values) == 2 else (values[0] if kind == "scale" else "0")
            parent = ET.SubElement(parent, "group", {
                attribute(f"{kind}X"): values[0], attribute(f"{kind}Y"): second,
            })
        attrs = {
            attribute("pathData"): rectangle_path(element) if tag == "rect" else element.attrib["d"],
            attribute("fillColor"): "#00000000" if element.get("fill") == "none" else element.get("fill", "#000000"),
        }
        if element.get("fill-rule") == "evenodd":
            attrs[attribute("fillType")] = "evenOdd"
        for svg_name, android_name in (
            ("stroke", "strokeColor"), ("stroke-width", "strokeWidth"),
            ("stroke-linecap", "strokeLineCap"), ("stroke-linejoin", "strokeLineJoin"),
        ):
            if svg_name in element.attrib:
                attrs[attribute(android_name)] = element.attrib[svg_name]
        ET.SubElement(parent, "path", attrs)
    if not removed_background:
        raise ValueError("The approved logo background was not found.")
    return vector


def write_xml(path, root):
    path.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(root, space="    ")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def main():
    foreground = adaptive_foreground()
    for size in DENSITIES.values():
        data = (ARTWORK / f"dns-icon-{size}.png").read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", data[16:24]) != (size, size):
            raise ValueError(f"Invalid approved icon export: {size}")
    for density, size in DENSITIES.items():
        destination = RES / f"mipmap-{density}" / "ic_launcher.png"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ARTWORK / f"dns-icon-{size}.png", destination)
        print(f"Android {density}: {size} x {size}")

    write_xml(RES / "drawable" / "ic_launcher_foreground.xml", foreground)
    colors = ET.Element("resources")
    ET.SubElement(colors, "color", {"name": "ic_launcher_background"}).text = "#D99A2B"
    write_xml(RES / "values" / "brand_colors.xml", colors)
    adaptive = ET.Element("adaptive-icon")
    ET.SubElement(adaptive, "background", {attribute("drawable"): "@color/ic_launcher_background"})
    ET.SubElement(adaptive, "foreground", {attribute("drawable"): "@drawable/ic_launcher_foreground"})
    write_xml(RES / "mipmap-anydpi-v26" / "ic_launcher.xml", adaptive)

    for app in WEB_APPS:
        brand = app / "assets" / "brand"
        brand.mkdir(parents=True, exist_ok=True)
        for filename in ("dns-icon.svg", "dns-icon-48.png", "dns-icon-192.png", "dns-logo.svg", "dns-logo.png"):
            shutil.copyfile(ARTWORK / filename, brand / filename)
        print(f"Web brand assets: {brand}")


if __name__ == "__main__":
    main()
