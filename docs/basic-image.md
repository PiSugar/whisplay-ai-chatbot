# Whisplay basic images

Choose the asset that matches your display and HAT. Both images are built from 64-bit Raspberry Pi OS (Debian Trixie) and include the chatbot, Node.js 22, SSH, and PiSugar Wi-Fi setup. [GitHub Releases](https://github.com/PiSugar/whisplay-ai-chatbot/releases/latest)

| Hardware | Image asset | How to open the chatbot |
| --- | --- | --- |
| Whisplay HAT with the SPI LCD | `whisplay-basic.img.xz` | Select **AI Chatbot** in the Whisplay launcher. |
| Whisplay HAT+ with the MIPI DSI touchscreen | `whisplay-plus-basic.img.xz` | Open **Whisplay AI Chatbot** from the Raspberry Pi desktop or applications menu. |

From v2.5.2, both images use Whisplay U-Boot v0.6.0. Whisplay HAT shows the SPI logo in U-Boot and uses the Whisplay hardware daemon. Whisplay HAT+ shows a centered Whisplay logo on the DSI touchscreen during early Linux startup through Plymouth. It uses native HAT+ display, touch, and audio drivers and Chromium for the fullscreen interface. [U-Boot release notes](https://github.com/PiSugar/whisplay-u-boot/releases/tag/v0.6.0)

Check the supported HAT+ boards and ribbon connections before powering on. [Whisplay Plus driver guide](https://github.com/PiSugar/whisplay-plus#install)

## Flash and start

1. Download the matching `.img.xz` and its `.sha256` file from the same release. Use Raspberry Pi Imager to flash the image, or extract it to `.img` for a tool that needs an uncompressed file.
2. Power off the Pi, connect the HAT and its display, then insert the flashed SD card and power on. The image already has the driver configuration for that HAT.
3. Connect to Wi-Fi and run `whisplay configure` to set up your AI providers. The project is installed at `~/whisplay-ai-chatbot`.
4. Open the chatbot using the launcher listed above. After a configuration change, restart it from the matching launcher.

When changing HAT models, power off the Pi and flash the matching image. Back up any settings you want to reuse and keep the new image's preconfigured `WHISPLAY_HAT_MODEL` value.
