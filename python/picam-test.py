from picamera2 import Picamera2
import cv2
from whisplay import WhisplayBoard
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
        
    picam2 = Picamera2()
    picam2.configure(picam2.create_preview_configuration(main={"size": (whisplay.LCD_WIDTH * 2, whisplay.LCD_HEIGHT * 2)}))
    picam2.start()
    whisplay.set_backlight(100)
    time.sleep(2)  # Allow camera to warm up

    def convertCameraFrameToRGB565(frame, width, height):
        # Resize frame to fit the display
        frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_NEAREST)
        r = (frame[:, :, 0] >> 3).astype(np.uint16)  # 5 bit
        g = (frame[:, :, 1] >> 2).astype(np.uint16)  # 6 bit
        b = (frame[:, :, 2] >> 3).astype(np.uint16)  # 5 bit
        rgb565_data = (r << 11) | (g << 5) | b
        return rgb565_data.byteswap().tobytes()

    try:
        
        # Keep the main thread alive
        while True:
            # Capture image from Pi Camera
            start_time = time.time()
            frame = picam2.capture_array()
            pixel_bytes = convertCameraFrameToRGB565(frame, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)
            
            # Send the pixel data to the display
            whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, pixel_bytes)
            end_time = time.time()
            fps = 1 / (end_time - start_time)
            print(f"[Camera] Displayed frame at {fps:.2f} FPS")
    except KeyboardInterrupt:
        picam2.stop()
        cleanup_and_exit(None, None)


