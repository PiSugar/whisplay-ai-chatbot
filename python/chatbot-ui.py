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
from echoview import EchoViewBoard
import threading

scroll_thread = None
scroll_stop_event = threading.Event()
def rgb565_to_rgb255(color_565):
    """将 RGB565 颜色值转换为 (R, G, B) 元组，每个分量范围为 0-255。

    Args:
        color_565: 一个整数，表示 16 位的 RGB565 颜色值。

    Returns:
        一个包含三个整数的元组 (R, G, B)，分别代表红色、绿色和蓝色分量，范围为 0-255。
    """
    red_5bit = (color_565 >> 11) & 0x1F
    green_6bit = (color_565 >> 5) & 0x3F
    blue_5bit = color_565 & 0x1F
    red_8bit = (red_5bit * 255) // 31
    green_8bit = (green_6bit * 255) // 63
    blue_8bit = (blue_5bit * 255) // 31
    return (red_8bit, green_8bit, blue_8bit)

def hex_to_rgb255(hex_color):
    """将十六进制颜色代码转换为 (R, G, B) 元组，每个分量范围为 0-255。

    Args:
        hex_color: 一个字符串，表示 6 位或 8 位的十六进制颜色代码 (例如 "#FF0000" 或 "#FF0000FF")。

    Returns:
        一个包含三个整数的元组 (R, G, B)，分别代表红色、绿色和蓝色分量，范围为 0-255。
        如果输入的十六进制颜色代码格式不正确，则返回 None。
    """
    hex_color = hex_color.lstrip("#")
    if not all(c in "0123456789abcdefABCDEF" for c in hex_color):
        return None
    if len(hex_color) == 6:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        return (r, g, b)
    elif len(hex_color) == 8:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        # Alpha 通道在这里被忽略，但你可以根据需要使用它
        return (r, g, b)
    else:
        return None

def get_rgb255_from_any(rgbled):
    """自动检测输入格式并转换为 RGB (0-255) 元组。

    Args:
        rgbled: 可以是 RGB565 格式的整数或十六进制颜色字符串。

    Returns:
        一个包含三个整数的元组 (R, G, B)，范围为 0-255。
        如果无法识别或转换格式，则返回 None。
    """
    if isinstance(rgbled, int):
        if 0 <= rgbled <= 0xFFFF:
            return rgb565_to_rgb255(rgbled)
        else:
            return None
    elif isinstance(rgbled, str):
        hex_color = rgbled.lstrip("#")
        if all(c in "0123456789abcdefABCDEF" for c in hex_color) and len(hex_color) in [6, 8]:
            return hex_to_rgb255(rgbled)
        else:
            return None
    else:
        return None

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

def render_top_area(status_text, emoji_text, font_path, image_width,
                    status_font_size=28, emoji_font_size=40, battery_level=None,battery_color=None):
    status_font = ImageFont.truetype(font_path, status_font_size)
    emoji_font = ImageFont.truetype(font_path, emoji_font_size)
    battery_font = ImageFont.truetype(font_path, 13)

    ascent_status, _ = status_font.getmetrics()
    ascent_emoji, _ = emoji_font.getmetrics()

    top_height = status_font_size + emoji_font_size + 20
    image = Image.new("RGBA", (image_width, top_height), (0, 0, 0, 255))
    draw = ImageDraw.Draw(image)

    # Draw status centered
    status_bbox = status_font.getbbox(status_text)
    status_w = status_bbox[2] - status_bbox[0]
    draw_mixed_text(draw, image, status_text, status_font, (cornerHeight, 0))

    # Draw emoji centered
    emoji_bbox = emoji_font.getbbox(emoji_text)
    emoji_w = emoji_bbox[2] - emoji_bbox[0]
    draw_mixed_text(draw, image, emoji_text, emoji_font, ((image_width - emoji_w) // 2, status_font_size + 8))

    # Draw battery if provided
    if battery_level is not None:
         # Battery icon parameters (smaller)
        battery_width = 26
        battery_height = 15
        battery_margin_right = 20
        battery_x = image_width - battery_width - battery_margin_right
        battery_y =( status_font_size)//2
        corner_radius = 3
        fill_color="black"
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
        def calculate_luminance(rgb_tuple):
            """计算 RGB 颜色的亮度。"""
            if rgb_tuple is None:
                return -1 # 或者其他表示无效的值
            r, g, b = rgb_tuple
            return 0.299 * r + 0.587 * g + 0.114 * b

        luminance = calculate_luminance(fill_color)
        brightness_threshold = 128 # 你可以根据需要调整这个阈值
        if luminance > brightness_threshold:
            text_fill_color = "black"
        else:
            text_fill_color = "white"

        draw.text((text_x, text_y), battery_text, font=battery_font, fill=text_fill_color)

    return image, top_height

def render_scroll_info_area_dynamic_font(info_text, font_path, scroll_width, scroll_height, min_font_size=20, max_font_size=20):
    """
    根据内容高度和屏幕高度动态调整字体大小，如果能完整显示则使用最大字体，否则使用指定字体大小滚动显示。

    Args:
        info_text (str): 要显示的文本内容。
        font_path (str): 字体文件路径。
        scroll_width (int): 滚动区域的宽度。
        scroll_height (int): 滚动区域的高度。
        min_font_size (int): 最小允许的字体大小。
        max_font_size (int): 最大允许的字体大小。

    Returns:
        Image.Image: 包含渲染文本的图像。
    """
    best_font_size = min_font_size
    total_content_height_best_font = float('inf')
    horizontal_padding=3 #左右间距
    effective_scroll_width = scroll_width - 2 * horizontal_padding
    # 尝试从最大字体到最小字体，找到能在屏幕内完整显示的最大字体
    for font_size in range(max_font_size, min_font_size - 1, -2):  # 逆序尝试，步长为2以提高效率
        try:
            info_font = ImageFont.truetype(font_path, font_size)
            dummy_draw = ImageDraw.Draw(Image.new("RGB", (scroll_width, 1000)))
            lines = wrap_text(dummy_draw, info_text, info_font, effective_scroll_width)
            ascent, descent = info_font.getmetrics()
            line_height = ascent + descent
            total_content_height = len(lines) * line_height+cornerHeight

            if total_content_height <= scroll_height:
                best_font_size = font_size
                total_content_height_best_font = total_content_height
                break  # 找到合适的字体大小，停止尝试
        except IOError:
            print(f"Error: Font file not found at {font_path}")
            return Image.new("RGBA", (scroll_width, scroll_height), (0, 0, 0, 255))
        except Exception as e:
            print(f"Error creating font with size {font_size}: {e}")
            continue

    # 如果找到能在屏幕内完整显示的字体
    if total_content_height_best_font <= scroll_height:
        info_font = ImageFont.truetype(font_path, best_font_size)
        dummy_draw = ImageDraw.Draw(Image.new("RGB", (scroll_width, 1000)))
        lines = wrap_text(dummy_draw, info_text, info_font, effective_scroll_width)
        ascent, descent = info_font.getmetrics()
        line_height = ascent + descent
        output_height = scroll_height  # 高度为屏幕高度
        scroll_img = Image.new("RGBA", (scroll_width, output_height), (0, 0, 0, 255))
        draw = ImageDraw.Draw(scroll_img)
        y_offset = (scroll_height - total_content_height_best_font) // 2 # 垂直居中显示
        for i, line in enumerate(lines):
            draw_mixed_text(draw, scroll_img, line, info_font, (horizontal_padding, y_offset + i * line_height))
        return scroll_img
    else:
        # 否则，使用原始的滚动绘制逻辑
        info_font = ImageFont.truetype(font_path, min_font_size) # 使用最小字体或您指定的默认滚动字体大小
        dummy_draw = ImageDraw.Draw(Image.new("RGB", (scroll_width, 1000)))
        lines = wrap_text(dummy_draw, info_text, info_font, scroll_width)
        ascent, descent = info_font.getmetrics()
        line_height = ascent + descent
        total_content_height = len(lines) * line_height+cornerHeight
        output_height = max(scroll_height, total_content_height)
        scroll_img = Image.new("RGBA", (scroll_width, output_height), (0, 0, 0, 255))
        draw = ImageDraw.Draw(scroll_img)
        for i, line in enumerate(lines):
            draw_mixed_text(draw, scroll_img, line, info_font, (horizontal_padding, i * line_height))
        return scroll_img

def scroll_info_area(top_image: Image.Image, info_scroll_img: Image.Image, echoview,
                     scroll_speed=2, delay=0.05, stop_event=None):
    screen_width = echoview.LCD_WIDTH
    screen_height = echoview.LCD_HEIGHT
    scroll_height = screen_height - scroll_top
    scroll_img_height = info_scroll_img.height

    while not stop_event.is_set():
        for y_offset in range(0, max(0, scroll_img_height - scroll_height + 1), scroll_speed):
            if stop_event.is_set():
                return
            frame = Image.new("RGBA", (screen_width, scroll_height), (0, 0, 0, 255))
            frame = info_scroll_img.crop((0, y_offset, screen_width, min(scroll_img_height, y_offset + scroll_height)))
            # frame.paste(crop, (0, scroll_top))
            rgb565_data = image_to_rgb565(frame, screen_width,  scroll_height)
            echoview.draw_image(0, scroll_top, screen_width, scroll_height, rgb565_data)
            time.sleep(delay)

        while not stop_event.is_set():
            time.sleep(delay)
        return


# 全局变量分别保存当前状态、emoji、滚动文本以及滚动线程和控制事件
current_status = ""
current_emoji = ""
current_text = ""
current_battery_level = None
current_battery_color = None
scroll_thread = None
scroll_stop_event = threading.Event()
top_image = None
clients = {} # 用于存储客户端连接
def update_display(echoview, font_path, status=None, emoji=None, text=None, scroll_speed=2,battery_level=None,battery_color=None):
    global current_status, current_emoji, current_text,current_battery_level,current_battery_color
    global scroll_thread, scroll_stop_event, top_image,scroll_top

    top_changed = False

    if status is not None and status != current_status:
        current_status = status
        top_changed = True
    if emoji is not None and emoji != current_emoji:
        current_emoji = emoji
        top_changed = True
    if battery_level is not None and battery_level != current_battery_level:
        current_battery_level = battery_level
        top_changed = True
    if battery_color is not None and battery_color != current_battery_color:
        current_battery_color = battery_color
        top_changed = True
    if top_changed:
        print("重绘顶部")
        top_image ,scroll_top= render_top_area(current_status, current_emoji, font_path, echoview.LCD_WIDTH,battery_level=current_battery_level,battery_color=current_battery_color)
        rgb565_data=image_to_rgb565(top_image,echoview.LCD_WIDTH,scroll_top)
        echoview.draw_image(0, 0, echoview.LCD_WIDTH, scroll_top, rgb565_data)

    if text is not None and text != current_text:
        current_text = text

        # 停止原有滚动线程
        if scroll_thread and scroll_thread.is_alive():
            scroll_stop_event.set()
            scroll_thread.join()
        scroll_stop_event = threading.Event()

        scroll_img  = render_scroll_info_area_dynamic_font(
                info_text=current_text,
                font_path=font_path,
                scroll_width=echoview.LCD_WIDTH,
                scroll_height=echoview.LCD_HEIGHT - scroll_top
        )


        scroll_thread = threading.Thread(
            target=scroll_info_area,
            args=(top_image, scroll_img, echoview),
            kwargs={'scroll_speed': scroll_speed, 'delay': 0.05, 'stop_event': scroll_stop_event}
        )
        scroll_thread.start()
       

    elif top_changed and scroll_thread is None:
        # 没有滚动线程，也没新文本，只需要更新 top 部分
        frame = Image.new("RGBA", (echoview.LCD_WIDTH, echoview.LCD_HEIGHT), (0, 0, 0, 255))
        frame.paste(top_image, (0, 0))
        rgb565_data = image_to_rgb565(frame, echoview.LCD_WIDTH, echoview.LCD_HEIGHT)
        echoview.draw_image(0, 0, echoview.LCD_WIDTH, echoview.LCD_HEIGHT, rgb565_data)


def send_to_all_clients(message):
    """向所有连接的客户端发送消息"""
    message_json = json.dumps(message).encode("utf-8") + b"\n"
    for addr, client_socket in clients.items():
        try:
            client_socket.sendall(message_json)
            print(f"[Server] 向客户端 {addr} 发送通知: {message}")
        except Exception as e:
            print(f"[Server] 向客户端 {addr} 发送通知失败: {e}")
            # 可以选择在这里处理断开的客户端

def on_button_pressed():
    """按钮按下时执行的函数"""
    print("[Server] 按钮被按下")
    notification = {"event": "button_pressed"}
    send_to_all_clients(notification)

def handle_client(client_socket, addr, echoview, font_path):
    print(f"[Socket] 客户端 {addr} 已连接")
    clients[addr] = client_socket
    try:
        buffer = ""
        while True:
            data = client_socket.recv(4096).decode("utf-8")
            if not data:
                break
            buffer += data
            # print(f"[Socket - {addr}] 当前缓存 buffer: {repr(buffer)}")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                if not line.strip():
                    continue
                        
                print(f"[Socket - {addr}] 接收到数据: {line}")
                try:
                    content = json.loads(line)
                    status = content.get("status", None)
                    emoji = content.get("emoji", None)
                    text = content.get("text", None)
                    rgbled = content.get("RGB", None)
                    brightness = content.get("brightness", None)
                    scroll_speed = content.get("scroll_speed", 2)
                    response_to_client = content.get("response", None)
                    battery_level = content.get("battery_level", None)  # Get battery level
                    battery_color = content.get("battery_color", None)  # Get battery status

                    if rgbled:
                        rgb255_tuple = get_rgb255_from_any(rgbled)
                        echoview.set_rgb_fade(*rgb255_tuple,duration_ms=500)
                    if battery_color:
                        battery_tuple = get_rgb255_from_any(battery_color)
                    else:
                        battery_tuple=(0,0,0)
                    if brightness:
                        echoview.set_backlight(brightness)
                    if (text is not None) or (status is not None) or (emoji is not None)or (battery_level is not None)or (battery_color is not None):
                        update_display(echoview, font_path, status=status, emoji=emoji, text=text, scroll_speed=scroll_speed,battery_level=battery_level,battery_color=battery_tuple)

                    client_socket.send(b"OK\n")
                    if response_to_client:
                        try:
                            response_bytes = json.dumps({"response": response_to_client}).encode("utf-8") + b"\n"
                            client_socket.send(response_bytes)
                            print(f"[Socket - {addr}] 发送响应: {response_to_client}")
                        except Exception as e:
                            print(f"[Socket - {addr}] 发送响应错误: {e}")
                except json.JSONDecodeError:
                    client_socket.send(b"ERROR: invalid JSON\n")
                except Exception as e:
                    print(f"[Socket - {addr}] 处理数据错误: {e}")
                    client_socket.send(f"ERROR: {e}\n".encode("utf-8"))

    except Exception as e:
        print(f"[Socket - {addr}] 连接错误: {e}")
    finally:
        print(f"[Socket] 客户端 {addr} 断开连接")
        del clients[addr]
        client_socket.close()

def start_socket_server(host='0.0.0.0', port=12345, font_path="NotoSansSC-Bold.ttf"):
    echoview = EchoViewBoard()
    global cornerHeight
    cornerHeight=echoview.CornerHeight
    print(f"[LCD] 初始化完成，大小: {echoview.LCD_WIDTH}x{echoview.LCD_HEIGHT}")

    # 注册按钮按下事件

    echoview.on_button_press(on_button_pressed) # 使用模拟的注册

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1) # 添加这一行
    server_socket.bind((host, port))
    server_socket.listen(1) # 允许更多连接
    print(f"[Socket] 正在监听 {host}:{port} ...")

    try:
        while True:
            client_socket, addr = server_socket.accept()
            client_thread = threading.Thread(target=handle_client, args=(client_socket, addr, echoview, font_path))
            client_thread.daemon = True # 设置为守护线程，主线程退出时子线程也会退出
            client_thread.start()
    except KeyboardInterrupt:
        print("[Socket] 服务器停止")
    finally:
        server_socket.close()
        # 可以选择在这里等待所有客户端线程结束，如果需要更优雅的关闭


if __name__ == "__main__":
    start_socket_server()