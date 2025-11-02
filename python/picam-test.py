from picamera2 import Picamera2
from PIL import Image, ImageDraw, ImageFont
import cv2
from whisplay import WhisplayBoard
from utils import ColorUtils, ImageUtils, TextUtils
import sys
import time
import numpy as np


if __name__ == "__main__":
    whisplay = WhisplayBoard()
    print(f"[LCD] Initialization finished: {whisplay.LCD_WIDTH}x{whisplay.LCD_HEIGHT}")
    
    
    def cleanup_and_exit(signum, frame):
        print("[System] Exiting...")
        whisplay.cleanup()
        sys.exit(0)
        
    # def bgr888_to_rgb565(frame, buf):
    #     # use opencv to convert BGR888 to RGB565
    #     b, g, r = cv2.split(frame)
    #     r = (r >> 3).astype(np.uint16)
    #     g = (g >> 2).astype(np.uint16)
    #     b = (b >> 3).astype(np.uint16)
    #     np.bitwise_or(r << 11, g << 5, out=buf)
    #     np.bitwise_or(buf, b, out=buf)
    #     return buf.byteswap().tobytes()
        
    picam2 = Picamera2()
    picam2.configure(picam2.create_preview_configuration(main={"size": (whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)}))
    picam2.start()
    whisplay.set_backlight(100)
    rgb565_buf = np.empty((whisplay.LCD_HEIGHT, whisplay.LCD_WIDTH), dtype=np.uint16)
    time.sleep(2)  # Allow camera to warm up
    try:
        
        # Keep the main thread alive
        while True:
            # Capture image from Pi Camera
            print("[Camera] Capturing frame...")
            frame = picam2.capture_array()
            # img = img.resize((whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT), Image.LANCZOS)
            # Convert the image to RGB565 format
            # pixel_data = bgr888_to_rgb565(frame, rgb565_buf)
            frame = cv2.resize(frame, (240, 280), interpolation=cv2.INTER_NEAREST)
            r = (frame[:, :, 0] >> 3).astype(np.uint16)  # 5 bit
            g = (frame[:, :, 1] >> 2).astype(np.uint16)  # 6 bit
            b = (frame[:, :, 2] >> 3).astype(np.uint16)  # 5 bit
            rgb565 = (r << 11) | (g << 5) | b
            pixel_bytes = rgb565.byteswap().tobytes()
            
            # Send the pixel data to the display
            whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, pixel_bytes)

            time.sleep(0.1)  # Adjust the delay as needed for your application
    except KeyboardInterrupt:
        picam2.stop()
        cleanup_and_exit(None, None)


