import os

from PIL import Image
from icon_constants import STATUS_ICON_HEIGHT, NETWORK_ICON_CENTER_SCALE


# Map signal level (1=weak, 2=medium, 3=strong) to icon file name.
WIFI_LEVEL_ICONS = {
    1: "wifi-weak.png",
    2: "wifi-medium.png",
    3: "wifi-strong.png",
}


class WifiStatusIcon:
    _scaled_icon_cache = {}
    _source_icon_cache = {}

    def __init__(self, status_font_size, signal_level, icon_center_scale=NETWORK_ICON_CENTER_SCALE):
        self.status_font_size = status_font_size
        self.icon_height = STATUS_ICON_HEIGHT
        self.icon_center_scale = icon_center_scale if icon_center_scale and icon_center_scale > 0 else 1.0
        # Clamp level to one of the supported icons.
        try:
            level = int(signal_level)
        except (TypeError, ValueError):
            level = 0
        if level < 1:
            level = 1
        elif level > 3:
            level = 3
        self.signal_level = level
        self.icon_name = WIFI_LEVEL_ICONS[self.signal_level]
        self.base_icon_width = self._get_width_for_height(self.icon_name, self.icon_height)
        self.icon_image = self._get_scaled_icon(self.icon_name, self.icon_height, self.icon_center_scale)
        self.icon_width = self.base_icon_width if self.base_icon_width else (self.icon_image.width if self.icon_image else 18)

    def measure(self):
        return (self.icon_width, self.icon_height)

    def get_top_y(self):
        return self.status_font_size // 2

    def render(self, draw, x, y):
        if not self.icon_image or not hasattr(draw, "_image"):
            return
        paste_x = x + (self.icon_width - self.icon_image.width) // 2
        paste_y = y + (self.icon_height - self.icon_image.height) // 2
        draw._image.paste(self.icon_image, (paste_x, paste_y), self.icon_image)

    @classmethod
    def _get_source_icon(cls, icon_name):
        if icon_name in cls._source_icon_cache:
            return cls._source_icon_cache[icon_name]

        icon_path = os.path.join(os.path.dirname(__file__), "..", "img", icon_name)
        icon_path = os.path.abspath(icon_path)
        if not os.path.exists(icon_path):
            cls._source_icon_cache[icon_name] = None
            return None

        cls._source_icon_cache[icon_name] = Image.open(icon_path).convert("RGBA")
        return cls._source_icon_cache[icon_name]

    @classmethod
    def _get_width_for_height(cls, icon_name, target_height):
        icon_image = cls._get_source_icon(icon_name)
        if not icon_image:
            return None
        src_width, src_height = icon_image.size
        if src_height <= 0:
            return None
        return max(1, int(round(src_width * target_height / src_height)))

    @classmethod
    def _get_scaled_icon(cls, icon_name, target_height, center_scale):
        cache_key = (icon_name, target_height, round(center_scale, 4))
        if cache_key in cls._scaled_icon_cache:
            return cls._scaled_icon_cache[cache_key]

        icon_image = cls._get_source_icon(icon_name)
        if not icon_image:
            cls._scaled_icon_cache[cache_key] = None
            return None

        src_width, src_height = icon_image.size
        if src_height <= 0:
            cls._scaled_icon_cache[cache_key] = None
            return None

        scaled_height = max(1, int(round(target_height * center_scale)))
        scaled_width = max(1, int(round(src_width * scaled_height / src_height)))
        resized_icon = icon_image.resize((scaled_width, scaled_height), Image.LANCZOS)
        cls._scaled_icon_cache[cache_key] = resized_icon
        return resized_icon
