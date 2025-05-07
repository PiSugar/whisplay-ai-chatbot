import RPi.GPIO as GPIO
import time

# 定义RGB LED的GPIO引脚（物理编号）
RED_PIN = 22
GREEN_PIN = 18
BLUE_PIN = 16

# 设置GPIO模式
GPIO.setmode(GPIO.BOARD)
GPIO.setup(RED_PIN, GPIO.OUT)
GPIO.setup(GREEN_PIN, GPIO.OUT)
GPIO.setup(BLUE_PIN, GPIO.OUT)

# 设置PWM，频率为1kHz
freq = 100
red_pwm = GPIO.PWM(RED_PIN, freq)
green_pwm = GPIO.PWM(GREEN_PIN, freq)
blue_pwm = GPIO.PWM(BLUE_PIN, freq)

# 启动PWM，占空比为0（LED熄灭）
red_pwm.start(0)
green_pwm.start(0)
blue_pwm.start(0)

def set_color(r, g, b):
    """
    设置RGB颜色，r, g, b 取值范围 0-255
    由于是共阳LED，需要对占空比进行转换
    """
    red_pwm.ChangeDutyCycle(100 - (r / 255 * 100))
    green_pwm.ChangeDutyCycle(100 - (g / 255 * 100))
    blue_pwm.ChangeDutyCycle(100 - (b / 255 * 100))

try:
    while True:
        set_color(255, 0, 0)  # 红色
        time.sleep(1)
        set_color(0, 255, 0)  # 绿色
        time.sleep(1)
        set_color(0, 0, 255)  # 蓝色
        time.sleep(1)
        set_color(255, 255, 0)  # 黄色
        time.sleep(1)
        set_color(0, 255, 255)  # 青色
        time.sleep(1)
        set_color(255, 0, 255)  # 品红色
        time.sleep(1)
        set_color(255, 255, 255)  # 白色
        time.sleep(1)
        set_color(0, 0, 0)  # 关闭
        time.sleep(1)
except KeyboardInterrupt:
    pass

# 清理GPIO
red_pwm.stop()
green_pwm.stop()
blue_pwm.stop()
GPIO.cleanup()
