import RPi.GPIO as GPIO
import spidev
import time
from PIL import Image, ImageDraw, ImageFont

font_path = "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf"
font = ImageFont.truetype(font_path, 28)


class LCD:
    def __init__(self):
        self.WIDTH = 240
        self.HEIGHT = 280

        self.DC_PIN = 13
        self.RST_PIN = 7
        self.LED_PIN = 15

        GPIO.setmode(GPIO.BOARD)
        GPIO.setwarnings(False)
        GPIO.setup([self.DC_PIN, self.RST_PIN, self.LED_PIN], GPIO.OUT)



        self.spi = spidev.SpiDev()
        self.spi.open(0, 0)
        self.spi.max_speed_hz = 200_000_000
        self.spi.mode = 0b00

        self.reset()
        self._init_display()
        self.fill(0)
        GPIO.output(self.LED_PIN, GPIO.LOW)
        self.previous_frame = None  # 用于存储上一帧图像

    def reset(self):
        GPIO.output(self.RST_PIN, GPIO.HIGH)
        time.sleep(0.1)
        GPIO.output(self.RST_PIN, GPIO.LOW)
        time.sleep(0.1)
        GPIO.output(self.RST_PIN, GPIO.HIGH)
        time.sleep(0.12)

    def _init_display(self):
        self._send_command(0x11)  # Sleep out
        time.sleep(0.12)

        # 设置方向，替换这里的 USE_HORIZONTAL 逻辑
        USE_HORIZONTAL = 0
        direction = {0: 0x00, 1: 0xC0, 2: 0x70, 3: 0xA0}.get(USE_HORIZONTAL, 0x00)
        self._send_command(0x36, direction)

        self._send_command(0x3A, 0x05)

        self._send_command(0xB2, 0x0C, 0x0C, 0x00, 0x33, 0x33)
        self._send_command(0xB7, 0x35)
        self._send_command(0xBB, 0x32)
        self._send_command(0xC2, 0x01)
        self._send_command(0xC3, 0x15)
        self._send_command(0xC4, 0x20)
        self._send_command(0xC6, 0x0F)
        self._send_command(0xD0, 0xA4, 0xA1)

        self._send_command(
            0xE0,
            0xD0,
            0x08,
            0x0E,
            0x09,
            0x09,
            0x05,
            0x31,
            0x33,
            0x48,
            0x17,
            0x14,
            0x15,
            0x31,
            0x34,
        )

        self._send_command(
            0xE1,
            0xD0,
            0x08,
            0x0E,
            0x09,
            0x09,
            0x15,
            0x31,
            0x33,
            0x48,
            0x17,
            0x14,
            0x15,
            0x31,
            0x34,
        )

        self._send_command(0x21)  # Display inversion on
        self._send_command(0x29)  # Display ON

    def _send_command(self, cmd, *args):
        GPIO.output(self.DC_PIN, GPIO.LOW)
        self.spi.xfer2([cmd])
        if args:
            GPIO.output(self.DC_PIN, GPIO.HIGH)
            self._send_data(list(args))

    def _send_data(self, data):
        GPIO.output(self.DC_PIN, GPIO.HIGH)
        max_chunk = 4096
        for i in range(0, len(data), max_chunk):
            self.spi.writebytes(data[i : i + max_chunk])


    def set_window(self, x0, y0, x1, y1, use_horizontal=0):
        if use_horizontal in (0, 1):
            # 行加偏移（+20）
            self._send_command(0x2A, x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF)  # 列地址设置
            self._send_command(0x2B, (y0 + 20) >> 8, (y0 + 20) & 0xFF, (y1 + 20) >> 8, (y1 + 20) & 0xFF)  # 行地址设置
        elif use_horizontal in (2, 3):
            # 列加偏移（+20）
            self._send_command(0x2A, (x0 + 20) >> 8, (x0 + 20) & 0xFF, (x1 + 20) >> 8, (x1 + 20) & 0xFF)  # 列地址设置
            self._send_command(0x2B, y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF)  # 行地址设置
        self._send_command(0x2C)  # 储存器写

    def draw_pixel(self, x, y, color):
        if x >= self.WIDTH or y >= self.HEIGHT:
            return
        self.set_window(x, y, x, y)
        self._send_data([(color >> 8) & 0xFF, color & 0xFF])

    def draw_line(self, x0, y0, x1, y1, color):
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy

        while True:
            self.draw_pixel(x0, y0, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def fill(self, color):
        self.set_window(0, 0, self.WIDTH - 1, self.HEIGHT - 1)
        buffer = []
        high = (color >> 8) & 0xFF
        low = color & 0xFF
        for _ in range(self.WIDTH * self.HEIGHT):
            buffer.extend([high, low])
        self._send_data(buffer)

    def draw_image(self, x, y, width, height, pixel_data):
        if (x + width > self.WIDTH) or (y + height > self.HEIGHT):
            raise ValueError("图像尺寸超出屏幕范围")
        self.set_window(x, y, x + width - 1, y + height - 1)
        self._send_data(pixel_data)

    def draw_text(self, x, y, text, font, color):
        image = Image.new("RGB", (self.WIDTH, self.HEIGHT), (0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.text((x, y), text, font=font, fill=color)
        pixel_data = list(image.getdata())
        pixel_data = [((r << 16) | (g << 8) | b) for r, g, b in pixel_data]
        self.draw_image(x, y, self.WIDTH, self.HEIGHT, pixel_data)
        # 将 RGB 转换为 16 位颜色格式

    def cleanup(self):
        self.spi.close()
        GPIO.cleanup()



class LCDTest(LCD):
    def __init__(self):
        super().__init__()

    def test_refresh_rate(self, num_iterations=100):
        start_time = time.time()  # 记录开始时间
        for i in range(num_iterations):
            # 使用 fill 函数填充不同颜色来模拟屏幕刷新
            if i % 2 == 0:
                self.fill(0x3ED1)  # 白色
            else:
                self.fill(0x0000)  # 黑色
        end_time = time.time()  # 记录结束时间

        elapsed_time = end_time - start_time
        refresh_rate = num_iterations / elapsed_time  # 刷新率 = 刷新次数 / 花费时间
        print(f"刷新率: {refresh_rate:.2f} 次/秒")
if __name__ == "__main__":
    # 测试刷新率
    lcd_test = LCDTest()
    # lcd_test.test_refresh_rate(100)  # 测试 100 次刷新
    # 测试绘制文字
    lcd_test.fill(0x0000)  # 清屏
    lcd_test.draw_text(10, 10, "Hello World", font, 0xFFFF)  # 白色文字
    lcd_test.draw_text(10, 50, "😊", font, 0xFFFF)  # 白色 emoji
    lcd_test.cleanup()
