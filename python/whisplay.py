import spidev
import time
import os
import threading


# ==================== Platform Detection ====================
def _detect_platform():
    """Detect hardware platform type"""
    try:
        with open("/proc/device-tree/model", "r") as f:
            model = f.read().strip('\0').strip()
            if "Raspberry" in model:
                return "rpi", model
            elif "Radxa" in model:
                return "radxa", model
    except Exception:
        pass
    # Also check compatible string (some SoCs use non-descriptive model names)
    try:
        with open("/proc/device-tree/compatible", "r") as f:
            compat = f.read()
            if "radxa" in compat.lower():
                # Extract first compatible string as readable model name
                parts = compat.split('\0')
                model = parts[0] if parts else "Unknown Radxa"
                return "radxa", model
    except Exception:
        pass
    return "unknown", "Unknown"


PLATFORM, PLATFORM_MODEL = _detect_platform()

# Import GPIO library based on platform
if PLATFORM == "rpi":
    import RPi.GPIO as GPIO
elif PLATFORM == "radxa":
    import gpiod
else:
    # Try auto-detection via available libraries
    try:
        import RPi.GPIO as GPIO
        PLATFORM = "rpi"
        PLATFORM_MODEL = "Unknown Raspberry Pi"
    except ImportError:
        try:
            import gpiod
            PLATFORM = "radxa"
            PLATFORM_MODEL = "Unknown Radxa"
        except ImportError:
            raise RuntimeError(
                "No supported GPIO library found.\n"
                "Raspberry Pi: pip install RPi.GPIO\n"
                "Radxa: sudo apt install python3-libgpiod"
            )


# ==================== Radxa Pin Mappings ====================
# Physical 40-pin header pin number -> (gpiochip number, line offset)

# Based on RK3566 Radxa ZERO 3W
RADXA_ZERO3_PIN_MAP = {
    3: (1, 0),    5: (1, 1),    7: (3, 20),   8: (0, 25),
    10: (0, 24),  11: (3, 1),   12: (3, 3),   13: (3, 2),
    15: (3, 8),   16: (3, 9),   18: (3, 10),  19: (4, 19),
    21: (4, 21),  22: (3, 17),  23: (4, 18),  24: (4, 22),
    26: (4, 25),  27: (4, 10),  28: (4, 11),  29: (3, 11),
    31: (3, 12),  32: (3, 18),  33: (3, 19),  35: (3, 4),
    36: (3, 7),   37: (1, 4),   38: (3, 6),   40: (3, 5),
}

# Based on Allwinner A733 Radxa Cubie A7Z
# gpiochip0 (2000000.pinctrl, 352 lines): PA=0-31, PB=32-63, ..., PJ=288-319, PK=320-351
# gpiochip1 (7025000.pinctrl, 64 lines): PL=0-31, PM=32-63
RADXA_CUBIE_A7Z_PIN_MAP = {
    3: (0, 311),   5: (0, 310),   7: (0, 32),    8: (0, 41),
    10: (0, 42),   11: (0, 33),   12: (0, 37),   13: (1, 6),
    15: (1, 7),    16: (0, 312),  18: (0, 313),  19: (0, 108),
    21: (0, 109),  22: (1, 5),    23: (0, 107),  24: (0, 106),
    26: (0, 110),  27: (0, 113),  28: (0, 112),  29: (0, 34),
    31: (0, 35),   32: (1, 37),   33: (1, 35),   35: (0, 38),
    36: (0, 36),   37: (1, 36),   38: (0, 40),   40: (0, 39),
}


def _detect_radxa_board():
    """Detect specific Radxa board variant from device tree compatible string"""
    try:
        with open("/proc/device-tree/compatible", "r") as f:
            compat = f.read().lower()
            if "cubie-a7z" in compat:
                return "cubie-a7z"
            elif "cubie-a7a" in compat:
                return "cubie-a7a"
            elif "cubie-a7s" in compat:
                return "cubie-a7s"
    except Exception:
        pass
    # Default to zero3w for backward compatibility
    return "zero3w"


# ==================== Software PWM ====================
class SoftPWM:
    """Software PWM implementation for GPIO platforms without hardware PWM support"""

    def __init__(self, set_value_func, frequency=100):
        self._set_value = set_value_func
        self.frequency = frequency
        self.duty_cycle = 0.0
        self._running = False
        self._thread = None

    def start(self, duty_cycle=0):
        self.duty_cycle = float(duty_cycle)
        self._running = True
        self._thread = threading.Thread(target=self._pwm_loop, daemon=True)
        self._thread.start()

    def ChangeDutyCycle(self, duty_cycle):
        self.duty_cycle = max(0.0, min(100.0, float(duty_cycle)))

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)
        try:
            self._set_value(0)
        except Exception:
            pass

    def _pwm_loop(self):
        while self._running:
            period = 1.0 / self.frequency
            dc = self.duty_cycle
            if dc <= 0:
                self._set_value(0)
                time.sleep(period)
            elif dc >= 100:
                self._set_value(1)
                time.sleep(period)
            else:
                on_time = period * dc / 100.0
                off_time = period - on_time
                self._set_value(1)
                time.sleep(on_time)
                self._set_value(0)
                time.sleep(off_time)


class WhisplayBoard:
    # LCD parameters
    LCD_WIDTH = 240
    LCD_HEIGHT = 280
    CornerHeight = 20  # Rounded corner height in pixels

    # Physical pin definitions (BOARD mode - shared by both platforms)
    DC_PIN = 13
    RST_PIN = 7
    LED_PIN = 15

    # RGB LED pins
    RED_PIN = 22
    GREEN_PIN = 18
    BLUE_PIN = 16

    # Button pin
    BUTTON_PIN = 11

    def __init__(self):
        self.platform = PLATFORM
        self.backlight_pwm = None
        self._current_r = 0
        self._current_g = 0
        self._current_b = 0
        self.button_press_callback = None
        self.button_release_callback = None

        if self.platform == "rpi":
            self._init_rpi()
        elif self.platform == "radxa":
            self._init_radxa()
        else:
            raise RuntimeError(f"Unsupported platform: {self.platform}")

        self.previous_frame = None
        # Detect hardware version and set backlight mode
        self._detect_hardware_version()
        self._detect_wm8960()
        self.set_backlight(0)
        self._reset_lcd()
        self._init_display()
        self.fill_screen(0)

    # ==================== Raspberry Pi Initialization ====================
    def _init_rpi(self):
        GPIO.setmode(GPIO.BOARD)
        GPIO.setwarnings(False)

        # Initialize LCD pins
        GPIO.setup([self.DC_PIN, self.RST_PIN, self.LED_PIN], GPIO.OUT)
        GPIO.output(self.LED_PIN, GPIO.LOW)  # Enable backlight

        # Initialize RGB LED pins
        GPIO.setup([self.RED_PIN, self.GREEN_PIN, self.BLUE_PIN], GPIO.OUT)
        self.red_pwm = GPIO.PWM(self.RED_PIN, 100)
        self.green_pwm = GPIO.PWM(self.GREEN_PIN, 100)
        self.blue_pwm = GPIO.PWM(self.BLUE_PIN, 100)
        self.red_pwm.start(0)
        self.green_pwm.start(0)
        self.blue_pwm.start(0)

        # Initialize button
        GPIO.setup(self.BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        GPIO.add_event_detect(
            self.BUTTON_PIN, GPIO.BOTH, callback=self._button_event_rpi, bouncetime=50
        )

        # Initialize SPI
        self.spi = spidev.SpiDev()
        self.spi.open(0, 0)
        self.spi.max_speed_hz = 100_000_000
        self.spi.mode = 0b00

    # ==================== Radxa Initialization ====================
    def _init_radxa(self):
        self._radxa_board = _detect_radxa_board()

        if self._radxa_board == "cubie-a7z":
            pin_map = RADXA_CUBIE_A7Z_PIN_MAP
        else:
            pin_map = RADXA_ZERO3_PIN_MAP

        # Open required GPIO chips
        self._gpio_chips = {}
        self._gpio_lines = {}

        pins_used = [self.DC_PIN, self.RST_PIN, self.LED_PIN,
                     self.RED_PIN, self.GREEN_PIN, self.BLUE_PIN,
                     self.BUTTON_PIN]

        for pin in pins_used:
            if pin not in pin_map:
                raise RuntimeError(f"Physical pin {pin} is not defined in Radxa Zero 3W pin map")
            chip_num, _ = pin_map[pin]
            if chip_num not in self._gpio_chips:
                self._gpio_chips[chip_num] = gpiod.Chip(f'gpiochip{chip_num}')

        # Request output pins
        output_pins = [self.DC_PIN, self.RST_PIN, self.LED_PIN,
                       self.RED_PIN, self.GREEN_PIN, self.BLUE_PIN]
        for pin in output_pins:
            chip_num, line_offset = pin_map[pin]
            chip = self._gpio_chips[chip_num]
            line = chip.get_line(line_offset)
            line.request(consumer='whisplay', type=gpiod.LINE_REQ_DIR_OUT, default_val=0)
            self._gpio_lines[pin] = line

        # Enable backlight (LOW = on)
        self._gpio_lines[self.LED_PIN].set_value(0)

        # Initialize RGB LED (using software PWM)
        red_line = self._gpio_lines[self.RED_PIN]
        green_line = self._gpio_lines[self.GREEN_PIN]
        blue_line = self._gpio_lines[self.BLUE_PIN]
        self.red_pwm = SoftPWM(red_line.set_value, 100)
        self.green_pwm = SoftPWM(green_line.set_value, 100)
        self.blue_pwm = SoftPWM(blue_line.set_value, 100)
        self.red_pwm.start(0)
        self.green_pwm.start(0)
        self.blue_pwm.start(0)

        # Initialize button (input with pull-up, polled for state changes)
        chip_num, line_offset = pin_map[self.BUTTON_PIN]
        chip = self._gpio_chips[chip_num]
        btn_line = chip.get_line(line_offset)
        try:
            btn_line.request(
                consumer='whisplay-btn',
                type=gpiod.LINE_REQ_DIR_IN,
                flags=gpiod.LINE_REQ_FLAG_BIAS_PULL_UP
            )
        except Exception:
            # Fallback: no internal pull-up (relies on external pull-up resistor)
            btn_line.request(
                consumer='whisplay-btn',
                type=gpiod.LINE_REQ_DIR_IN
            )
        self._gpio_lines[self.BUTTON_PIN] = btn_line

        # Start button event listener thread
        self._btn_thread_running = True
        self._btn_thread = threading.Thread(target=self._button_monitor_radxa, daemon=True)
        self._btn_thread.start()

        # Initialize SPI (board-specific SPI bus)
        self.spi = spidev.SpiDev()
        if self._radxa_board == "cubie-a7z":
            self.spi.open(1, 0)  # SPI1, CS0 (Allwinner A733)
            self.spi.max_speed_hz = 48_000_000
        else:
            self.spi.open(3, 0)  # SPI3, CS0 (RK3566 Radxa Zero 3W)
            self.spi.max_speed_hz = 48_000_000  # RK3566 SPI max 50MHz
        self.spi.mode = 0b00

    def _button_monitor_radxa(self):
        """Button state polling thread for Radxa platform.
        Reads GPIO value directly (like RPi's GPIO.input), avoiding edge event ambiguity.
        HIGH (1) = pressed, LOW (0) = released (matching RPi behavior).
        10ms poll interval provides natural debounce.
        """
        btn_line = self._gpio_lines[self.BUTTON_PIN]
        last_state = btn_line.get_value()
        while self._btn_thread_running:
            try:
                state = btn_line.get_value()
                if state != last_state:
                    last_state = state
                    if state == 1:
                        # Button pressed (HIGH)
                        if self.button_press_callback:
                            self.button_press_callback()
                    else:
                        # Button released (LOW)
                        if self.button_release_callback:
                            self.button_release_callback()
            except Exception:
                if self._btn_thread_running:
                    pass
            time.sleep(0.01)  # 10ms poll interval

    # ==================== Cross-platform GPIO Helpers ====================
    def _gpio_output(self, pin, value):
        """Set GPIO pin output value"""
        if self.platform == "rpi":
            GPIO.output(pin, GPIO.HIGH if value else GPIO.LOW)
        elif self.platform == "radxa":
            self._gpio_lines[pin].set_value(1 if value else 0)

    def _gpio_input(self, pin):
        """Read GPIO pin input value"""
        if self.platform == "rpi":
            return GPIO.input(pin)
        elif self.platform == "radxa":
            return self._gpio_lines[pin].get_value()

    # ==================== Hardware Detection ====================
    def _detect_hardware_version(self):
        """Detect hardware version and set backlight mode accordingly"""
        try:
            model = PLATFORM_MODEL
            if self.platform == "rpi":
                if "Zero" in model and "2" not in model:
                    self.backlight_mode = False  # Use simple on/off mode
                else:
                    self.backlight_mode = True  # Use PWM mode
            elif self.platform == "radxa":
                # Radxa uses software PWM mode
                self.backlight_mode = True
            else:
                self.backlight_mode = True
            print(
                f"Detected hardware: {model}, Backlight mode: {'PWM' if self.backlight_mode else 'Simple Switch'}")
        except Exception as e:
            print(f"Error detecting hardware version: {e}")
            self.backlight_mode = True

    def _detect_wm8960(self):
        """Detect if a sound card containing wm8960 exists"""
        try:
            with open("/proc/asound/cards", "r") as f:
                lines = f.readlines()
                for line in lines:
                    if "wm8960" in line.lower():
                        print("wm8960 sound card detected.")
                        return True
        except Exception as e:
            print(f"Error detecting wm8960 sound card: {e}")
            return False

        print("wm8960 sound card not detected. Please refer to the following page for installation instructions.")
        print("https://docs.pisugar.com/")
        return False

    # ========== Backlight Control ==========
    def set_backlight(self, brightness):
        if self.backlight_mode:  # PWM mode
            if self.backlight_pwm is None:
                if self.platform == "rpi":
                    self.backlight_pwm = GPIO.PWM(self.LED_PIN, 1000)
                elif self.platform == "radxa":
                    led_line = self._gpio_lines[self.LED_PIN]
                    self.backlight_pwm = SoftPWM(led_line.set_value, 1000)
                self.backlight_pwm.start(100)
            if 0 <= brightness <= 100:
                duty_cycle = 100 - brightness
                self.backlight_pwm.ChangeDutyCycle(duty_cycle)
        else:  # Simple on/off mode
            if brightness == 0:
                self._gpio_output(self.LED_PIN, 1)  # Turn off backlight
            else:
                self._gpio_output(self.LED_PIN, 0)  # Turn on backlight

    def set_backlight_mode(self, mode):
        """
        Set backlight mode
        :param mode: True for PWM brightness control, False for simple on/off
        """
        if mode == self.backlight_mode:
            return  # Mode unchanged, no action needed

        if mode:  # Switch to PWM mode
            if self.platform == "rpi":
                self.backlight_pwm = GPIO.PWM(self.LED_PIN, 1000)
            elif self.platform == "radxa":
                led_line = self._gpio_lines[self.LED_PIN]
                self.backlight_pwm = SoftPWM(led_line.set_value, 1000)
            self.backlight_pwm.start(100)
        else:  # Switch to simple on/off mode
            if self.backlight_pwm is not None:
                self.backlight_pwm.stop()
                self.backlight_pwm = None
            self._gpio_output(self.LED_PIN, 1)  # Ensure backlight is on
        self.backlight_mode = mode

    def _reset_lcd(self):
        self._gpio_output(self.RST_PIN, 1)
        time.sleep(0.1)
        self._gpio_output(self.RST_PIN, 0)
        time.sleep(0.1)
        self._gpio_output(self.RST_PIN, 1)
        time.sleep(0.12)

    def _init_display(self):
        self._send_command(0x11)
        time.sleep(0.12)
        USE_HORIZONTAL = 1
        direction = {0: 0x00, 1: 0xC0, 2: 0x70,
                     3: 0xA0}.get(USE_HORIZONTAL, 0x00)
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
        self._send_command(0x21)
        self._send_command(0x29)

    def _send_command(self, cmd, *args):
        self._gpio_output(self.DC_PIN, 0)
        self.spi.xfer2([cmd])
        if args:
            self._gpio_output(self.DC_PIN, 1)
            self._send_data(list(args))

    def _send_data(self, data):
        self._gpio_output(self.DC_PIN, 1)
        
        try:
            self.spi.writebytes2(data)
        except AttributeError:
            max_chunk = 4096
            for i in range(0, len(data), max_chunk):
                self.spi.writebytes(data[i : i + max_chunk])

    def set_window(self, x0, y0, x1, y1, use_horizontal=0):
        if use_horizontal in (0, 1):
            self._send_command(0x2A, x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF)
            self._send_command(
                0x2B, (y0 + 20) >> 8, (y0 + 20) & 0xFF, (y1 +
                                                         20) >> 8, (y1 + 20) & 0xFF
            )
        elif use_horizontal in (2, 3):
            self._send_command(
                0x2A, (x0 + 20) >> 8, (x0 + 20) & 0xFF, (x1 +
                                                         20) >> 8, (x1 + 20) & 0xFF
            )
            self._send_command(0x2B, y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF)
        self._send_command(0x2C)

    def draw_pixel(self, x, y, color):
        if x >= self.LCD_WIDTH or y >= self.LCD_HEIGHT:
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

    def fill_screen(self, color):
        self.set_window(0, 0, self.LCD_WIDTH - 1, self.LCD_HEIGHT - 1)
        buffer = []
        high = (color >> 8) & 0xFF
        low = color & 0xFF
        for _ in range(self.LCD_WIDTH * self.LCD_HEIGHT):
            buffer.extend([high, low])
        self._send_data(buffer)

    def draw_image(self, x, y, width, height, pixel_data):
        if (x + width > self.LCD_WIDTH) or (y + height > self.LCD_HEIGHT):
            raise ValueError("Image dimensions exceed screen bounds")
        self.set_window(x, y, x + width - 1, y + height - 1)
        self._send_data(pixel_data)

    # ========== RGB LED & Button ==========
    def set_rgb(self, r, g, b):
        self.red_pwm.ChangeDutyCycle(100 - (r / 255 * 100))
        self.green_pwm.ChangeDutyCycle(100 - (g / 255 * 100))
        self.blue_pwm.ChangeDutyCycle(100 - (b / 255 * 100))
        self._current_r = r
        self._current_g = g
        self._current_b = b

    def set_rgb_fade(self, r_target, g_target, b_target, duration_ms=100):
        steps = 20  # Adjust steps to control fade smoothness
        delay_ms = duration_ms / steps

        r_step = (r_target - self._current_r) / steps
        g_step = (g_target - self._current_g) / steps
        b_step = (b_target - self._current_b) / steps

        for _ in range(steps + 1):
            r_interim = int(self._current_r + _ * r_step)
            g_interim = int(self._current_g + _ * g_step)
            b_interim = int(self._current_b + _ * b_step)
            self.set_rgb(
                max(0, min(255, r_interim)),
                max(0, min(255, g_interim)),
                max(0, min(255, b_interim)),
            )
            time.sleep(delay_ms / 1000.0)

    def button_pressed(self):
        return self._gpio_input(self.BUTTON_PIN) == 1

    def on_button_press(self, callback):
        self.button_press_callback = callback

    def on_button_release(self, callback):
        self.button_release_callback = callback

    def _button_release_event(self, channel):
        if self.button_release_callback:
            self.button_release_callback()

    def _button_press_event(self, channel):
        if self.button_press_callback:
            self.button_press_callback()

    def _button_event_rpi(self, channel):
        """Raspberry Pi button interrupt callback"""
        # Pressed = 5V, released = 0V
        if GPIO.input(channel):
            # Button pressed
            self._button_press_event(channel)
        else:
            # Button released
            self._button_release_event(channel)

    # ========== Cleanup ==========
    def cleanup(self):
        # Stop backlight PWM
        if self.backlight_pwm is not None:
            self.backlight_pwm.stop()
        # Close SPI
        self.spi.close()
        # Stop RGB LED PWM
        self.red_pwm.stop()
        self.green_pwm.stop()
        self.blue_pwm.stop()

        if self.platform == "rpi":
            GPIO.cleanup()
        elif self.platform == "radxa":
            # Stop button listener thread
            self._btn_thread_running = False
            if hasattr(self, '_btn_thread') and self._btn_thread:
                self._btn_thread.join(timeout=2)
            # Release GPIO resources
            for line in self._gpio_lines.values():
                try:
                    line.release()
                except Exception:
                    pass
            for chip in self._gpio_chips.values():
                try:
                    chip.close()
                except Exception:
                    pass
