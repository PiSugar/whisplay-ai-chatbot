const fs = require("fs");

// https://forums.raspberrypi.com/viewtopic.php?t=359302
// cat /sys/kernel/debug/gpio

// gpiochip0: GPIOs 512-565, parent: platform/3f200000.gpio, pinctrl-bcm2835:
//  gpio-512 (ID_SDA              )
//  gpio-513 (ID_SCL              )
//  gpio-514 (GPIO2               )
//  gpio-515 (GPIO3               )
//  gpio-516 (GPIO4               |lg                  ) out hi
//  gpio-517 (GPIO5               )
//  gpio-518 (GPIO6               )
//  gpio-519 (GPIO7               |spi0 CS1            ) out hi ACTIVE LOW
//  gpio-520 (GPIO8               |spi0 CS0            ) out hi ACTIVE LOW
//  gpio-521 (GPIO9               )
//  gpio-522 (GPIO10              )
//  gpio-523 (GPIO11              )
//  gpio-524 (GPIO12              )
//  gpio-525 (GPIO13              )
//  gpio-526 (GPIO14              )
//  gpio-527 (GPIO15              )
//  gpio-528 (GPIO16              )
//  gpio-529 (GPIO17              )
//  gpio-530 (GPIO18              )
//  gpio-531 (GPIO19              )
//  gpio-532 (GPIO20              )
//  gpio-533 (GPIO21              )
//  gpio-534 (GPIO22              |lg                  ) out lo
//  gpio-535 (GPIO23              )
//  gpio-536 (GPIO24              )
//  gpio-537 (GPIO25              )
//  gpio-538 (GPIO26              )
//  gpio-539 (GPIO27              |lg                  ) out hi
//  gpio-540 (HDMI_HPD_N          |hpd                 ) in  hi ACTIVE LOW
//  gpio-541 (STATUS_LED_N        |ACT                 ) out hi ACTIVE LOW
//  gpio-542 (CTS0                )
//  gpio-543 (RTS0                )
//  gpio-544 (TXD0                )
//  gpio-545 (RXD0                )
//  gpio-546 (SD1_CLK             )
//  gpio-547 (SD1_CMD             )
//  gpio-548 (SD1_DATA0           )
//  gpio-549 (SD1_DATA1           )
//  gpio-550 (SD1_DATA2           )
//  gpio-551 (SD1_DATA3           )
//  gpio-552 (CAM_GPIO1           |cam1_regulator      ) out lo
//  gpio-553 (WL_ON               )
//  gpio-554 (BT_ON               |shutdown            ) out hi
//  gpio-555 (WIFI_CLK            )
//  gpio-556 (SDA0                )
//  gpio-557 (SCL0                )
//  gpio-558 (SMPS_SCL            )
//  gpio-559 (SMPS_SDA            )
//  gpio-560 (SD_CLK_R            )
//  gpio-561 (SD_CMD_R            )
//  gpio-562 (SD_DATA0_R          )
//  gpio-563 (SD_DATA1_R          )
//  gpio-564 (SD_DATA2_R          )
//  gpio-565 (SD_DATA3_R          )

const path = "/sys/kernel/debug/gpio";
const data = fs.readFileSync(path, "utf8");

function convertPin(gpioPin) {
  const lines = data.split("\n");
  for (const line of lines) {
    if (line.includes(`GPIO${gpioPin} `)) {
      const parts = line.split(" ");
      const pin = parts.find((part) => part.startsWith("gpio-"));
      if (pin) {
        return parseInt(pin.replace("gpio-", ""), 10);
      }
    }
  }
  return gpioPin;
}

module.exports = {
  convertPin,
};
