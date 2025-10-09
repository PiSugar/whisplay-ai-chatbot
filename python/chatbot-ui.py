import unicodedata
import argparse
from PIL import Image, ImageDraw, ImageFont
import cairosvg
from io import BytesIO
import os
import numpy as np
import time
import socket
import json
import sys
import threading

# from whisplay import WhisplayBoard
from whisplay import WhisplayBoard
from utils import ColorUtils, ImageUtils, TextUtils

scroll_thread = None
scroll_stop_event = threading.Event()

status_font_size=28
emoji_font_size=40
battery_font_size=13

# Global variables
current_status = "Hello"
current_emoji = "😄"
current_text = "Waiting for message..."
current_battery_level = 100
current_battery_color = ColorUtils.get_rgb255_from_any("#55FF00")
current_scroll_top = 0
current_scroll_speed = 6
clients = {}

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
        self.main_text_font = ImageFont.truetype(self.font_path, 20)
        self.main_text_line_height = self.main_text_font.getmetrics()[0] + self.main_text_font.getmetrics()[1]
        self.text_cache_image = None
        self.current_render_text = ""

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
        global current_scroll_speed
        header_height = 88 + 10  # header + margin
        # create a black background image for header
        image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, header_height), (0, 0, 0, 255))
        draw = ImageDraw.Draw(image)
        
        clock_font_size = 24
        clock_font = ImageFont.truetype(self.font_path, clock_font_size)

        # current_time = time.strftime("%H:%M:%S")
        # draw.text((self.whisplay.LCD_WIDTH // 2, self.whisplay.LCD_HEIGHT // 2), current_time, font=clock_font, fill=(255, 255, 255, 255))
        
        # render header
        self.render_header(image, draw, status, emoji, battery_level, battery_color)
        self.whisplay.draw_image(0, 0, self.whisplay.LCD_WIDTH, header_height, ImageUtils.image_to_rgb565(image, self.whisplay.LCD_WIDTH, header_height))

        # render main text area
        text_area_height = self.whisplay.LCD_HEIGHT - header_height
        text_bg_image = Image.new("RGBA", (self.whisplay.LCD_WIDTH, text_area_height), (0, 0, 0, 255))
        text_draw = ImageDraw.Draw(text_bg_image)
        self.render_main_text(text_bg_image, text_area_height, text_draw, text, current_scroll_speed)
        self.whisplay.draw_image(0, header_height, self.whisplay.LCD_WIDTH, text_area_height, ImageUtils.image_to_rgb565(text_bg_image, self.whisplay.LCD_WIDTH, text_area_height))

        

    def render_main_text(self, main_text_image, area_height, draw, text, scroll_speed=2):
        global current_scroll_top
        """Render main text content, wrap lines according to screen width, only display currently visible part"""
        if not text:
            return
        # Use main text font
        font = ImageFont.truetype(self.font_path, 20)
        lines = TextUtils.wrap_text(draw, text, font, self.whisplay.LCD_WIDTH - 20)

        # Line height
        line_height = self.main_text_line_height

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
        main_text_image.paste(self.text_cache_image, (0, -current_scroll_top), self.text_cache_image)

        # Update scroll position
        if scroll_speed > 0 and current_scroll_top < (len(lines) + 1) * line_height - area_height:
            current_scroll_top += scroll_speed
                

    def render_header(self, image, draw, status, emoji, battery_level, battery_color):
        global current_status, current_emoji, current_battery_level, current_battery_color
        global status_font_size, emoji_font_size, battery_font_size
        
        status_font = ImageFont.truetype(self.font_path, status_font_size)
        emoji_font = ImageFont.truetype(self.font_path, emoji_font_size)
        battery_font = ImageFont.truetype(self.font_path, battery_font_size)

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
        if battery_level is not None:
            self.render_battery(draw, battery_font, battery_level, battery_color, image_width, status_font_size)
        
        return top_height

    def render_battery(self, draw, battery_font, battery_level, battery_color, image_width, status_font_size):
         # Battery icon parameters (smaller)
        battery_width = 26
        battery_height = 15
        battery_margin_right = 20
        battery_x = image_width - battery_width - battery_margin_right
        battery_y = (status_font_size) // 2
        corner_radius = 3
        fill_color = "black"
        if battery_color is not None:
            fill_color = battery_color # Light green
        # Outline with rounded corners
        outline_color = "white"
        line_width = 2

        # Draw rounded corners
        draw.arc((battery_x, battery_y, battery_x + 2 * corner_radius, battery_y + 2 * corner_radius), 180, 270, fill=outline_color, width=line_width)  # Top-left
        draw.arc((battery_x + battery_width - 2 * corner_radius, battery_y, battery_x + battery_width, battery_y + 2 * corner_radius), 270, 0, fill=outline_color, width=line_width)  # Top-right
        draw.arc((battery_x, battery_y + battery_height - 2 * corner_radius, battery_x + 2 * corner_radius, battery_y + battery_height), 90, 180, fill=outline_color, width=line_width)  # Bottom-left
        draw.arc((battery_x + battery_width - 2 * corner_radius, battery_y + battery_height - 2 * corner_radius, battery_x + battery_width, battery_y + battery_height), 0, 90, fill=outline_color, width=line_width)  # Bottom-right

        # Draw top and bottom lines
        draw.line([(battery_x + corner_radius, battery_y), (battery_x + battery_width - corner_radius, battery_y)], fill=outline_color, width=line_width)  # Top
        draw.line([(battery_x + corner_radius, battery_y + battery_height), (battery_x + battery_width - corner_radius, battery_y + battery_height)], fill=outline_color, width=line_width)  # Bottom

        # Draw left and right lines
        draw.line([(battery_x, battery_y + corner_radius), (battery_x, battery_y + battery_height - corner_radius)], fill=outline_color, width=line_width)  # Left
        draw.line([(battery_x + battery_width, battery_y + corner_radius), (battery_x + battery_width, battery_y + battery_height - corner_radius)], fill=outline_color, width=line_width)  # Right

        if fill_color !=(0,0,0):
            draw.rectangle([battery_x + line_width // 2, battery_y + line_width // 2, battery_x + battery_width - line_width // 2, battery_y + battery_height - line_width // 2], fill=fill_color)

        # Battery head
        head_width = 2
        head_height = 5
        head_x = battery_x + battery_width
        head_y = battery_y + (battery_height - head_height) // 2
        draw.rectangle([head_x, head_y, head_x + head_width, head_y + head_height], fill="white")

        # Battery level text (just number)
        battery_text = str(battery_level)
        text_bbox = battery_font.getbbox(battery_text)
        text_h = text_bbox[3] - text_bbox[1]
        text_y = battery_y + (battery_height - (battery_font.getmetrics()[0] + battery_font.getmetrics()[1])) // 2
        text_w = text_bbox[2] - text_bbox[0]
        text_x = battery_x + (battery_width - text_w) // 2
        
        luminance = ColorUtils.calculate_luminance(fill_color)
        brightness_threshold = 128 # You can adjust this threshold as needed
        if luminance > brightness_threshold:
            text_fill_color = "black"
        else:
            text_fill_color = "white"
        draw.text((text_x, text_y), battery_text, font=battery_font, fill=text_fill_color)

    def run(self):
        frame_interval = 1 / self.fps
        while self.running:
            self.render_frame(current_status, current_emoji, current_text, current_scroll_top, current_battery_level, current_battery_color)
            time.sleep(frame_interval)
            
    def stop(self):
        self.running = False

def update_display_data(status=None, emoji=None, text=None, 
                  scroll_speed=None, battery_level=None, battery_color=None):
    global current_status, current_emoji, current_text, current_battery_level
    global current_battery_color, current_scroll_top, current_scroll_speed

    # If text is not continuation of previous, reset scroll position
    if text is not None and not text.startswith(current_text):
        current_scroll_top = 0
        TextUtils.clean_line_image_cache()
    if scroll_speed is not None:
        current_scroll_speed = scroll_speed
    current_status = status if status is not None else current_status
    current_emoji = emoji if emoji is not None else current_emoji
    current_text = text if text is not None else current_text
    current_battery_level = battery_level if battery_level is not None else current_battery_level
    current_battery_color = battery_color if battery_color is not None else current_battery_color


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
                        
                print(f"[Socket - {addr}] Received data: {line}")
                try:
                    content = json.loads(line)
                    transaction_id = content.get("transaction_id", None)
                    status = content.get("status", None)
                    emoji = content.get("emoji", None)
                    text = content.get("text", None)
                    rgbled = content.get("RGB", None)
                    brightness = content.get("brightness", None)
                    scroll_speed = content.get("scroll_speed", 2)
                    response_to_client = content.get("response", None)
                    battery_level = content.get("battery_level", None)
                    battery_color = content.get("battery_color", None)

                    if rgbled:
                        rgb255_tuple = ColorUtils.get_rgb255_from_any(rgbled)
                        whisplay.set_rgb_fade(*rgb255_tuple, duration_ms=500)
                    
                    if battery_color:
                        battery_tuple = ColorUtils.get_rgb255_from_any(battery_color)
                    else:
                        battery_tuple = (0, 0, 0)
                        
                    if brightness:
                        whisplay.set_backlight(brightness)
                        
                    if (text is not None) or (status is not None) or (emoji is not None) or \
                       (battery_level is not None) or (battery_color is not None):
                        update_display_data(status=status, emoji=emoji, 
                                     text=text, scroll_speed=scroll_speed,
                                     battery_level=battery_level, battery_color=battery_tuple)

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
    # start render thread
    render_thread = RenderThread(whisplay, "NotoSansSC-Bold.ttf", fps=30)
    render_thread.start()
    start_socket_server(render_thread, host='0.0.0.0', port=12345)
