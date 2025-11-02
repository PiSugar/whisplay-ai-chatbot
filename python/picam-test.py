from picamera2 import Picamera2
from PIL import Image, ImageDraw, ImageFont
from whisplay import WhisplayBoard
from utils import ColorUtils, ImageUtils, TextUtils
import sys
import time


if __name__ == "__main__":
    whisplay = WhisplayBoard()
    print(f"[LCD] Initialization finished: {whisplay.LCD_WIDTH}x{whisplay.LCD_HEIGHT}")
    
    
    def cleanup_and_exit(signum, frame):
        print("[System] Exiting...")
        whisplay.cleanup()
        sys.exit(0)
        
    picam2 = Picamera2()
    picam2.configure(picam2.create_preview_configuration(main={"format": "RGB888", "size": (whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)}))
    picam2.start()
    time.sleep(2)  # Allow camera to warm up
    try:
        
        # Keep the main thread alive
        while True:
            # Capture image from Pi Camera
            
            frame = picam2.capture_array()
            img = Image.fromarray(frame)
            img = img.resize((whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT))
            # Convert the image to RGB565 format
            pixel_data = ImageUtils.convert_image_to_rgb565(img)
            # Draw the image on the LCD
            whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, pixel_data)

            # time.sleep(0.1)  # Adjust the delay as needed for your application
    except KeyboardInterrupt:
        picam2.stop()
        cleanup_and_exit(None, None)


