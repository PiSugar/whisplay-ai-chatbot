# Whisplay basic images

Choose the asset that matches your display and HAT. Both images are built from 64-bit Raspberry Pi OS (Debian Trixie) and include the chatbot, Node.js 22, SSH, and PiSugar Wi-Fi setup. [GitHub Releases](https://github.com/PiSugar/whisplay-ai-chatbot/releases/latest)

| Hardware | Image asset | How to open the chatbot |
| --- | --- | --- |
| Whisplay HAT with the SPI LCD | `whisplay-basic.img.xz` | Select **AI Chatbot** in the Whisplay launcher. |
| Whisplay HAT+ with the MIPI DSI touchscreen | `whisplay-plus-basic.img.xz` | Open **Whisplay AI Chatbot** from the Raspberry Pi desktop or applications menu. |

The Whisplay HAT image includes the Whisplay SPI boot splash and hardware daemon. The HAT+ image uses the standard Raspberry Pi boot path, the native HAT+ display, touch, and audio drivers, and Chromium for the fullscreen interface. Supported HAT+ boards and ribbon connections are listed in the [Whisplay Plus driver guide](https://github.com/PiSugar/whisplay-plus#install).

## Flash and start

1. Download the matching `.img.xz` and its `.sha256` file from the same release. Use Raspberry Pi Imager to flash the image, or extract it to `.img` for a tool that needs an uncompressed file.
2. Power off the Pi, connect the HAT and its display, then insert the flashed SD card and power on. The image already has the driver configuration for that HAT.
3. Connect to Wi-Fi and run `whisplay configure` to set up your AI providers. The project is installed at `~/whisplay-ai-chatbot`.
4. Open the chatbot using the launcher listed above. After a configuration change, restart it from the matching launcher.

When changing HAT models, power off the Pi and flash the matching image. Back up any settings you want to reuse and keep the new image's preconfigured `WHISPLAY_HAT_MODEL` value.
