import RPi.GPIO as GPIO
import time

# 定义连接开关的物理引脚号
SWITCH_PIN = 11  # 物理引脚 11

# 设置 GPIO 模式为 BOARD 编号 (使用物理引脚号)
GPIO.setmode(GPIO.BOARD)

# 设置 GPIO 引脚为输入模式，并启用上拉电阻
GPIO.setup(SWITCH_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

try:
    print(f"正在监听连接到物理引脚 {SWITCH_PIN} (GPIO {GPIO.gpio_function(SWITCH_PIN)}) 的开关...")
    while True:
        # 读取开关的状态
        switch_state = GPIO.input(SWITCH_PIN)

        if switch_state == GPIO.LOW:
            print("开关已按下")
        else:
            print("开关已释放")

        time.sleep(0.2)

except KeyboardInterrupt:
    print("程序已停止")
finally:
    GPIO.cleanup()