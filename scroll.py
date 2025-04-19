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
from lcd import LCD  
import threading

scroll_thread = None
scroll_stop_event = threading.Event()


def image_to_rgb565(image: Image.Image, width: int, height: int) -> list:
    image = image.convert("RGB")
    image.thumbnail((width, height), Image.LANCZOS)
    bg = Image.new("RGB", (width, height), (0, 0, 0))
    x = (width - image.width) // 2
    y = (height - image.height) // 2
    bg.paste(image, (x, y))
    np_img = np.array(bg)
    r = (np_img[:, :, 0] >> 3).astype(np.uint16)
    g = (np_img[:, :, 1] >> 2).astype(np.uint16)
    b = (np_img[:, :, 2] >> 3).astype(np.uint16)
    rgb565 = (r << 11) | (g << 5) | b
    high_byte = (rgb565 >> 8).astype(np.uint8)
    low_byte = (rgb565 & 0xFF).astype(np.uint8)
    interleaved = np.dstack((high_byte, low_byte)).flatten().tolist()
    return interleaved

def emoji_to_filename(char):
    return '-'.join(f"{ord(c):x}" for c in char) + ".svg"

def get_local_emoji_svg_image(char, size):
    filename = emoji_to_filename(char)
    path = os.path.join("emoji_svg", filename)
    if not os.path.exists(path):
        print(f"[警告] 找不到 SVG 图标: {path}")
        return None
    try:
        png_bytes = cairosvg.svg2png(url=path, output_width=size, output_height=size)
        img = Image.open(BytesIO(png_bytes)).convert("RGBA")
        return img
    except Exception as e:
        print(f"[错误] 渲染 SVG 出错: {e}")
        return None

def is_emoji(char):
    return unicodedata.category(char) in ('So', 'Sk') or ord(char) > 0x1F000

def draw_mixed_text(draw, image, text, font, start_xy):
    x, y = start_xy
    ascent, descent = font.getmetrics()
    baseline = y + ascent
    for char in text:
        if is_emoji(char):
            emoji_img = get_local_emoji_svg_image(char, size=font.size)
            if emoji_img:
                emoji_y = baseline - emoji_img.height
                image.paste(emoji_img, (x, emoji_y), emoji_img)
                x += emoji_img.width
        else:
            draw.text((x, y), char, font=font, fill=(255, 255, 255))
            bbox = font.getbbox(char)
            char_width = bbox[2] - bbox[0]
            x += char_width

def wrap_text(draw, text, font, max_width):
    lines = []
    current_line = ""
    for char in text:
        test_line = current_line + char
        bbox = font.getbbox(test_line)
        w = bbox[2] - bbox[0]
        if w <= max_width:
            current_line = test_line
        else:
            lines.append(current_line)
            current_line = char
    if current_line:
        lines.append(current_line)
    return lines

def render_scroll_status_page(status_text, emoji_text, info_text, font_path, image_size,
                             status_font_size=32, emoji_font_size=40, info_font_size=28,
                             scroll_font_threshold=10):
    width, height = image_size
    image = Image.new("RGBA", image_size, (0, 0, 0, 255))
    draw = ImageDraw.Draw(image)
    status_font = ImageFont.truetype(font_path, status_font_size)
    emoji_font = ImageFont.truetype(font_path, emoji_font_size)
    info_font = ImageFont.truetype(font_path, info_font_size)

    # Draw status (centered)
    status_bbox = status_font.getbbox(status_text)
    status_w = status_bbox[2] - status_bbox[0]
    draw_mixed_text(draw, image, status_text, status_font, ((width - status_w) // 2, 0))

    # Draw emoji (centered)
    emoji_bbox = emoji_font.getbbox(emoji_text)
    emoji_w = emoji_bbox[2] - emoji_bbox[0]
    draw_mixed_text(draw, image, emoji_text, emoji_font, ((width - emoji_w) // 2, status_font_size + 8))

    # Define scroll area
    scroll_top = status_font_size + emoji_font_size + 20
    scroll_height = height - scroll_top

    # Create info scroll image
    dummy_draw = ImageDraw.Draw(Image.new("RGB", (width, 1000)))
    lines = wrap_text(dummy_draw, info_text, info_font, width)
    ascent, descent = info_font.getmetrics()
    line_height = ascent + descent # 这里 +4 是行距 padding
    total_height = len(lines) * line_height

    scroll_img = Image.new("RGBA", (width, total_height), (0, 0, 0, 255))
    scroll_draw = ImageDraw.Draw(scroll_img)
    for i, line in enumerate(lines):
        draw_mixed_text(scroll_draw, scroll_img, line, info_font, (0, i * line_height))

    if total_height > scroll_height or info_font_size < scroll_font_threshold:
        return image, scroll_img, True, scroll_top
    else:
        image.paste(scroll_img, (0, scroll_top))
        return image, None, False, scroll_top

def scroll_info_area(base_image: Image.Image, info_scroll_img: Image.Image, lcd,
                     scroll_top: int, scroll_speed=2, delay=0.05, stop_event=None):
    screen_width = lcd.WIDTH
    screen_height = lcd.HEIGHT
    scroll_height = screen_height - scroll_top
    scroll_img_height = info_scroll_img.height

    while not stop_event.is_set():
        for y_offset in range(0, max(0, scroll_img_height - scroll_height + 1), scroll_speed):
            if stop_event.is_set():
                return
            frame = base_image.copy()
            crop = info_scroll_img.crop((0, y_offset, screen_width, min(scroll_img_height, y_offset + scroll_height)))
            frame.paste(crop, (0, scroll_top))
            rgb565_data = image_to_rgb565(frame, screen_width, screen_height)
            lcd.draw_image(0, 0, screen_width, screen_height, rgb565_data)
            time.sleep(delay)

        time.sleep(1.0)

        for y_offset in range(max(0, scroll_img_height - scroll_height), -1, -scroll_speed):
            if stop_event.is_set():
                return
            frame = base_image.copy()
            crop = info_scroll_img.crop((0, y_offset, screen_width, min(scroll_img_height, y_offset + scroll_height)))
            frame.paste(crop, (0, scroll_top))
            rgb565_data = image_to_rgb565(frame, screen_width, screen_height)
            lcd.draw_image(0, 0, screen_width, screen_height, rgb565_data)
            time.sleep(delay)

        time.sleep(1.0)



def start_socket_server(host='0.0.0.0', port=12345, font_path="NotoSansSC-Bold.ttf"):
    lcd = LCD()
    print(f"[LCD] 初始化完成，大小: {lcd.WIDTH}x{lcd.HEIGHT}")

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind((host, port))
    server_socket.listen(1)
    print(f"[Socket] 正在监听 {host}:{port} ...")

    global scroll_thread, scroll_stop_event

    while True:
        client_socket, addr = server_socket.accept()
        print(f"[Socket] 接收到连接来自: {addr}")

        try:
            data = client_socket.recv(4096).decode("utf-8")
            print(f"[Socket] 接收到数据: {data}")
            try:
                content = json.loads(data)
                status = content.get("status", "状态：待机")
                emoji = content.get("emoji", "🤖")
                text = content.get("text", "你好，世界")
                scroll_speed = content.get("scroll_speed", 2)

                # 停止之前的滚动线程
                if scroll_thread and scroll_thread.is_alive():
                    scroll_stop_event.set()
                    scroll_thread.join()

                scroll_stop_event = threading.Event()

                img, scroll_img, need_scroll, scroll_top = render_scroll_status_page(
                    status_text=status, emoji_text=emoji,
                    info_text=text, font_path=font_path,
                    image_size=(lcd.WIDTH, lcd.HEIGHT)
                )

                if need_scroll:
                    scroll_thread = threading.Thread(
                        target=scroll_info_area,
                        args=(img, scroll_img, lcd, scroll_top),
                        kwargs={'scroll_speed': scroll_speed, 'delay': 0.05, 'stop_event': scroll_stop_event}
                    )
                    scroll_thread.start()
                else:
                    rgb565_data = image_to_rgb565(img, lcd.WIDTH, lcd.HEIGHT)
                    lcd.draw_image(0, 0, lcd.WIDTH, lcd.HEIGHT, rgb565_data)

                client_socket.send(b"OK\n")
            except json.JSONDecodeError:
                client_socket.send(b"ERROR: invalid JSON\n")
        except Exception as e:
            print(f"[Socket] 错误: {e}")
        finally:
            client_socket.close()


if __name__ == "__main__":
    start_socket_server()

#使用示例：
# python scroll.py --status "聆听中" --emoji "🤩🤩" --text "你好，世界！🤪欢迎使用语音助手。