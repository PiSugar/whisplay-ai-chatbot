import unicodedata
from PIL import Image, ImageDraw, ImageFont
import cairosvg
from io import BytesIO
import os
import numpy as np

def image_to_rgb565(image: Image.Image, width: int, height: int) -> list:
    """
    将 PIL.Image 图像转换为 LCD 显示用的 RGB565 格式数据
    包括缩放、居中填充和 RGB565 转换
    """
    # 确保为 RGB 模式
    image = image.convert("RGB")

    # 缩放图像并保持比例，长边等于 LCD 尺寸的一边
    image.thumbnail((width, height), Image.LANCZOS)

    # 创建黑底图像，居中放置缩放后的图像
    bg = Image.new("RGB", (width, height), (0, 0, 0))
    x = (width - image.width) // 2
    y = (height - image.height) // 2
    bg.paste(image, (x, y))

    # 转换为 numpy 数组
    np_img = np.array(bg)

    # 分量提取并转换为 RGB565
    r = (np_img[:, :, 0] >> 3).astype(np.uint16)
    g = (np_img[:, :, 1] >> 2).astype(np.uint16)
    b = (np_img[:, :, 2] >> 3).astype(np.uint16)

    rgb565 = (r << 11) | (g << 5) | b

    # 拆分高低字节（按大端或小端方式）
    high_byte = (rgb565 >> 8).astype(np.uint8)
    low_byte = (rgb565 & 0xFF).astype(np.uint8)

    # 交错拼接（高低字节顺序依 LCD 要求调整）
    interleaved = np.dstack((high_byte, low_byte)).flatten().tolist()

    return interleaved

def emoji_to_filename(char):
    return '-'.join(f"{ord(c):x}" for c in char) + ".svg"

def get_local_emoji_svg_image(char, size):
    """从本地 SVG 渲染 Emoji 图像"""
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
    """判断是否为 Emoji"""
    return unicodedata.category(char) in ('So', 'Sk') or ord(char) > 0x1F000

def render_mixed_text(text, font_path, font_size, image_size, start_xy=(0, 0)):
    """
    将混合文字 + SVG Emoji 渲染为 PIL.Image
    emoji 将与文字底部对齐（基线对齐）
    """
    image = Image.new("RGBA", image_size, (0, 0, 0, 255))  # 黑底
    draw = ImageDraw.Draw(image)

    font = ImageFont.truetype(font_path, font_size)
    x, y = start_xy

    ascent, descent = font.getmetrics()
    baseline = y + ascent  # 字体基线的 y 坐标

    for char in text:
        if is_emoji(char):
            emoji_img = get_local_emoji_svg_image(char, size=font_size)
            if emoji_img:
                emoji_y = baseline - emoji_img.height  # 让 emoji 底部对齐文字基线
                image.paste(emoji_img, (x, emoji_y), emoji_img)
                x += emoji_img.width
        else:
            draw.text((x, y), char, font=font, fill=(255, 255, 255))
            char_width, _ = draw.textsize(char, font=font)
            x += char_width

    return image
def render_multi_text(entries, font_path, image_size):
    """
    支持多个 (x, y, text, font_size) 输入，逐段绘制文字（可含 emoji）
    每段可以有不同字号
    """
    image = Image.new("RGBA", image_size, (0, 0, 0, 255))  # 黑底
    draw = ImageDraw.Draw(image)

    for x0, y0, text, font_size in entries:
        font = ImageFont.truetype(font_path, font_size)
        ascent, descent = font.getmetrics()

        x = x0
        baseline = y0 + ascent
        for char in text:
            if is_emoji(char):
                emoji_img = get_local_emoji_svg_image(char, size=font_size)
                if emoji_img:
                    emoji_y = baseline - emoji_img.height
                    image.paste(emoji_img, (x, emoji_y), emoji_img)
                    x += emoji_img.width
            else:
                draw.text((x, y0), char, font=font, fill=(255, 255, 255))
                char_width, _ = draw.textsize(char, font=font)
                x += char_width

    return image


def render_status_page(status_text, emoji_text, info_text, font_path, image_size):
    """
    渲染状态页面，包括状态、emoji 和信息三段内容
    :param status_text: 状态文字（居中，32号字体）
    :param emoji_text: Emoji 表情（居中，40号字体）
    :param info_text: 信息段文字（自动换行、自动缩放）
    :param font_path: 字体路径
    :param image_size: 图像尺寸 (width, height)
    :return: PIL.Image 对象
    """
    width, height = image_size
    image = Image.new("RGBA", image_size, (0, 0, 0, 255))
    draw = ImageDraw.Draw(image)

    # --- 渲染状态 ---
    status_font_size = 32
    status_font = ImageFont.truetype(font_path, status_font_size)
    status_w, status_h = draw.textsize(status_text, font=status_font)
    status_x = (width - status_w) // 2
    draw.text((status_x, 0), status_text, font=status_font, fill=(255, 255, 255))

    # --- 渲染 Emoji ---
    emoji_font_size = 40
    emoji_y = status_h + 5
    ascent, _ = status_font.getmetrics()
    baseline = emoji_y + ascent
    x = 0
    emoji_width_total = 0

    # 计算 emoji 总宽度
    for char in emoji_text:
        if is_emoji(char):
            emoji_img = get_local_emoji_svg_image(char, size=emoji_font_size)
            if emoji_img:
                emoji_width_total += emoji_img.width
        else:
            emoji_font = ImageFont.truetype(font_path, emoji_font_size)
            w, _ = draw.textsize(char, font=emoji_font)
            emoji_width_total += w

    emoji_x = (width - emoji_width_total) // 2
    x = emoji_x
    for char in emoji_text:
        if is_emoji(char):
            emoji_img = get_local_emoji_svg_image(char, size=emoji_font_size)
            if emoji_img:
                y = baseline - emoji_img.height
                image.paste(emoji_img, (x, y), emoji_img)
                x += emoji_img.width
        else:
            emoji_font = ImageFont.truetype(font_path, emoji_font_size)
            draw.text((x, emoji_y), char, font=emoji_font, fill=(255, 255, 255))
            w, _ = draw.textsize(char, font=emoji_font)
            x += w

    # --- 渲染信息文本（中文自动换行 + 字号缩放） ---
    info_top = emoji_y + emoji_font_size + 5
    available_height = height - info_top

    max_font_size = 28
    min_font_size = 12
    lines = []
    final_font_size = min_font_size
    for font_size in range(max_font_size, min_font_size - 1, -1):
        font = ImageFont.truetype(font_path, font_size)
        temp_lines = []
        line = ""
        for char in info_text:
            test_line = line + char
            w, _ = draw.textsize(test_line, font=font)
            if w <= width:
                line = test_line
            else:
                temp_lines.append(line)
                line = char
        if line:
            temp_lines.append(line)

        total_height = len(temp_lines) * (font_size + 4)
        if total_height <= available_height:
            lines = temp_lines
            final_font_size = font_size
            break

    # 开始绘制信息段
    font = ImageFont.truetype(font_path, final_font_size)
    y = info_top
    for line in lines:
        draw.text((0, y), line, font=font, fill=(255, 255, 255))
        y += final_font_size + 4

    return image




from lcd import LCD

lcd = LCD()

# 字体路径（需要支持中文）
font_path = "NotoSansSC-Bold.ttf"
font_size = 32

# entries = [
#     (50, 0, "😊🌹", 48),
#     (0, 40, "PiSugar", 32),
#     (0, 80, "EchoView", 28),
# ]
# img = render_multi_text(
#     entries,
#     font_path=font_path,
#     image_size=(lcd.WIDTH, lcd.HEIGHT)
# )


status = "当前状态：正常"
emoji = "🚀😎"
info = "这是一个测试信息。信息可能会比较长，需要自动换行并适应屏幕大小和空间，不然就显示不全了。"

img = render_status_page(
    status_text=status,
    emoji_text=emoji,
    info_text=info,
    font_path=font_path,
    image_size=(lcd.WIDTH, lcd.HEIGHT)
)

rgb565_data = image_to_rgb565(img, lcd.WIDTH, lcd.HEIGHT)
lcd.draw_image(0, 0, lcd.WIDTH, lcd.HEIGHT, rgb565_data)

