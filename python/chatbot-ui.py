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
# import difflib

from whisplay import WhisplayBoard

scroll_thread = None
scroll_stop_event = threading.Event()

def rgb565_to_rgb255(color_565):
    """将 RGB565 颜色值转换为 (R, G, B) 元组，每个分量范围为 0-255。"""
    red_5bit = (color_565 >> 11) & 0x1F
    green_6bit = (color_565 >> 5) & 0x3F
    blue_5bit = color_565 & 0x1F
    red_8bit = (red_5bit * 255) // 31
    green_8bit = (green_6bit * 255) // 63
    blue_8bit = (blue_5bit * 255) // 31
    return (red_8bit, green_8bit, blue_8bit)

def hex_to_rgb255(hex_color):
    """将十六进制颜色代码转换为 (R, G, B) 元组，每个分量范围为 0-255。"""
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
        return (r, g, b)
    else:
        return None

def get_rgb255_from_any(rgbled):
    """自动检测输入格式并转换为 RGB (0-255) 元组。"""
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
        w = font.getlength(test_line)
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

class OptimizedScrollRenderer:
    """优化的滚动文本渲染器"""
    
    def __init__(self, font_path, scroll_width, scroll_height, min_font_size=20, max_font_size=20):
        self.font_path = font_path
        self.scroll_width = scroll_width
        self.scroll_height = scroll_height
        self.min_font_size = min_font_size
        self.max_font_size = max_font_size
        self.horizontal_padding = 10
        self.effective_scroll_width = scroll_width - 2 * self.horizontal_padding
        
        # 文本相关状态
        self.current_text = ""
        self.wrapped_lines = []
        self.line_height = 0
        self.font_size = min_font_size
        self.font = None
        self.total_content_height = 0
        self.is_scrollable = False
        
        # 渲染缓存
        self.line_cache = {}  # 缓存已渲染的行
        self.cache_max_size = 50  # 最大缓存行数
        
    def is_text_continuation(self, old_text, new_text, threshold=0.7):
        """判断新文本是否为旧文本的延续"""
        if not old_text or not new_text:
            return False
            
        # 如果新文本以旧文本开头，很可能是延续
        if new_text.startswith(old_text):
            return True

        return False
            
        # 使用相似度匹配
        # similarity = difflib.SequenceMatcher(None, old_text, new_text).ratio()
        
        # # 检查是否有足够的相似前缀
        # matcher = difflib.SequenceMatcher(None, old_text, new_text)
        # match = matcher.find_longest_match(0, len(old_text), 0, len(new_text))
        
        # # 如果最长匹配从开头开始且占比足够大
        # if match.a == 0 and match.b == 0 and match.size >= len(old_text) * 0.8:
        #     return True
            
        # return similarity > threshold
    
    def setup_font_and_layout(self, text):
        """设置字体和布局信息"""
        # 尝试找到合适的字体大小
        best_font_size = self.min_font_size
        total_content_height_best_font = float('inf')
        
        for font_size in range(self.max_font_size, self.min_font_size - 1, -2):
            try:
                test_font = ImageFont.truetype(self.font_path, font_size)
                dummy_draw = ImageDraw.Draw(Image.new("RGB", (self.scroll_width, 1000)))
                lines = wrap_text(dummy_draw, text, test_font, self.effective_scroll_width)
                ascent, descent = test_font.getmetrics()
                line_height = ascent + descent
                total_content_height = len(lines) * line_height + cornerHeight
                
                if total_content_height <= self.scroll_height:
                    best_font_size = font_size
                    total_content_height_best_font = total_content_height
                    break
            except Exception as e:
                continue
        
        # 设置字体和布局参数
        if total_content_height_best_font <= self.scroll_height:
            self.font_size = best_font_size
            self.is_scrollable = False
        else:
            self.font_size = self.min_font_size
            self.is_scrollable = True
            
        self.font = ImageFont.truetype(self.font_path, self.font_size)
        dummy_draw = ImageDraw.Draw(Image.new("RGB", (self.scroll_width, 1000)))
        self.wrapped_lines = wrap_text(dummy_draw, text, self.font, self.effective_scroll_width)
        ascent, descent = self.font.getmetrics()
        self.line_height = ascent + descent
        self.total_content_height = len(self.wrapped_lines) * self.line_height + cornerHeight
    
    def render_line(self, line_index):
        """渲染单行文本，使用缓存优化"""
        if line_index in self.line_cache:
            return self.line_cache[line_index]
            
        if line_index >= len(self.wrapped_lines):
            return None
            
        line_text = self.wrapped_lines[line_index]
        line_img = Image.new("RGBA", (self.scroll_width, self.line_height), (0, 0, 0, 255))
        draw = ImageDraw.Draw(line_img)
        draw_mixed_text(draw, line_img, line_text, self.font, (self.horizontal_padding, 0))
        
        # 缓存管理
        if len(self.line_cache) >= self.cache_max_size:
            # 删除最旧的缓存项
            oldest_key = next(iter(self.line_cache))
            del self.line_cache[oldest_key]
            
        self.line_cache[line_index] = line_img
        return line_img
    
    def render_visible_area(self, y_offset):
        """渲染可见区域"""
        if not self.is_scrollable:
            # 非滚动模式，直接居中显示
            scroll_img = Image.new("RGBA", (self.scroll_width, self.scroll_height), (0, 0, 0, 255))
            draw = ImageDraw.Draw(scroll_img)
            y_start = (self.scroll_height - self.total_content_height) // 2
            
            for i, line in enumerate(self.wrapped_lines):
                draw_mixed_text(draw, scroll_img, line, self.font, 
                              (self.horizontal_padding, y_start + i * self.line_height))
            return scroll_img
        
        # 滚动模式，按需渲染
        frame = Image.new("RGBA", (self.scroll_width, self.scroll_height), (0, 0, 0, 255))
        
        # 计算需要渲染的行范围
        start_line = max(0, y_offset // self.line_height)
        end_line = min(len(self.wrapped_lines), 
                      (y_offset + self.scroll_height) // self.line_height + 2)
        
        # 渲染可见行
        for line_idx in range(start_line, end_line):
            line_img = self.render_line(line_idx)
            if line_img:
                line_y = line_idx * self.line_height - y_offset
                if -self.line_height < line_y < self.scroll_height:
                    frame.paste(line_img, (0, line_y))
        
        return frame
    
    def update_text(self, new_text):
        """更新文本内容"""
        old_text = self.current_text
        self.current_text = new_text
        
        # 检查是否为延续文本
        is_continuation = self.is_text_continuation(old_text, new_text)
        
        if not is_continuation:
            # 不是延续，清空缓存
            self.line_cache.clear()
        
        self.setup_font_and_layout(new_text)
        return is_continuation

class ScrollManager:
    """滚动管理器"""
    
    def __init__(self, whisplay, renderer):
        self.whisplay = whisplay
        self.renderer = renderer
        self.scroll_thread = None
        self.scroll_stop_event = threading.Event()
        self.current_y_offset = 0
        self.scroll_lock = threading.Lock()
        
    def scroll_content(self, scroll_speed=2, delay=0.05):
        """滚动内容"""
        if not self.renderer.is_scrollable:
            # 非滚动内容，直接显示
            frame = self.renderer.render_visible_area(0)
            rgb565_data = image_to_rgb565(frame, self.whisplay.LCD_WIDTH, 
                                        frame.height)
            self.whisplay.draw_image(0, scroll_top, self.whisplay.LCD_WIDTH, 
                                   frame.height, rgb565_data)
            return
        
        max_scroll = max(0, self.renderer.total_content_height - self.renderer.scroll_height)
        
        while not self.scroll_stop_event.is_set():
            # 滚动循环
            for y_offset in range(0, max_scroll + 1, scroll_speed):
                if self.scroll_stop_event.is_set():
                    return
                    
                with self.scroll_lock:
                    self.current_y_offset = y_offset
                    frame = self.renderer.render_visible_area(y_offset)
                    
                rgb565_data = image_to_rgb565(frame, self.whisplay.LCD_WIDTH, 
                                            frame.height)
                self.whisplay.draw_image(0, scroll_top, self.whisplay.LCD_WIDTH, 
                                       frame.height, rgb565_data)
                time.sleep(delay)
            
            # 滚动到底部后暂停
            time.sleep(1)
    
    def update_text(self, new_text, scroll_speed=2):
        """更新滚动文本"""
        with self.scroll_lock:
            is_continuation = self.renderer.update_text(new_text)
            
            if is_continuation and self.scroll_thread and self.scroll_thread.is_alive():
                # 是延续文本且正在滚动，不重置滚动位置
                print("[Scroll] 检测到延续文本，继续当前滚动")
                return
            
            # 停止当前滚动
            if self.scroll_thread and self.scroll_thread.is_alive():
                self.scroll_stop_event.set()
                self.scroll_thread.join(timeout=1.0)
            
            # 重置滚动状态
            self.scroll_stop_event = threading.Event()
            self.current_y_offset = 0
            
            # 启动新的滚动线程
            self.scroll_thread = threading.Thread(
                target=self.scroll_content,
                kwargs={'scroll_speed': scroll_speed, 'delay': 0.05}
            )
            self.scroll_thread.daemon = True
            self.scroll_thread.start()

# 全局变量
current_status = ""
current_emoji = ""
current_text = ""
current_battery_level = None
current_battery_color = None
scroll_manager = None
top_image = None
clients = {}

def update_display(whisplay, font_path, status=None, emoji=None, text=None, 
                  scroll_speed=2, battery_level=None, battery_color=None):
    global current_status, current_emoji, current_text, current_battery_level
    global current_battery_color, scroll_manager, top_image, scroll_top

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
        top_image, scroll_top = render_top_area(current_status, current_emoji, 
                                               font_path, whisplay.LCD_WIDTH,
                                               battery_level=current_battery_level,
                                               battery_color=current_battery_color)
        rgb565_data = image_to_rgb565(top_image, whisplay.LCD_WIDTH, scroll_top)
        whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, scroll_top, rgb565_data)
        
        # 重新初始化滚动管理器（因为scroll_top可能改变）
        if scroll_manager:
            renderer = OptimizedScrollRenderer(font_path, whisplay.LCD_WIDTH,
                                             whisplay.LCD_HEIGHT - scroll_top)
            renderer.update_text(current_text)
            scroll_manager = ScrollManager(whisplay, renderer)

    if text is not None and text != current_text:
        current_text = text
        
        # 初始化滚动管理器（如果还没有）
        if scroll_manager is None:
            renderer = OptimizedScrollRenderer(font_path, whisplay.LCD_WIDTH,
                                             whisplay.LCD_HEIGHT - scroll_top)
            scroll_manager = ScrollManager(whisplay, renderer)
        
        # 更新文本
        scroll_manager.update_text(current_text, scroll_speed)

def send_to_all_clients(message):
    """向所有连接的客户端发送消息"""
    message_json = json.dumps(message).encode("utf-8") + b"\n"
    for addr, client_socket in clients.items():
        try:
            client_socket.sendall(message_json)
            # message 太长中间使用省略号
            if len(message_json) > 100:
                display_message = message_json[:50] + b"..." + message_json[-50:]
            else:
                display_message = message_json
            print(f"[Server] 向客户端 {addr} 发送通知: {display_message}")
        except Exception as e:
            print(f"[Server] 向客户端 {addr} 发送通知失败: {e}")

def on_button_pressed():
    """按钮按下时执行的函数"""
    print("[Server] 按钮被按下")
    notification = {"event": "button_pressed"}
    send_to_all_clients(notification)

def on_button_release():
    """按钮释放时执行的函数"""
    print("[Server] 按钮被释放")
    notification = {"event": "button_released"}
    send_to_all_clients(notification)

def handle_client(client_socket, addr, whisplay, font_path):
    print(f"[Socket] 客户端 {addr} 已连接")
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
                    battery_level = content.get("battery_level", None)
                    battery_color = content.get("battery_color", None)

                    if rgbled:
                        rgb255_tuple = get_rgb255_from_any(rgbled)
                        whisplay.set_rgb_fade(*rgb255_tuple, duration_ms=500)
                    
                    if battery_color:
                        battery_tuple = get_rgb255_from_any(battery_color)
                    else:
                        battery_tuple = (0, 0, 0)
                        
                    if brightness:
                        whisplay.set_backlight(brightness)
                        
                    if (text is not None) or (status is not None) or (emoji is not None) or \
                       (battery_level is not None) or (battery_color is not None):
                        update_display(whisplay, font_path, status=status, emoji=emoji, 
                                     text=text, scroll_speed=scroll_speed,
                                     battery_level=battery_level, battery_color=battery_tuple)

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
    whisplay = WhisplayBoard()
    global cornerHeight
    cornerHeight = whisplay.CornerHeight
    print(f"[LCD] 初始化完成，大小: {whisplay.LCD_WIDTH}x{whisplay.LCD_HEIGHT}")

    # 启动时先显示logo
    logo_path = os.path.join("img", "logo.png")
    if os.path.exists(logo_path):
        logo_image = Image.open(logo_path).convert("RGBA")
        logo_image = logo_image.resize((whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT), Image.LANCZOS)
        rgb565_data = image_to_rgb565(logo_image, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)
        whisplay.set_backlight(100)
        whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, rgb565_data)

    # 注册按钮事件
    whisplay.on_button_press(on_button_pressed)
    whisplay.on_button_release(on_button_release)

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind((host, port))
    server_socket.listen(5)  # 允许更多连接
    print(f"[Socket] 正在监听 {host}:{port} ...")

    try:
        while True:
            client_socket, addr = server_socket.accept()
            client_thread = threading.Thread(target=handle_client, 
                                           args=(client_socket, addr, whisplay, font_path))
            client_thread.daemon = True
            client_thread.start()
    except KeyboardInterrupt:
        print("[Socket] 服务器停止")
        # 停止所有滚动线程
        if scroll_manager and scroll_manager.scroll_thread:
            scroll_manager.scroll_stop_event.set()
            scroll_manager.scroll_thread.join(timeout=1.0)
    finally:
        server_socket.close()


if __name__ == "__main__":
    start_socket_server()