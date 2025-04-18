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

def render_multi_text(entries, font_path, font_size, image_size):
    """
    支持多个 (x, y, text) 输入，逐段绘制文字（可含 emoji）
    :param entries: 列表，每个元素是 (x, y, text) 三元组
    :param font_path: 字体路径
    :param font_size: 字号
    :param image_size: 整体图像大小 (width, height)
    :return: PIL.Image 对象
    """
    image = Image.new("RGBA", image_size, (0, 0, 0, 255))  # 黑底
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(font_path, font_size)
    ascent, descent = font.getmetrics()

    for x0, y0, text in entries:
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



from lcd import LCD

lcd = LCD()

# 字体路径（需要支持中文）
font_path = "NotoSansSC-Bold.ttf"
font_size = 32

entries = [
    (125, 0, "😊"),
    (0, 40, "PiSugar"),
    (0, 80, "EchoView"),
]

img = render_multi_text(
    entries,
    font_path=font_path,
    font_size=32,
    image_size=(lcd.WIDTH, lcd.HEIGHT)
)

rgb565_data = image_to_rgb565(img, lcd.WIDTH, lcd.HEIGHT)
lcd.draw_image(0, 0, lcd.WIDTH, lcd.HEIGHT, rgb565_data)
