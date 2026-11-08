#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-portrait}"
OUTPUT="${WHISPLAY_HAT_PLUS_OUTPUT:-DSI-1}"
TOUCH_DEVICE="${WHISPLAY_HAT_PLUS_TOUCH_DEVICE:-Goodix Capacitive TouchScreen}"

usage() {
    cat <<'EOF'
Usage: set-hat-plus-orientation.sh [portrait|landscape|status]

Set the Whisplay Plus display orientation and matching touchscreen mapping.
The default mode is portrait.

Environment overrides:
  WHISPLAY_HAT_PLUS_OUTPUT        Wayland output name (default: DSI-1)
  WHISPLAY_HAT_PLUS_TOUCH_DEVICE Touch device name
                                  (default: Goodix Capacitive TouchScreen)
EOF
}

if [[ $# -gt 1 ]]; then
    usage >&2
    exit 2
fi

case "$MODE" in
    portrait)
        TRANSFORM="normal"
        TOUCH_MATRIX="1 0 0 0 1 0"
        ;;
    landscape)
        # Match Sky Console on the .253 Goodix panel: labwc maps the touch
        # device to DSI-1 and applies the output transform, so the touchscreen
        # itself must keep its native (identity) calibration matrix.
        TRANSFORM="270"
        TOUCH_MATRIX="1 0 0 0 1 0"
        ;;
    status)
        ;;
    -h|--help|help)
        usage
        exit 0
        ;;
    *)
        printf 'Unknown orientation: %s\n\n' "$MODE" >&2
        usage >&2
        exit 2
        ;;
esac

if [[ ${EUID:-$(id -u)} -eq 0 && -n ${SUDO_USER:-} ]]; then
    printf 'Run this script as the desktop user (%s), not with sudo.\n' "$SUDO_USER" >&2
    exit 1
fi

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
KANSHI_CONFIG="$CONFIG_HOME/kanshi/config"
LABWC_CONFIG="$CONFIG_HOME/labwc/rc.xml"

detect_wayland_session() {
    local runtime_dir candidate

    runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export XDG_RUNTIME_DIR="$runtime_dir"

    if [[ -n ${WAYLAND_DISPLAY:-} && -S "$runtime_dir/$WAYLAND_DISPLAY" ]]; then
        return 0
    fi

    for candidate in "$runtime_dir"/wayland-*; do
        if [[ -S "$candidate" ]]; then
            export WAYLAND_DISPLAY="${candidate##*/}"
            return 0
        fi
    done

    return 1
}

show_status() {
    printf 'Whisplay Plus orientation configuration\n'
    printf '  Output: %s\n' "$OUTPUT"

    if command -v wlr-randr >/dev/null 2>&1 && detect_wayland_session; then
        local active
        active="$(wlr-randr 2>/dev/null | awk -v output="$OUTPUT" '
            $0 ~ "^" output " " { found = 1; next }
            found && /^[^[:space:]]/ { exit }
            found && /Transform:/ { print $2; exit }
        ')"
        printf '  Active display transform: %s\n' "${active:-unknown}"
    else
        printf '  Active display transform: unavailable (no Wayland session)\n'
    fi

    if [[ -f "$KANSHI_CONFIG" ]]; then
        local persisted
        persisted="$(awk -v output="$OUTPUT" '
            $1 == "output" && $2 == output {
                for (i = 1; i <= NF; i++) {
                    if ($i == "transform") {
                        print $(i + 1)
                        exit
                    }
                }
            }
        ' "$KANSHI_CONFIG")"
        printf '  Persisted display transform: %s\n' "${persisted:-not configured}"
    else
        printf '  Persisted display transform: not configured\n'
    fi

    if [[ -f "$LABWC_CONFIG" ]]; then
        local matrix
        matrix="$(python3 - "$LABWC_CONFIG" "$TOUCH_DEVICE" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, device_name = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except (OSError, ET.ParseError):
    raise SystemExit(0)

def local_name(element):
    return element.tag.rsplit("}", 1)[-1]

for element in root.iter():
    if (
        local_name(element) == "device"
        and element.get("category") == device_name
    ):
        for child in element:
            if local_name(child) == "calibrationMatrix":
                print((child.text or "").strip())
                raise SystemExit(0)
PY
)"
        printf '  Touch calibration matrix: %s\n' "${matrix:-not configured}"
    else
        printf '  Touch calibration matrix: not configured\n'
    fi
}

if [[ "$MODE" == "status" ]]; then
    show_status
    exit 0
fi

mkdir -p "$(dirname "$KANSHI_CONFIG")" "$(dirname "$LABWC_CONFIG")"

if [[ -f "$KANSHI_CONFIG" && ! -f "$KANSHI_CONFIG.before-whisplay-orientation" ]]; then
    cp -p "$KANSHI_CONFIG" "$KANSHI_CONFIG.before-whisplay-orientation"
fi
if [[ -f "$LABWC_CONFIG" && ! -f "$LABWC_CONFIG.before-whisplay-orientation" ]]; then
    cp -p "$LABWC_CONFIG" "$LABWC_CONFIG.before-whisplay-orientation"
fi

python3 - "$KANSHI_CONFIG" "$OUTPUT" "$TRANSFORM" <<'PY'
import os
import re
import sys
import tempfile

path, output, transform = sys.argv[1:]
try:
    with open(path, "r", encoding="utf-8") as config_file:
        content = config_file.read()
except FileNotFoundError:
    content = ""

output_pattern = re.compile(
    rf"^(?P<indent>\s*)output\s+(?P<name>{re.escape(output)}|\"{re.escape(output)}\")(?P<options>[^\n]*)$",
    re.MULTILINE,
)

def update_output(match):
    options = match.group("options")
    if re.search(r"(?:^|\s)transform\s+\S+", options):
        options = re.sub(
            r"((?:^|\s)transform\s+)\S+",
            rf"\g<1>{transform}",
            options,
            count=1,
        )
    else:
        options = f"{options} transform {transform}"
    return f'{match.group("indent")}output {match.group("name")}{options}'

content, replacements = output_pattern.subn(update_output, content)
if replacements == 0:
    if content and not content.endswith("\n"):
        content += "\n"
    content += (
        "\n# BEGIN whisplay-plus orientation\n"
        "profile whisplay-plus {\n"
        f"    output {output} enable transform {transform} scale 1 position 0,0\n"
        "}\n"
        "# END whisplay-plus orientation\n"
    )

directory = os.path.dirname(path)
with tempfile.NamedTemporaryFile(
    "w", encoding="utf-8", dir=directory, delete=False
) as temp_file:
    temp_file.write(content)
    temp_path = temp_file.name
os.chmod(temp_path, 0o644)
os.replace(temp_path, path)
PY

python3 - "$LABWC_CONFIG" "$OUTPUT" "$TOUCH_DEVICE" "$TOUCH_MATRIX" <<'PY'
import os
import sys
import tempfile
import xml.etree.ElementTree as ET

path, output, device_name, matrix = sys.argv[1:]
parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))

try:
    tree = ET.parse(path, parser=parser)
    root = tree.getroot()
except FileNotFoundError:
    root = ET.Element("openbox_config", {"xmlns": "http://openbox.org/3.4/rc"})
    tree = ET.ElementTree(root)
except ET.ParseError as error:
    raise SystemExit(f"Cannot update invalid labwc config {path}: {error}")

if root.tag.startswith("{"):
    namespace = root.tag[1:].split("}", 1)[0]
    ET.register_namespace("", namespace)
else:
    namespace = ""

def qualified(name):
    return f"{{{namespace}}}{name}" if namespace else name

def local_name(element):
    return element.tag.rsplit("}", 1)[-1] if isinstance(element.tag, str) else ""

touch = next(
    (
        element
        for element in root
        if local_name(element) == "touch"
        and element.get("deviceName") == device_name
    ),
    None,
)
if touch is None:
    touch = ET.SubElement(root, qualified("touch"))
    touch.set("deviceName", device_name)
touch.set("mapToOutput", output)
if "mouseEmulation" not in touch.attrib:
    touch.set("mouseEmulation", "no")

libinput = next(
    (element for element in root if local_name(element) == "libinput"),
    None,
)
if libinput is None:
    libinput = ET.SubElement(root, qualified("libinput"))

device = next(
    (
        element
        for element in libinput
        if local_name(element) == "device"
        and element.get("category") == device_name
    ),
    None,
)
if device is None:
    device = ET.SubElement(libinput, qualified("device"))
    device.set("category", device_name)

calibration = next(
    (
        element
        for element in device
        if local_name(element) == "calibrationMatrix"
    ),
    None,
)
if calibration is None:
    calibration = ET.SubElement(device, qualified("calibrationMatrix"))
calibration.text = matrix

ET.indent(tree, space="    ")
directory = os.path.dirname(path)
with tempfile.NamedTemporaryFile("wb", dir=directory, delete=False) as temp_file:
    tree.write(temp_file, encoding="utf-8", xml_declaration=True)
    temp_path = temp_file.name
os.chmod(temp_path, 0o644)
os.replace(temp_path, path)
PY

LIVE_APPLIED=false
if detect_wayland_session; then
    if command -v wlr-randr >/dev/null 2>&1; then
        wlr-randr --output "$OUTPUT" --transform "$TRANSFORM"
        LIVE_APPLIED=true
    else
        printf 'Warning: wlr-randr is not installed; display changes apply after login.\n' >&2
    fi

    while read -r pid; do
        [[ -n "$pid" ]] && kill -HUP "$pid"
    done < <(pgrep -u "$(id -u)" -x kanshi || true)

    while read -r pid; do
        [[ -n "$pid" ]] && kill -HUP "$pid"
    done < <(pgrep -u "$(id -u)" -x labwc || true)
else
    printf 'No active Wayland session found; settings will apply at next login.\n'
fi

printf 'Whisplay Plus orientation set to %s.\n' "$MODE"
printf '  Display: %s (transform %s)\n' "$OUTPUT" "$TRANSFORM"
printf '  Touch: %s (matrix %s)\n' "$TOUCH_DEVICE" "$TOUCH_MATRIX"
printf '  Persistent configs: %s, %s\n' "$KANSHI_CONFIG" "$LABWC_CONFIG"
if [[ "$LIVE_APPLIED" == true ]]; then
    printf '  Applied to the active Wayland session.\n'
fi
