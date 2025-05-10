const { convertPin } = require("./pin-convert");
const Gpio = require("pigpio").Gpio;

// 定义RGB LED的GPIO引脚
const RED_PIN = convertPin(25); // GPIO25
const GREEN_PIN = convertPin(24); // GPIO24
const BLUE_PIN = convertPin(23); // GPIO23

// 设置GPIO模式
const red = new Gpio(25, { mode: Gpio.OUTPUT });
const green = new Gpio(24, { mode: Gpio.OUTPUT });
const blue = new Gpio(23, { mode: Gpio.OUTPUT });

// 设置颜色函数
function setColor(r, g, b) {
  /**
   * 设置RGB颜色，r, g, b 取值范围 0-255
   * 由于是共阳LED，需要对占空比进行转换
   */
  red.pwmWrite(255 - r);
  green.pwmWrite(255 - g);
  blue.pwmWrite(255 - b);
}

// 循环设置颜色
const demo_LED = async function () {
  try {
    while (true) {
      setColor(255, 0, 0); // 红色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(0, 255, 0); // 绿色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(0, 0, 255); // 蓝色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(255, 255, 0); // 黄色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(0, 255, 255); // 青色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(255, 0, 255); // 品红色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(255, 255, 255); // 白色
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setColor(0, 0, 0); // 关闭
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (err) {
    console.error(err);
  } finally {
    // 清理GPIO
    red.digitalWrite(0);
    green.digitalWrite(0);
    blue.digitalWrite(0);
  }
};

modeule.exports = {
  demo_LED,
};
