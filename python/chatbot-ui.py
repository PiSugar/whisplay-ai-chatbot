from PIL import Image, ImageDraw, ImageFont
import os
import time
import socket
import json
import sys
import threading
import signal

# from whisplay import WhisplayBoard
from whisplay import WhisplayBoard
from camera import CameraThread
from utils import ColorUtils, ImageUtils, TextUtils

STATUS_ICON_DIR = os.path.join(os.path.dirname(__file__), "status-bar-icon")
if STATUS_ICON_DIR not in sys.path:
    sys.path.append(STATUS_ICON_DIR)

from battery_icon import BatteryStatusIcon
from network_icon import NetworkStatusIcon
from rag_icon import RagStatusIcon
from image_icon import ImageStatusIcon
from wireguard_icon import WireguardStatusIcon

scroll_thread = None
scroll_stop_event = threading.Event()

status_font_size=20
emoji_font_size=40
battery_font_size=13
IDLE_RENDER_INTERVAL = 0.5

# Global variables
current_status = "Hello"
current_emoji = "😄"
current_text = "Waiting for message..."
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
current_vpn_connected = False
current_rag_icon_visible = False
current_image_icon_visible = False
current_music_progress = None
current_music_duration_ms = None
camera_mode = False
camera_capture_image_path = ""
camera_thread = None
render_thread = None
clients = {}
status_icon_factories = []


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
        self.music_time_font = ImageFont.truetype(self.font_path, 10)
        self.main_text_line_height = self.main_text_font.getmetrics()[0] + self.main_text_font.getmetrics()[1]
        self.text_cache_image = None
        self.current_render_text = ""
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
            text_area_height = self.whisplay.LCD_HEIGHT - header_height - progress_bar_height
            text_bg_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, text_area_height), (0, 0, 0, 255))
            text_draw = ImageDraw.Draw(text_bg_image)
            animation_active = self.render_main_text(text_bg_image, text_area_height, text_draw, text, current_scroll_speed)
            self.whisplay.draw_image(0, header_height + progress_bar_height, self.whisplay.LCD_WIDTH, text_area_height, ImageUtils.image_to_rgb565(text_bg_image, self.whisplay.LCD_WIDTH, text_area_height))

            return animation_active

        

    def compute_scroll_target_from_char_end(self, lines, line_height, area_height, char_end):
        if char_end is None or char_end <= 0:
            return 0
        total_chars = 0
        target_line = 0
        for i, line in enumerate(lines):
            total_chars += len(line)
            if total_chars >= char_end:
                target_line = i
                break
            if i < len(lines) - 1:
                total_chars += 1
        target_top = target_line * line_height - (area_height // 2)
        return max(0, target_top)

    def render_main_text(self, main_text_image, area_height, draw, text, scroll_speed=2):
        global current_scroll_top, current_scroll_sync_char_end
        global current_scroll_sync_duration_ms, current_scroll_sync_target_top
        global current_scroll_sync_speed, current_scroll_sync_hold_until
        """Render main text content, wrap lines according to screen width, only display currently visible part"""
        if not text:
            self.pending_auto_scroll_after_hold = False
            return False
        # Use main text font
        font = self.main_text_font
        lines = TextUtils.wrap_text(draw, text, font, self.whisplay.LCD_WIDTH - 20)

        # Line height
        line_height = self.main_text_line_height

        max_scroll_top = max(0, (len(lines) + 1) * line_height - area_height)

        if current_scroll_sync_char_end is not None and current_scroll_sync_duration_ms is not None:
            target_top = self.compute_scroll_target_from_char_end(
                lines, line_height, area_height, current_scroll_sync_char_end
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
        fin_show_lines = False
        for i, line in enumerate(lines):
            if (i + 1) * line_height >= current_scroll_top and i * line_height - current_scroll_top <= area_height:
                display_lines.append(line)
                fin_show_lines = True
            elif fin_show_lines is False:
                render_y += line_height
        
        # render_text
        render_text = ""
        for line in display_lines:
            render_text += line
        if self.current_render_text != render_text:
            self.current_render_text = render_text
            show_text_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, render_y + len(display_lines) * line_height), (0, 0, 0, 255))
            show_text_draw = ImageDraw.Draw(show_text_image)
            for line in display_lines:
                TextUtils.draw_mixed_text(show_text_draw, show_text_image, line, font, (10, render_y))
                render_y += line_height
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
        if context.get("network_connected"):
            icons.append(NetworkStatusIcon(status_font_size))
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
                  scroll_speed=None, scroll_sync=None, battery_level=None, battery_color=None, image_path=None,
                  network_connected=None, vpn_connected=None, rag_icon_visible=None, image_icon_visible=None, transaction_id=None,
                  music_progress=None, music_duration_ms=None):
    global current_status, current_emoji, current_text, current_battery_level
    global current_battery_color, current_scroll_top, current_scroll_speed, current_image_path
    global current_scroll_sync_char_end, current_scroll_sync_duration_ms
    global current_scroll_sync_target_top, current_scroll_sync_speed
    global current_scroll_sync_hold_until
    global current_network_connected, current_vpn_connected, current_rag_icon_visible, current_image_icon_visible, current_transaction_id
    global current_music_progress, current_music_duration_ms
    global render_thread

    next_text = text
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
    current_text = next_text if text is not None else current_text
    current_battery_level = battery_level if battery_level is not None else current_battery_level
    current_battery_color = battery_color if battery_color is not None else current_battery_color
    current_image_path = image_path if image_path is not None else current_image_path
    if music_progress is not None:
        current_music_progress = music_progress if music_progress >= 0 else None
    if music_duration_ms is not None:
        current_music_duration_ms = music_duration_ms if music_duration_ms > 0 else None
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
                    rgbled = content.get("RGB", None)
                    brightness = content.get("brightness", None)
                    scroll_speed = content.get("scroll_speed", None)
                    scroll_sync = content.get("scroll_sync", None)
                    response_to_client = content.get("response", None)
                    battery_level = content.get("battery_level", None)
                    battery_color = content.get("battery_color", None)
                    image_path = content.get("image", None)
                    network_connected = content.get("network_connected", None)
                    vpn_connected = content.get("vpn_connected", None)
                    rag_icon_visible = content.get("rag_icon_visible", None)
                    image_icon_visible = content.get("image_icon_visible", None)
                    music_progress = content.get("music_progress", None)
                    music_duration_ms = content.get("music_duration_ms", None)
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

                    if (text is not None) or (status is not None) or (emoji is not None) or \
                       (battery_level is not None) or (battery_color is not None) or \
                              (image_path is not None) or (network_connected is not None) or \
                            (vpn_connected is not None) or \
                            (rag_icon_visible is not None) or (image_icon_visible is not None) or (scroll_sync is not None) or \
                            (music_progress is not None) or (music_duration_ms is not None):
                        update_display_data(status=status, emoji=emoji,
                                     text=text, scroll_speed=scroll_speed, scroll_sync=scroll_sync,
                                     battery_level=battery_level, battery_color=battery_tuple,
                                                 image_path=image_path, network_connected=network_connected,
                                     vpn_connected=vpn_connected,
                                                 rag_icon_visible=rag_icon_visible,
                                         image_icon_visible=image_icon_visible,
                                                 transaction_id=transaction_id,
                                                 music_progress=music_progress,
                                                 music_duration_ms=music_duration_ms)

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
    whisplay = WhisplayBoard()
    print(f"[LCD] Initialization finished: {whisplay.LCD_WIDTH}x{whisplay.LCD_HEIGHT}")
    
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
    
