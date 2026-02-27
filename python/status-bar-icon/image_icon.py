import os

from PIL import Image
from icon_constants import STATUS_ICON_HEIGHT, IMAGE_ICON_CENTER_SCALE


class ImageStatusIcon:
    _scaled_icon_cache = {}
    _source_icon = None

    def __init__(self, status_font_size, icon_center_scale=IMAGE_ICON_CENTER_SCALE):
        self.status_font_size = status_font_size
        self.icon_height = STATUS_ICON_HEIGHT
        self.icon_center_scale = icon_center_scale if icon_center_scale and icon_center_scale > 0 else 1.0
        self.base_icon_width = self._get_width_for_height(self.icon_height)
        self.icon_image = self._get_scaled_icon(self.icon_height, self.icon_center_scale)
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
    def _get_source_icon(cls):
        if cls._source_icon is not None:
            return cls._source_icon

        icon_path = os.path.join(os.path.dirname(__file__), "..", "img", "image.png")
        icon_path = os.path.abspath(icon_path)
        if not os.path.exists(icon_path):
            return None

        cls._source_icon = Image.open(icon_path).convert("RGBA")
        return cls._source_icon

    @classmethod
    def _get_width_for_height(cls, target_height):
        icon_image = cls._get_source_icon()
        if not icon_image:
            return None
        src_width, src_height = icon_image.size
        if src_height <= 0:
            return None
        return max(1, int(round(src_width * target_height / src_height)))

    @classmethod
    def _get_scaled_icon(cls, target_height, center_scale):
        cache_key = (target_height, round(center_scale, 4))
        if cache_key in cls._scaled_icon_cache:
            return cls._scaled_icon_cache[cache_key]

        icon_image = cls._get_source_icon()
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
