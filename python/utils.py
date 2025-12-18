import os
import unicodedata
from io import BytesIO
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import cairosvg

try:
  import cv2 as cv
except ImportError:
  cv = None

class ColorUtils:
  @staticmethod
  def rgb565_to_rgb255(color_565):
    """将 RGB565 颜色值转换为 (R, G, B) 元组，每个分量范围为 0-255。"""
    red_5bit = (color_565 >> 11) & 0x1F
    green_6bit = (color_565 >> 5) & 0x3F
    blue_5bit = color_565 & 0x1F
    red_8bit = (red_5bit * 255) // 31
    green_8bit = (green_6bit * 255) // 63
    blue_8bit = (blue_5bit * 255) // 31
    return (red_8bit, green_8bit, blue_8bit)

  @staticmethod
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

  @staticmethod
  def get_rgb255_from_any(rgb_led):
    """自动检测输入格式并转换为 RGB (0-255) 元组。"""
    if isinstance(rgb_led, int):
      if 0 <= rgb_led <= 0xFFFF:
        return ColorUtils.rgb565_to_rgb255(rgb_led)
      else:
        return None
    elif isinstance(rgb_led, str):
      hex_color = rgb_led.lstrip("#")
      if all(c in "0123456789abcdefABCDEF" for c in hex_color) and len(hex_color) in [6, 8]:
        return ColorUtils.hex_to_rgb255(rgb_led)
      else:
        return None
    else:
      return None
  
  @staticmethod
  def calculate_luminance(rgb_tuple):
    """计算 RGB 颜色的亮度。"""
    if rgb_tuple is None:
        return -1 # 或者其他表示无效的值
    r, g, b = rgb_tuple
    return 0.299 * r + 0.587 * g + 0.114 * b


class ImageUtils:
  @staticmethod
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
  
  @staticmethod
  def convertCameraFrameToRGB565(frame: np.ndarray, width: int, height: int):
    # Resize frame to fit the display
    if cv is not None:
      frame = cv.resize(frame, (width, height), interpolation=cv.INTER_NEAREST)
    else:
      pil_img = Image.fromarray(frame)
      pil_img = pil_img.resize((width, height), Image.NEAREST)
      frame = np.array(pil_img)
    # Convert to RGB565
    r = (frame[:, :, 0] >> 3).astype(np.uint16)  # 5 bit
    g = (frame[:, :, 1] >> 2).astype(np.uint16)  # 6 bit
    b = (frame[:, :, 2] >> 3).astype(np.uint16)  # 5 bit
    rgb565_data = (r << 11) | (g << 5) | b
    return rgb565_data.byteswap().tobytes()
  
  @staticmethod
  def crop_center(image: Image.Image, target_width: int, target_height: int) -> Image.Image:
    width, height = image.size
    left = (width - target_width) // 2
    top = (height - target_height) // 2
    right = (width + target_width) // 2
    bottom = (height + target_height) // 2
    return image.crop((left, top, right, bottom)).resize((target_width, target_height), Image.LANCZOS)


class EmojiUtils:
  @staticmethod
  def emoji_to_filename(char):
    return '-'.join(f"{ord(c):x}" for c in char) + ".svg"

  @staticmethod
  def get_local_emoji_svg_image(char, size):
    filename = EmojiUtils.emoji_to_filename(char)
    path = os.path.join("emoji_svg", filename)
    if not os.path.exists(path):
      # print(f"[警告] 找不到 SVG 图标: {path}")
      return None
    try:
      png_bytes = cairosvg.svg2png(url=path, output_width=size, output_height=size)
      img = Image.open(BytesIO(png_bytes)).convert("RGBA")
      return img
    except Exception as e:
      print(f"[错误] 渲染 SVG 出错: {e}")
      return None

  @staticmethod
  def is_emoji(char):
    return unicodedata.category(char) in ('So', 'Sk') or ord(char) > 0x1F000


char_size_cache = {}
line_image_cache = {}

class TextUtils:
  
  @staticmethod
  def get_char_size(font, char):
    global char_size_cache
    cache_key = (font.getname(), font.size, char)
    if cache_key in char_size_cache:
      return char_size_cache[cache_key]
    """获取字符的大小，返回宽度和高度。"""
    if EmojiUtils.is_emoji(char):
      emoji_img = EmojiUtils.get_local_emoji_svg_image(char, size=font.size)
      if emoji_img:
        char_size_cache[cache_key] = (emoji_img.width, emoji_img.height)
        return emoji_img.width, emoji_img.height
    else:
      bbox = font.getbbox(char)
      char_size_cache[cache_key] = (bbox[2] - bbox[0], bbox[3] - bbox[1])
      return char_size_cache[cache_key]
    return 0, 0
  
  @staticmethod
  def draw_mixed_text(draw, image, text, font, start_xy):
    x, y = start_xy
    add_img = TextUtils.get_line_img(text, font)
    image.paste(add_img, (x, y), add_img)
        
  @staticmethod
  def get_line_img(text, font):
    cache_key = (font.getname(), font.size, text)
    if cache_key in line_image_cache:
      return line_image_cache[cache_key]
    x, y = 0, 0
    ascent, descent = font.getmetrics()
    baseline = y + ascent
    line_height = ascent + descent
    width = 0
    for char in text:
      width += TextUtils.get_char_size(font, char)[0]
    img = Image.new("RGBA", (width, line_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for char in text:
      if EmojiUtils.is_emoji(char):
        emoji_img = EmojiUtils.get_local_emoji_svg_image(char, size=font.size)
        if emoji_img:
          emoji_y = baseline - emoji_img.height
          img.paste(emoji_img, (x, emoji_y), emoji_img)
          x += emoji_img.width
      else:
        draw.text((x, y), char, font=font, fill=(255, 255, 255))
        char_width = TextUtils.get_char_size(font, char)[0]
        x += char_width
    line_image_cache[cache_key] = img
    return line_image_cache[cache_key]
  
  @staticmethod
  def clean_line_image_cache():
    """清除行图像缓存。"""
    global line_image_cache
    line_image_cache = {}

  @staticmethod
  def get_text_size(text, font):
    """获取文本的宽度和高度。"""
    lines = TextUtils.wrap_text(None, text, font, float('inf'))
    width = max(TextUtils.get_line_img(line, font).width for line in lines)
    height = sum(TextUtils.get_line_img(line, font).height for line in lines)
    return width, height

  @staticmethod
  def wrap_text(draw, text, font, max_width):
    lines = []
    current_line = ""
    current_width = 0
    for char in text:
      test_line = current_line + char
      char_width = TextUtils.get_char_size(font, char)[0]
      current_width += char_width
      w = current_width
      if w <= max_width:
        current_line = test_line
      else:
        lines.append(current_line)
        current_line = char
        current_width = char_width
    if current_line:
      lines.append(current_line)
    return lines