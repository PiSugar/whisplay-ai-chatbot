#!/usr/bin/env python3
import sys
import argparse
from PIL import Image, ImageDraw, ImageFont

# 导入驱动库（假设使用 st7789 驱动库）
import st7789

def main():
    # 解析命令行参数: --text 指定显示的文字，--emoji 指定显示的 emoji
    parser = argparse.ArgumentParser(description="使用 ST7789 屏幕显示 emoji 和文字")
    parser.add_argument("--text", type=str, default="Hello World", help="显示的文字内容")
    parser.add_argument("--emoji", type=str, default="😊", help="显示的 emoji")
    args = parser.parse_args()

    # 初始化 ST7789 屏幕。注意：以下参数依据具体平台和接线配置需要修改。
    disp = st7789.ST7789(
        # SPI 相关参数（根据实际情况设置）
        port=0, 
        cs=0, 
        dc=9,            # 数据/命令选择引脚
        backlight=19,    # 背光控制引脚
        rotation=0,     # 旋转角度（根据屏幕安装方向设置）
        width=240, 
        height=280, 
        spi_speed_hz=40000000  # SPI 总线时钟
    )
    disp.begin()

    # 创建一幅与屏幕分辨率一致的 RGB 画布
    image = Image.new("RGB", (disp.width, disp.height))
    draw = ImageDraw.Draw(image)

    # 设置背景颜色为黑色（可选）
    draw.rectangle((0, 0, disp.width, disp.height), fill=(0, 0, 0))

    # 尝试加载支持 emoji 与文字的 TrueType 字体文件.
    # 如果你有专门支持 emoji 的字体文件，则应加载该字体文件。
    try:
        # 注意修改 font_path 为你系统中存在的字体文件路径
        font_path = "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf"
        font = ImageFont.truetype(font_path, 28)
    except IOError:
        print("加载字体失败，请检查字体路径或安装对应字体。")
        sys.exit(1)

    # 合并 emoji 和文字
    display_text = f"{args.emoji} {args.text}"
    # 计算文本尺寸，使得能够在屏幕上居中显示
    bbox = draw.textbbox((0, 0), display_text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (disp.width - text_width) // 2
    y = (disp.height - text_height) // 2

    # 绘制文字（前景颜色白色）
    draw.text((x, y), display_text, font=font, fill=(255, 255, 255))

    # 将绘制好的图像传递到屏幕进行显示
    disp.display(image)

if __name__ == "__main__":
    main()
