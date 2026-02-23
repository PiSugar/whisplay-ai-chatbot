
from PIL import Image
from whisplay import WhisplayBoard
import sys
import time
import threading
import os
from utils import ImageUtils

try:
  from picamera2 import Picamera2
except ImportError:
  Picamera2 = None

class CameraThread(threading.Thread):
    
    picam2 = None

    def __init__(self, whisplay, image_path):
        super().__init__()
        self.whisplay = whisplay
        if CameraThread.picam2 is None:
            CameraThread.picam2 = Picamera2()
            CameraThread.picam2.configure(CameraThread.picam2.create_preview_configuration(main={"size": (self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT)}))
        CameraThread.picam2.start()
        self.running = False
        self.capture_image = None
        self.image_path = image_path
        self.web_frame_path = os.getenv(
            "WHISPLAY_WEB_CAMERA_PATH",
            os.path.join("data", "camera_feed", "web_live.jpg"),
        )
        if self.web_frame_path:
            frame_dir = os.path.dirname(self.web_frame_path)
            if frame_dir:
                os.makedirs(frame_dir, exist_ok=True)
        self.web_frame_interval = int(os.getenv("WHISPLAY_WEB_CAMERA_INTERVAL", "3"))
        
    def start(self):
        self.running = True
        return super().start()

    def run(self):
        frame_index = 0
         # delete existing web frame files
        if self.web_frame_path and os.path.exists(self.web_frame_path):
            os.remove(self.web_frame_path)
        while self.running and self.capture_image is None:
            start_time = time.time()
            frame = CameraThread.picam2.capture_array()
            pixel_bytes = ImageUtils.convertCameraFrameToRGB565(frame, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT)
            self.whisplay.draw_image(0, 0, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT, pixel_bytes)
            if self.web_frame_path and frame_index % self.web_frame_interval == 0:
                try:
                    image = Image.fromarray(frame)
                    if image.mode != "RGB":
                        image = image.convert("RGB")
                    image.save(self.web_frame_path, format="JPEG", quality=80)
                except Exception:
                    pass
            frame_index += 1
            end_time = time.time()
            fps = 1 / (end_time - start_time)
        # Display the captured image
        if self.capture_image is not None:
            pixel_bytes = ImageUtils.image_to_rgb565(self.capture_image, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT)
            self.whisplay.draw_image(0, 0, self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT, pixel_bytes)
        time.sleep(2)  # Display for 2 seconds
                
    def capture(self):
        frame = CameraThread.picam2.capture_array()
        self.capture_image = Image.fromarray(frame)
        # convert to RGB to avoid errors when saving as JPEG (JPEG does not support alpha)
        if self.capture_image.mode != "RGB":
            self.capture_image = self.capture_image.convert("RGB")
        # save to file
        self.capture_image.save(self.image_path, format="JPEG", quality=95)
        print(f"[Camera] Captured image saved to {self.image_path}")

    def stop(self):
        self.running = False
        self.picam2.stop()
        self.join()


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

    try:
        
        # Keep the main thread alive
        while True:
            # Capture image from Pi Camera
            start_time = time.time()
            frame = picam2.capture_array()
            pixel_bytes = ImageUtils.convertCameraFrameToRGB565(frame, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT)
            
            # Send the pixel data to the display
            whisplay.draw_image(0, 0, whisplay.LCD_WIDTH, whisplay.LCD_HEIGHT, pixel_bytes)
            end_time = time.time()
            fps = 1 / (end_time - start_time)
            print(f"[Camera] Displayed frame at {fps:.2f} FPS")
    except KeyboardInterrupt:
        picam2.stop()
        cleanup_and_exit(None, None)


