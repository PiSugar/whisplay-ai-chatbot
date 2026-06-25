from PIL import Image, ImageDraw, ImageFont
import os
import time
import socket
import json
import sys
import threading
import signal
import re

from camera import CameraThread
from utils import ColorUtils, ImageUtils, TextUtils
from whisplay_client import create_whisplay_hardware

STATUS_ICON_DIR = os.path.join(os.path.dirname(__file__), "status-bar-icon")
if STATUS_ICON_DIR not in sys.path:
    sys.path.append(STATUS_ICON_DIR)

from battery_icon import BatteryStatusIcon
from wifi_icon import WifiStatusIcon
from rag_icon import RagStatusIcon
from image_icon import ImageStatusIcon
from wireguard_icon import WireguardStatusIcon

scroll_thread = None
scroll_stop_event = threading.Event()

status_font_size=20
emoji_font_size=40
battery_font_size=13
IDLE_RENDER_INTERVAL = 0.5
MAX_MAIN_TEXT_CHARS = 2200
TRUNCATION_PREFIX = "... "
TOOL_TAG_RE = re.compile(
    r"[%％﹪]\s*([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)(?:\s+([0-9]+s))?",
    re.IGNORECASE,
)
TOOL_TAG_BG = (8, 42, 112, 255)
TOOL_TAG_FG = (255, 255, 255, 255)
TOOL_TAG_COUNT_FG = (122, 205, 255, 255)
TOOL_TAG_MARGIN_Y = 2

# Global variables
current_status = "Hello"
current_emoji = "😄"
current_text = "Waiting for message..."
current_terminal_text = ""
current_battery_level = 100
current_battery_color = ColorUtils.get_rgb255_from_any("#55FF00")
current_scroll_top = 0
DEFAULT_SCROLL_SPEED = 0.25
MAX_SCROLL_SPEED = 0.5
current_scroll_speed = DEFAULT_SCROLL_SPEED
current_scroll_sync_char_end = None
current_scroll_sync_duration_ms = None
current_scroll_sync_target_top = None
current_scroll_sync_speed = None
current_scroll_sync_hold_until = 0.0
current_transaction_id = None
current_image_path = ""
current_image = None
current_network_connected = None
current_wifi_signal_level = 0
current_vpn_connected = False
current_rag_icon_visible = False
current_image_icon_visible = False
current_music_progress = None
current_music_duration_ms = None
current_approval_mode = False
camera_mode = False
camera_capture_image_path = ""
camera_thread = None
render_thread = None
clients = {}
status_icon_factories = []
shutdown_requested = False


def register_status_icon_factory(factory, priority=100):
    status_icon_factories.append({"priority": priority, "factory": factory})

class RenderThread(threading.Thread):
    def __init__(self, whisplay, font_path, fps=30):
        super().__init__()
        self.whisplay = whisplay
        self.font_path = font_path
        self.fps = fps
        self.render_init_screen()
        # Clear logo after 1 second and start running loop
        time.sleep(1)
        self.running = True
        self.status_font = ImageFont.truetype(self.font_path, status_font_size)
        self.emoji_font = ImageFont.truetype(self.font_path, emoji_font_size)
        self.battery_font = ImageFont.truetype(self.font_path, battery_font_size)
        self.main_text_font = ImageFont.truetype(self.font_path, 20)
        self.tool_tag_font = ImageFont.truetype(self.font_path, 17)
        self.terminal_text_font = ImageFont.truetype(self.font_path, 12)
        self.terminal_text_line_height = self.terminal_text_font.getmetrics()[0] + self.terminal_text_font.getmetrics()[1]
        self.music_time_font = ImageFont.truetype(self.font_path, 10)
        self.main_text_line_height = self.main_text_font.getmetrics()[0] + self.main_text_font.getmetrics()[1]
        self.text_cache_image = None
        self.current_render_text = ""
        self.main_text_cache_key = ""
        self.main_text_cache_lines = []
        self.main_text_cache_char_offset = 0
        self.pending_auto_scroll_after_hold = False
        self.render_event = threading.Event()

    def render_init_screen(self):
        # Display logo on startup
        logo_path = os.path.join("img", "logo.png")
        if os.path.exists(logo_path):
            logo_image = Image.open(logo_path).convert("RGBA")
            logo_image = logo_image.resize((whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT), Image.LANCZOS)
            rgb565_data = ImageUtils.image_to_rgb565(logo_image, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)
            whisplay.set_backlight(100)
            whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, rgb565_data)

    def render_frame(self, status, emoji, text, scroll_top, battery_level, battery_color):
        global current_scroll_speed, current_image_path, current_image, camera_mode
        self.pending_auto_scroll_after_hold = False
        if camera_mode:
            return False  # Skip rendering if in camera mode
        if current_image_path not in [None, ""]:
            # Try to load image from path
            if current_image is not None:
                rgb565_data = ImageUtils.image_to_rgb565(current_image, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT)
                self.whisplay.draw_image(0, 0, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT, rgb565_data)
            elif os.path.exists(current_image_path):
                try:
                    image = Image.open(current_image_path).convert("RGBA") # 1024x1024
                    # crop center and resize to fit screen ratio
                    img_w, img_h = image.size
                    screen_ratio = self.whisplay.LCD_WIDTH / self.whisplay.LCD_HEIGHT
                    img_ratio = img_w / img_h
                    if img_ratio > screen_ratio:
                        # crop width
                        new_w = int(img_h * screen_ratio)
                        left = (img_w - new_w) // 2
                        image = image.crop((left, 0, left + new_w, img_h))
                    else:
                        # crop height
                        new_h = int(img_w / screen_ratio)
                        top = (img_h - new_h) // 2
                        image = image.crop((0, top, img_w, top + new_h))
                    image = image.resize((self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT), Image.LANCZOS)
                    current_image = image
                    rgb565_data = ImageUtils.image_to_rgb565(image, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT)
                    self.whisplay.draw_image(0, 0, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT, rgb565_data)
                except Exception as e:
                    print(f"[Render] Failed to load image {current_image_path}: {e}")
            return False
        else:
            current_image = None
            header_height = 88 + 10  # header + margin
            # create a black background image for header
            image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, header_height), (0, 0, 0, 255))
            draw = ImageDraw.Draw(image)
            
            clock_font_size = 24
            # clock_font = ImageFont.truetype(self.font_path, clock_font_size)

            # current_time = time.strftime("%H:%M:%S")
            # draw.text((self.whisplay.LCD_WIDTH // 2, self.whisplay.LCD_HEIGHT // 2), current_time, font=clock_font, fill=(255, 255, 255, 255))
            
            # render header
            self.render_header(image, draw, status, emoji, battery_level, battery_color)
            self.whisplay.draw_image(0, 0, self.whisplay.LCD_WIDTH, header_height, ImageUtils.image_to_rgb565(image, self.whisplay.LCD_WIDTH, header_height))

            # render music progress bar if active
            progress_bar_height = 0
            if current_music_progress is not None:
                progress_bar_height = 22
                pb_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, progress_bar_height), (0, 0, 0, 255))
                pb_draw = ImageDraw.Draw(pb_image)
                margin = 10
                bar_w = self.whisplay.LCD_WIDTH - 2 * margin
                bar_h = 4
                # time labels above the bar
                elapsed_ms = int((current_music_duration_ms or 0) * min(1.0, max(0.0, current_music_progress)))
                total_ms = current_music_duration_ms or 0
                elapsed_str = "%d:%02d" % (elapsed_ms // 60000, (elapsed_ms % 60000) // 1000)
                total_str = "%d:%02d" % (total_ms // 60000, (total_ms % 60000) // 1000)
                pb_draw.text((margin, 0), elapsed_str, font=self.music_time_font, fill=(180, 180, 180, 255))
                total_bbox = self.music_time_font.getbbox(total_str)
                total_w = total_bbox[2] - total_bbox[0]
                pb_draw.text((margin + bar_w - total_w, 0), total_str, font=self.music_time_font, fill=(180, 180, 180, 255))
                # progress bar below time labels
                bar_y = progress_bar_height - bar_h - 2
                # background track
                pb_draw.rounded_rectangle([margin, bar_y, margin + bar_w, bar_y + bar_h], radius=2, fill=(60, 60, 60, 255))
                # filled portion
                fill_w = max(0, int(bar_w * min(1.0, max(0.0, current_music_progress))))
                if fill_w > 0:
                    pb_draw.rounded_rectangle([margin, bar_y, margin + fill_w, bar_y + bar_h], radius=2, fill=(0, 102, 170, 255))
                self.whisplay.draw_image(0, header_height, self.whisplay.LCD_WIDTH, progress_bar_height, ImageUtils.image_to_rgb565(pb_image, self.whisplay.LCD_WIDTH, progress_bar_height))

            # render main text area
            approval_bar_height = 38 if current_approval_mode else 0
            text_area_height = self.whisplay.LCD_HEIGHT - header_height - progress_bar_height - approval_bar_height
            text_bg_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, text_area_height), (0, 0, 0, 255))
            text_draw = ImageDraw.Draw(text_bg_image)
            if current_terminal_text:
                animation_active = self.render_terminal_text(text_bg_image, text_area_height, text_draw, current_terminal_text)
            else:
                animation_active = self.render_main_text(text_bg_image, text_area_height, text_draw, text, current_scroll_speed)
            self.whisplay.draw_image(0, header_height + progress_bar_height, self.whisplay.LCD_WIDTH, text_area_height, ImageUtils.image_to_rgb565(text_bg_image, self.whisplay.LCD_WIDTH, text_area_height))
            if current_approval_mode:
                approval_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, approval_bar_height), (0, 0, 0, 255))
                approval_draw = ImageDraw.Draw(approval_image)
                self.render_approval_actions(approval_image, approval_draw)
                self.whisplay.draw_image(0, self.whisplay.LCD_HEIGHT - approval_bar_height, self.whisplay.LCD_WIDTH, approval_bar_height, ImageUtils.image_to_rgb565(approval_image, self.whisplay.LCD_WIDTH, approval_bar_height))

            return animation_active

        

    def compute_scroll_target_from_char_end(self, lines, line_height, area_height, char_end):
        if char_end is None or char_end <= 0:
            return 0
        total_chars = 0
        line_top = 0
        target_line = 0
        target_top = 0
        for i, line in enumerate(lines):
            item_height = self.line_item_height(line, line_height)
            line_text = "" if self.is_tool_tag_line(line) else str(line)
            total_chars += len(line_text)
            if total_chars >= char_end:
                target_line = i
                target_top = line_top
                break
            if i < len(lines) - 1:
                total_chars += 1
            line_top += item_height
        target_top = target_top - (area_height // 2)
        return max(0, target_top)

    def render_main_text(self, main_text_image, area_height, draw, text, scroll_speed=2):
        global current_scroll_top, current_scroll_sync_char_end
        global current_scroll_sync_duration_ms, current_scroll_sync_target_top
        global current_scroll_sync_speed, current_scroll_sync_hold_until
        """Render main text content, wrap lines according to screen width, only display currently visible part"""
        if not text:
            self.pending_auto_scroll_after_hold = False
            return False
        font = self.main_text_font
        line_height = self.main_text_line_height
        display_text, char_offset = self.limit_main_text(text)
        if display_text != self.main_text_cache_key:
            self.main_text_cache_key = display_text
            self.main_text_cache_char_offset = char_offset
            self.main_text_cache_lines = self.build_main_text_lines(
                draw,
                display_text,
                font,
                self.whisplay.LCD_WIDTH - 20,
            )
        lines = self.main_text_cache_lines

        content_height = sum(self.line_item_height(line, line_height) for line in lines) + line_height
        max_scroll_top = max(0, content_height - area_height)
        if current_scroll_top > max_scroll_top:
            current_scroll_top = max_scroll_top

        if current_scroll_sync_char_end is not None and current_scroll_sync_duration_ms is not None:
            adjusted_char_end = max(0, current_scroll_sync_char_end - char_offset)
            target_top = self.compute_scroll_target_from_char_end(
                lines, line_height, area_height, adjusted_char_end
            )
            target_top = min(max_scroll_top, target_top)
            target_top = max(current_scroll_top, target_top)
            duration_ms = max(1, current_scroll_sync_duration_ms)
            frames = max(1, int(duration_ms * self.fps / 1000))
            current_scroll_sync_target_top = target_top
            current_scroll_sync_speed = (target_top - current_scroll_top) / frames
            current_scroll_sync_char_end = None
            current_scroll_sync_duration_ms = None

        # Calculate currently visible lines
        display_lines = []
        render_y = 0
        line_top = 0
        fin_show_lines = False
        for line in lines:
            item_height = self.line_item_height(line, line_height)
            line_bottom = line_top + item_height
            if line_bottom >= current_scroll_top and line_top - current_scroll_top <= area_height:
                display_lines.append((line, line_top))
                fin_show_lines = True
            elif fin_show_lines is False:
                render_y += item_height
            line_top = line_bottom
        
        # render_text
        render_text = ""
        for line, _ in display_lines:
            if self.is_tool_tag_line(line):
                render_text += f"%{line.get('label', '')}{line.get('elapsed', '')}x{line.get('count', 1)}"
            else:
                render_text += str(line)
        if self.current_render_text != render_text:
            self.current_render_text = render_text
            visible_height = 0
            for line, _ in display_lines:
                visible_height += self.line_item_height(line, line_height)
            show_text_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, render_y + visible_height), (0, 0, 0, 255))
            show_text_draw = ImageDraw.Draw(show_text_image)
            for line, _ in display_lines:
                item_height = self.line_item_height(line, line_height)
                if self.is_tool_tag_line(line):
                    self.draw_tool_tag(show_text_draw, line.get("label", ""), int(line.get("count", 1)), line.get("elapsed", ""), 10, render_y, self.whisplay.LCD_WIDTH - 20, item_height)
                else:
                    TextUtils.draw_mixed_text(show_text_draw, show_text_image, str(line), font, (10, render_y))
                render_y += item_height
            # Update cache image
            self.text_cache_image = show_text_image
        # Draw text_cache_image to main_text_image
        main_text_image.paste(self.text_cache_image, (0, -int(current_scroll_top)), self.text_cache_image)

        # Update scroll position
        if current_scroll_sync_speed is not None and current_scroll_sync_target_top is not None:
            remaining = current_scroll_sync_target_top - current_scroll_top
            if abs(remaining) <= abs(current_scroll_sync_speed):
                current_scroll_top = current_scroll_sync_target_top
                current_scroll_sync_speed = None
                current_scroll_sync_target_top = None
            else:
                current_scroll_top += current_scroll_sync_speed
        elif (
            scroll_speed > 0
            and current_scroll_top < max_scroll_top
            and time.time() >= current_scroll_sync_hold_until
        ):
            current_scroll_top += scroll_speed
        if current_scroll_top > max_scroll_top:
            current_scroll_top = max_scroll_top
        self.pending_auto_scroll_after_hold = (
            scroll_speed > 0
            and current_scroll_top < max_scroll_top
            and time.time() < current_scroll_sync_hold_until
        )
        return (
            (
                current_scroll_sync_speed is not None
                and current_scroll_sync_target_top is not None
            )
            or (
                scroll_speed > 0
                and current_scroll_top < max_scroll_top
                and time.time() >= current_scroll_sync_hold_until
            )
        )

    def limit_main_text(self, text):
        if len(text) <= MAX_MAIN_TEXT_CHARS:
            return text, 0
        start = max(0, len(text) - MAX_MAIN_TEXT_CHARS)
        while start < len(text) and not text[start].isspace():
            start += 1
        if start >= len(text):
            start = max(0, len(text) - MAX_MAIN_TEXT_CHARS)
        return TRUNCATION_PREFIX + text[start:].lstrip(), start

    def is_tool_tag_line(self, line):
        return isinstance(line, dict) and line.get("type") == "tool_tag"

    def line_item_height(self, line, line_height):
        if self.is_tool_tag_line(line):
            return line_height + TOOL_TAG_MARGIN_Y * 2
        return line_height

    def build_main_text_lines(self, draw, text, font, max_width):
        lines = []
        pending_tool_name = ""
        pending_tool_count = 0
        pending_tool_elapsed = ""

        def flush_tool_tag():
            nonlocal pending_tool_name, pending_tool_count, pending_tool_elapsed
            if not pending_tool_name or pending_tool_count <= 0:
                return
            lines.append({
                "type": "tool_tag",
                "label": pending_tool_name,
                "count": pending_tool_count,
                "elapsed": pending_tool_elapsed,
            })
            pending_tool_name = ""
            pending_tool_count = 0
            pending_tool_elapsed = ""

        def append_tool_tag(name, elapsed=""):
            nonlocal pending_tool_name, pending_tool_count, pending_tool_elapsed
            if pending_tool_name and pending_tool_name != name:
                flush_tool_tag()
            pending_tool_name = name
            pending_tool_count += 1
            if elapsed:
                pending_tool_elapsed = elapsed

        def append_text(value):
            parts = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
            for i, raw_line in enumerate(parts):
                if raw_line:
                    lines.extend(TextUtils.wrap_text(draw, raw_line, font, max_width))
                elif lines and 0 < i < len(parts) - 1:
                    lines.append("")

        def is_tool_arg_token(token, current_tool=""):
            if re.fullmatch(r"[A-Za-z0-9_./:=+-]+", token):
                return True
            return False

        def consume_tail_after_marker(value, tool_name=""):
            tail = value.lstrip(" \t:-—,，.。…")
            if not tail:
                return "", 0
            extra_count = 0
            consumed_current_arg = False
            while tail:
                parts = tail.split(None, 1)
                first = parts[0]
                rest = parts[1].lstrip(" \t:-—,，.。…") if len(parts) > 1 else ""
                if tool_name and first.lower() == tool_name.lower():
                    extra_count += 1
                    tail = rest
                    parts = tail.split(None, 1)
                    if parts and is_tool_arg_token(parts[0], tool_name):
                        tail = parts[1].lstrip(" \t:-—,，.。…") if len(parts) > 1 else ""
                    continue
                if not consumed_current_arg and is_tool_arg_token(first, tool_name):
                    consumed_current_arg = True
                    tail = rest
                    continue
                return tail, extra_count
            return "", extra_count

        for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            matches = list(TOOL_TAG_RE.finditer(raw_line))
            if not matches:
                flush_tool_tag()
                append_text(raw_line)
                continue
            before = raw_line[:matches[0].start()]
            if before.strip():
                flush_tool_tag()
                append_text(before)
            cursor = matches[0].start()
            for match in matches:
                between = raw_line[cursor:match.start()]
                visible_between, extra_count = consume_tail_after_marker(
                    between,
                    pending_tool_name if pending_tool_name else "",
                )
                for _ in range(extra_count):
                    append_tool_tag(pending_tool_name)
                if visible_between.strip():
                    flush_tool_tag()
                    append_text(visible_between)
                append_tool_tag(match.group(1), match.group(2) or "")
                cursor = match.end()
            tail, extra_count = consume_tail_after_marker(raw_line[cursor:], pending_tool_name)
            for _ in range(extra_count):
                append_tool_tag(pending_tool_name)
            if tail.strip():
                flush_tool_tag()
                append_text(tail)
        flush_tool_tag()
        return lines

    def draw_tool_tag(self, draw, label, count, elapsed, x, y, max_width, line_height):
        tag_font = self.tool_tag_font
        bbox = tag_font.getbbox(label)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        suffix_texts = []
        if count > 1:
            suffix_texts.append(f"x{count}")
        if elapsed:
            suffix_texts.append(str(elapsed))
        suffix_text = " ".join(suffix_texts)
        suffix_bbox = tag_font.getbbox(suffix_text) if suffix_text else (0, 0, 0, 0)
        suffix_w = suffix_bbox[2] - suffix_bbox[0]
        suffix_gap = 7 if suffix_text else 0
        pad_x = 10
        tag_w = min(max_width, text_w + suffix_gap + suffix_w + pad_x * 2)
        inner_h = max(1, line_height - TOOL_TAG_MARGIN_Y * 2)
        tag_h = min(max(12, inner_h - 2), 22)
        tag_y = y + TOOL_TAG_MARGIN_Y + max(0, (inner_h - tag_h) // 2)
        draw.rounded_rectangle(
            [x, tag_y, x + tag_w, tag_y + tag_h],
            radius=6,
            fill=TOOL_TAG_BG,
        )
        content_w = text_w + suffix_gap + suffix_w
        text_x = x + (tag_w - content_w) // 2
        text_y = tag_y + (tag_h - text_h) // 2 - bbox[1]
        draw.text((text_x, text_y), label, font=tag_font, fill=TOOL_TAG_FG)
        if suffix_text:
            suffix_x = text_x + text_w + suffix_gap
            draw.text((suffix_x, text_y), suffix_text, font=tag_font, fill=TOOL_TAG_COUNT_FG)

    def render_terminal_text(self, main_text_image, area_height, draw, text):
        global current_scroll_top, current_scroll_sync_speed, current_scroll_sync_target_top
        self.pending_auto_scroll_after_hold = False
        current_scroll_top = 0
        current_scroll_sync_speed = None
        current_scroll_sync_target_top = None
        font = self.terminal_text_font
        line_height = self.terminal_text_line_height
        lines = self.wrap_terminal_text(draw, text, font, self.whisplay.LCD_WIDTH - 12)
        visible_line_count = max(1, area_height // max(1, line_height))
        display_lines = lines[-visible_line_count:]
        render_text = "\n".join(display_lines)
        if self.current_render_text != render_text:
            self.current_render_text = render_text
            show_text_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, len(display_lines) * line_height), (0, 0, 0, 255))
            show_text_draw = ImageDraw.Draw(show_text_image)
            render_y = 0
            for line in display_lines:
                show_text_draw.text((6, render_y), line, font=font, fill=(216, 255, 228, 255))
                render_y += line_height
            self.text_cache_image = show_text_image
        main_text_image.paste(self.text_cache_image, (0, 0), self.text_cache_image)
        return False

    def wrap_terminal_text(self, draw, text, font, max_width):
        lines = []
        for raw_line in text.splitlines() or [""]:
            current = ""
            for char in raw_line:
                candidate = current + char
                bbox = draw.textbbox((0, 0), candidate, font=font)
                if current and bbox[2] - bbox[0] > max_width:
                    lines.append(current)
                    current = char
                else:
                    current = candidate
            lines.append(current)
        return lines

    def request_render(self):
        self.render_event.set()
                

    def render_header(self, image, draw, status, emoji, battery_level, battery_color):
        global current_status, current_emoji, current_battery_level, current_battery_color
        global status_font_size, emoji_font_size, battery_font_size
        
        status_font = self.status_font
        emoji_font = self.emoji_font
        battery_font = self.battery_font

        image_width = self.whisplay.LCD_WIDTH

        ascent_status, _ = status_font.getmetrics()
        ascent_emoji, _ = emoji_font.getmetrics()

        top_height = status_font_size + emoji_font_size + 20

        # Draw status centered
        status_bbox = status_font.getbbox(current_status)
        status_w = status_bbox[2] - status_bbox[0]
        TextUtils.draw_mixed_text(draw, image, current_status, status_font, (whisplay.CornerHeight, 0))

        # Draw emoji centered
        emoji_bbox = emoji_font.getbbox(current_emoji)
        emoji_w = emoji_bbox[2] - emoji_bbox[0]
        TextUtils.draw_mixed_text(draw, image, current_emoji, emoji_font, ((image_width - emoji_w) // 2, status_font_size + 8))
        
        # Draw battery icon
        status_icon_context = {
            "battery_level": battery_level,
            "battery_color": battery_color,
            "battery_font": battery_font,
            "status_font_size": status_font_size,
            "network_connected": current_network_connected,
            "wifi_signal_level": current_wifi_signal_level,
            "vpn_connected": current_vpn_connected,
            "rag_icon_visible": current_rag_icon_visible,
            "image_icon_visible": current_image_icon_visible,
        }
        status_icons = self.build_status_icons(status_icon_context)
        self.render_status_icons(draw, status_icons, image_width)
        
        return top_height

    def build_status_icons(self, context):
        icons = []
        battery_level = context.get("battery_level")
        battery_color = context.get("battery_color")
        battery_font = context.get("battery_font")
        status_font_size = context.get("status_font_size")

        if battery_level is not None:
            icons.append(BatteryStatusIcon(battery_level, battery_color, battery_font, status_font_size))
        if context.get("wifi_signal_level"):
            icons.append(WifiStatusIcon(status_font_size, context.get("wifi_signal_level")))
        if context.get("vpn_connected"):
            icons.append(WireguardStatusIcon(status_font_size))
        if context.get("image_icon_visible"):
            icons.append(ImageStatusIcon(status_font_size))
        if context.get("rag_icon_visible"):
            icons.append(RagStatusIcon(status_font_size))

        for item in sorted(status_icon_factories, key=lambda entry: entry["priority"]):
            icon_list = item["factory"](context)
            if icon_list:
                icons.extend(icon_list)
        return icons

    def render_status_icons(self, draw, icons, image_width):
        if not icons:
            return
        right_margin = 10
        icon_gap = 8
        cursor_x = image_width - right_margin
        for icon in icons:
            icon_width, _ = icon.measure()
            icon_x = cursor_x - icon_width
            icon_y = icon.get_top_y()
            icon.render(draw, icon_x, icon_y)
            cursor_x = icon_x - icon_gap

    def render_approval_actions(self, image, draw):
        width, height = image.size
        font = ImageFont.truetype(self.font_path, 12)
        allow_color = (48, 209, 88, 255)
        deny_color = (255, 69, 58, 255)
        text_color = (235, 242, 247, 255)
        draw.line([(10, 0), (width - 10, 0)], fill=(38, 38, 38, 255), width=1)

        allow_x = 20
        deny_x = width // 2 + 12
        cy = height // 2 + 1
        dot_r = 5
        draw.ellipse(
            [allow_x, cy - dot_r, allow_x + dot_r * 2, cy + dot_r],
            fill=allow_color,
        )
        draw.text((allow_x + 16, cy - 8), "Allow", font=font, fill=text_color)

        pill_w = 22
        pill_h = 10
        draw.rounded_rectangle(
            [deny_x, cy - pill_h // 2, deny_x + pill_w, cy + pill_h // 2],
            radius=pill_h // 2,
            fill=deny_color,
        )
        draw.text((deny_x + pill_w + 8, cy - 8), "Denied", font=font, fill=text_color)

    def run(self):
        frame_interval = 1 / self.fps
        while self.running:
            animation_active = self.render_frame(current_status, current_emoji, current_text, current_scroll_top, current_battery_level, current_battery_color)
            if animation_active:
                time.sleep(frame_interval)
                continue

            wait_timeout = None
            if self.pending_auto_scroll_after_hold:
                wait_timeout = max(0.0, current_scroll_sync_hold_until - time.time())
            self.render_event.wait(wait_timeout)
            self.render_event.clear()
            
    def stop(self):
        self.running = False
        self.render_event.set()

def update_display_data(status=None, emoji=None, text=None,
                  text_delta=None,
                  scroll_speed=None, scroll_sync=None, battery_level=None, battery_color=None, image_path=None,
                  network_connected=None, vpn_connected=None, rag_icon_visible=None, image_icon_visible=None, transaction_id=None,
                  wifi_signal_level=None,
                  music_progress=None, music_duration_ms=None, approval_mode=None, terminal_text=None):
    global current_status, current_emoji, current_text, current_battery_level
    global current_terminal_text
    global current_battery_color, current_scroll_top, current_scroll_speed, current_image_path
    global current_scroll_sync_char_end, current_scroll_sync_duration_ms
    global current_scroll_sync_target_top, current_scroll_sync_speed
    global current_scroll_sync_hold_until
    global current_network_connected, current_vpn_connected, current_rag_icon_visible, current_image_icon_visible, current_transaction_id
    global current_wifi_signal_level
    global current_music_progress, current_music_duration_ms
    global current_approval_mode
    global render_thread

    next_text = text
    if text is None and text_delta is not None:
        next_text = (current_text or "") + (text_delta or "")
    if text is not None:
        previous_text = current_text or ""
        incoming_text = text or ""
        same_transaction = (
            transaction_id is not None
            and current_transaction_id is not None
            and transaction_id == current_transaction_id
        )
        regressive_update = (
            len(incoming_text) > 0
            and len(incoming_text) < len(previous_text)
            and previous_text.startswith(incoming_text)
        )
        if same_transaction and regressive_update:
            next_text = previous_text
        elif (
            transaction_id is not None
            and current_transaction_id is not None
            and transaction_id != current_transaction_id
        ):
            current_scroll_top = 0
            current_scroll_sync_char_end = None
            current_scroll_sync_duration_ms = None
            current_scroll_sync_target_top = None
            current_scroll_sync_speed = None
            TextUtils.clean_line_image_cache()
        elif not incoming_text.startswith(previous_text):
            if not previous_text.startswith(incoming_text):
                current_scroll_top = 0
                current_scroll_sync_char_end = None
                current_scroll_sync_duration_ms = None
                current_scroll_sync_target_top = None
                current_scroll_sync_speed = None
                TextUtils.clean_line_image_cache()
    if scroll_sync is not None:
        try:
            char_end = scroll_sync.get("char_end", None)
            duration_ms = scroll_sync.get("duration_ms", None)
            if char_end is not None and duration_ms is not None:
                current_scroll_sync_char_end = int(char_end)
                current_scroll_sync_duration_ms = int(duration_ms)
                hold_seconds = max(0.3, (current_scroll_sync_duration_ms / 1000.0) + 0.2)
                current_scroll_sync_hold_until = max(
                    current_scroll_sync_hold_until,
                    time.time() + hold_seconds,
                )
        except Exception as e:
            print(f"[Display] Invalid scroll_sync payload: {e}")
    if scroll_speed is not None:
        try:
            requested_speed = float(scroll_speed)
            current_scroll_speed = min(MAX_SCROLL_SPEED, max(0.0, requested_speed))
        except (TypeError, ValueError):
            print(f"[Display] Invalid scroll_speed payload: {scroll_speed}")
    if network_connected is not None:
        current_network_connected = network_connected
    if wifi_signal_level is not None:
        try:
            current_wifi_signal_level = max(0, min(3, int(wifi_signal_level)))
        except (TypeError, ValueError):
            print(f"[Display] Invalid wifi_signal_level payload: {wifi_signal_level}")
    if vpn_connected is not None:
        current_vpn_connected = vpn_connected
    if rag_icon_visible is not None:
        current_rag_icon_visible = rag_icon_visible
    if image_icon_visible is not None:
        current_image_icon_visible = image_icon_visible
    if transaction_id is not None:
        current_transaction_id = transaction_id
    current_status = status if status is not None else current_status
    current_emoji = emoji if emoji is not None else current_emoji
    current_text = next_text if (text is not None or text_delta is not None) else current_text
    if terminal_text is not None:
        next_terminal_text = terminal_text or ""
        if next_terminal_text != current_terminal_text:
            current_scroll_top = 0
            TextUtils.clean_line_image_cache()
            if render_thread is not None:
                render_thread.current_render_text = ""
        current_terminal_text = next_terminal_text
    current_battery_level = battery_level if battery_level is not None else current_battery_level
    current_battery_color = battery_color if battery_color is not None else current_battery_color
    current_image_path = image_path if image_path is not None else current_image_path
    if music_progress is not None:
        current_music_progress = music_progress if music_progress >= 0 else None
    if music_duration_ms is not None:
        current_music_duration_ms = music_duration_ms if music_duration_ms > 0 else None
    if approval_mode is not None:
        current_approval_mode = bool(approval_mode)
    if render_thread is not None:
        render_thread.request_render()


def send_to_all_clients(message):
    """Send message to all connected clients"""
    message_json = json.dumps(message).encode("utf-8") + b"\n"
    for addr, client_socket in clients.items():
        try:
            client_socket.sendall(message_json)
            # Use ellipsis for long messages
            if len(message_json) > 100:
                display_message = message_json[:50] + b"..." + message_json[-50:]
            else:
                display_message = message_json
            print(f"[Server] Sent notification to client {addr}: {display_message}")
        except Exception as e:
            print(f"[Server] Failed to send notification to client {addr}: {e}")

def exit_camera_mode():
    global camera_mode, camera_thread, render_thread
    print("[Camera] Exiting camera mode...")
    if camera_thread is not None:
        camera_thread.stop()
        camera_thread = None
    notification = {"event": "exit_camera_mode"}
    send_to_all_clients(notification)
    camera_mode = False
    if render_thread is not None:
        render_thread.request_render()

def on_button_pressed():
    """Function executed when button is pressed"""
    print("[Server] Button pressed")
    notification = {"event": "button_pressed"}
    send_to_all_clients(notification)

def on_button_release():
    """Function executed when button is released"""
    print("[Server] Button released")
    notification = {"event": "button_released"}
    send_to_all_clients(notification)


def on_app_exit_requested():
    global shutdown_requested, render_thread, whisplay
    if shutdown_requested:
        return
    shutdown_requested = True
    print("[Server] App exit requested by daemon")
    notification = {"event": "app_exit_requested"}
    send_to_all_clients(notification)
    if render_thread is not None:
        render_thread.stop()
    if hasattr(whisplay, "prepare_exit"):
        try:
            whisplay.prepare_exit()
        except Exception as e:
            print(f"[Server] Failed to prepare exit: {e}")
    def _delayed_exit():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=_delayed_exit, daemon=True).start()

def handle_client(client_socket, addr, whisplay):
    global camera_capture_image_path, camera_mode, camera_thread, render_thread
    print(f"[Socket] Client {addr} connected")
    clients[addr] = client_socket
    try:
        buffer = ""
        while True:
            data = client_socket.recv(4096).decode("utf-8")
            if not data:
                break
            buffer += data
            
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                if not line.strip():
                    continue
                        
                # print(f"[Socket - {addr}] Received data: {line}")
                try:
                    content = json.loads(line)
                    transaction_id = content.get("transaction_id", None)
                    status = content.get("status", None)
                    emoji = content.get("emoji", None)
                    text = content.get("text", None)
                    text_delta = content.get("text_delta", None)
                    terminal_text = content.get("terminal_text", None)
                    rgbled = content.get("RGB", None)
                    brightness = content.get("brightness", None)
                    scroll_speed = content.get("scroll_speed", None)
                    scroll_sync = content.get("scroll_sync", None)
                    response_to_client = content.get("response", None)
                    battery_level = content.get("battery_level", None)
                    battery_color = content.get("battery_color", None)
                    image_path = content.get("image", None)
                    network_connected = content.get("network_connected", None)
                    wifi_signal_level = content.get("wifi_signal_level", None)
                    vpn_connected = content.get("vpn_connected", None)
                    rag_icon_visible = content.get("rag_icon_visible", None)
                    image_icon_visible = content.get("image_icon_visible", None)
                    music_progress = content.get("music_progress", None)
                    music_duration_ms = content.get("music_duration_ms", None)
                    approval_mode = content.get("approval_mode", None)
                    capture_image_path = content.get("capture_image_path", None)
                    trigger_camera_capture = content.get("camera_capture", None)
                    # boolean to enable camera mode
                    set_camera_mode = content.get("camera_mode", None)

                    if rgbled:
                        rgb255_tuple = ColorUtils.get_rgb255_from_any(rgbled)
                        whisplay.set_rgb_fade(*rgb255_tuple, duration_ms=500)
                    
                    if battery_color:
                        battery_tuple = ColorUtils.get_rgb255_from_any(battery_color)
                    else:
                        battery_tuple = None
                        
                    if brightness:
                        whisplay.set_backlight(brightness)
                        
                    if capture_image_path is not None:
                        camera_capture_image_path = capture_image_path
                    
                    if set_camera_mode is not None:
                        if set_camera_mode:
                            print("[Camera] Entering camera mode...")
                            camera_mode = True
                            camera_thread = CameraThread(whisplay, camera_capture_image_path)
                            camera_thread.start()
                        else:
                            print("[Camera] Exiting camera mode...")
                            if camera_thread is not None:
                                camera_thread.stop()
                                camera_thread = None
                            camera_mode = False
                        if render_thread is not None:
                            render_thread.request_render()

                    if trigger_camera_capture:
                        print("[Camera] Capturing image by command...")
                        if camera_thread is not None:
                            camera_thread.capture()
                            notification = {"event": "camera_capture"}
                            send_to_all_clients(notification)

                    if (text is not None) or (text_delta is not None) or (status is not None) or (emoji is not None) or \
                       (battery_level is not None) or (battery_color is not None) or \
                              (image_path is not None) or (network_connected is not None) or \
                            (wifi_signal_level is not None) or \
                            (vpn_connected is not None) or \
                            (rag_icon_visible is not None) or (image_icon_visible is not None) or (scroll_sync is not None) or \
                            (music_progress is not None) or (music_duration_ms is not None) or (approval_mode is not None) or \
                            (terminal_text is not None):
                        update_display_data(status=status, emoji=emoji,
                                     text=text, text_delta=text_delta, scroll_speed=scroll_speed, scroll_sync=scroll_sync,
                                     battery_level=battery_level, battery_color=battery_tuple,
                                                 image_path=image_path, network_connected=network_connected,
                                                 wifi_signal_level=wifi_signal_level,
                                     vpn_connected=vpn_connected,
                                                 rag_icon_visible=rag_icon_visible,
                                         image_icon_visible=image_icon_visible,
                                                 transaction_id=transaction_id,
                                                 music_progress=music_progress,
                                                 music_duration_ms=music_duration_ms,
                                                 approval_mode=approval_mode,
                                                 terminal_text=terminal_text)

                    client_socket.send(b"OK\n")
                    if response_to_client:
                        try:
                            response_bytes = json.dumps({"response": response_to_client}).encode("utf-8") + b"\n"
                            client_socket.send(response_bytes)
                            print(f"[Socket - {addr}] Sent response: {response_to_client}")
                        except Exception as e:
                            print(f"[Socket - {addr}] Response sending error: {e}")
                            
                except json.JSONDecodeError:
                    client_socket.send(b"ERROR: invalid JSON\n")
                except Exception as e:
                    print(f"[Socket - {addr}] Data processing error: {e}")
                    client_socket.send(f"ERROR: {e}\n".encode("utf-8"))

    except Exception as e:
        print(f"[Socket - {addr}] Connection error: {e}")
    finally:
        print(f"[Socket] Client {addr} disconnected")
        del clients[addr]
        client_socket.close()

def start_socket_server(render_thread, host='0.0.0.0', port=12345):
    # Register button events
    whisplay.on_button_press(on_button_pressed)
    whisplay.on_button_release(on_button_release)

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind((host, port))
    server_socket.listen(5)  # Allow more connections
    print(f"[Socket] Listening on {host}:{port} ...")

    try:
        while True:
            client_socket, addr = server_socket.accept()
            client_thread = threading.Thread(target=handle_client, 
                                           args=(client_socket, addr, whisplay))
            client_thread.daemon = True
            client_thread.start()
    except KeyboardInterrupt:
        print("[Socket] Server stopped")
    finally:
        render_thread.stop()
        server_socket.close()


if __name__ == "__main__":
    whisplay = create_whisplay_hardware()
    print(f"[LCD] Initialization finished: {whisplay.LCD_WIDTH}x{whisplay.LCD_HEIGHT}")
    if hasattr(whisplay, "on_exit_request"):
        whisplay.on_exit_request(on_app_exit_requested)
    
    # read CUSTOM_FONT_PATH from environment variable
    custom_font_path = os.getenv("CUSTOM_FONT_PATH", None)
    
    # start render thread
    render_thread = RenderThread(whisplay, custom_font_path or "NotoSansSC-Bold.ttf", fps=30)
    render_thread.start()
    start_socket_server(render_thread, host='0.0.0.0', port=12345)
    
    def cleanup_and_exit(signum, frame):
        print("[System] Exiting...")
        render_thread.stop()
        whisplay.cleanup()
        sys.exit(0)
        
    signal.signal(signal.SIGTERM, cleanup_and_exit)
    signal.signal(signal.SIGINT, cleanup_and_exit)
    signal.signal(signal.SIGKILL, cleanup_and_exit)
    signal.signal(signal.SIGQUIT, cleanup_and_exit)
    signal.signal(signal.SIGSTOP, cleanup_and_exit)
    try:
        # Keep the main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup_and_exit(None, None)
    
