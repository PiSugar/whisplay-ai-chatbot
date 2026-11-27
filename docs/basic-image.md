# Whisplay basic image

Basic images whose release notes mention automatic HAT detection include drivers for both Whisplay HAT (SPI LCD) and Whisplay HAT+ (DSI touchscreen).

## First boot or switching HATs

1. Power off the Raspberry Pi before connecting or replacing the HAT. For HAT+, check the model-specific DSI connector in the [Whisplay Plus driver guide](https://github.com/PiSugar/whisplay-plus#install).
2. Power on the Pi. The image detects the HAT and selects its driver configuration.
3. Wait for one automatic reboot. This applies the configuration before Linux loads the display and audio drivers. The HAT screen may stay blank during detection on the first boot.

With the same HAT connected, subsequent boots use the saved driver configuration and continue without an extra reboot. After switching HATs, the image detects the change and reboots once again.

To check the selected driver profile from the Raspberry Pi terminal or over SSH, run:

```bash
journalctl -b -u whisplay-select-hat.service
```

The log shows `Using Whisplay driver profile: hat` for Whisplay HAT or `Using Whisplay driver profile: hat-plus` for Whisplay HAT+.
