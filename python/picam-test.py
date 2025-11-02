from picamera2 import Picamera2
from whisplay import WhisplayBoard
import sys
import time


if __name__ == "__main__":
    whisplay = WhisplayBoard()
    print(f"[LCD] Initialization finished: {whisplay.LCD_WIDTH}x{whisplay.LCD_HEIGHT}")
    
    
    def cleanup_and_exit(signum, frame):
        print("[System] Exiting...")
        whisplay.cleanup()
        sys.exit(0)
        
    try:
        # Keep the main thread alive
        while True:
            # Capture image from Pi Camera
            picam2 = Picamera2()
            picam2.configure(picam2.create_preview_configuration(main={"format": "RGB888", "size": (whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)}))
            picam2.start()
            time.sleep(2)  # Allow camera to warm up
            frame = picam2.capture_array()
            picam2.stop()

            # Convert the image to RGB565 format
            pixel_data = []
            for y in range(whisplay.LCD_HEIGHT):
                for x in range(whisplay.LCD_WIDTH):
                    r = frame[y, x, 0] >> 3
                    g = frame[y, x, 1] >> 2
                    b = frame[y, x, 2] >> 3
                    rgb565 = (r << 11) | (g << 5) | b
                    pixel_data.append((rgb565 >> 8) & 0xFF)
                    pixel_data.append(rgb565 & 0xFF)

            # Draw the image on the LCD
            whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, pixel_data)

            # time.sleep(0.1)  # Adjust the delay as needed for your application
    except KeyboardInterrupt:
        cleanup_and_exit(None, None)


