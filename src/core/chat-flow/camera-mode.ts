import { display, getCurrentStatus } from "../../device/display";

const CAMERA_LONG_PRESS_MS = 2000;
const CAMERA_EXIT_AFTER_CAPTURE_MS = 2000;

let cameraModePressAt = 0;
let cameraModeLongPressTimer: NodeJS.Timeout | null = null;
let cameraModeExitAfterCaptureTimer: NodeJS.Timeout | null = null;

function clearCameraModeTimers(): void {
  if (cameraModeLongPressTimer) {
    clearTimeout(cameraModeLongPressTimer);
    cameraModeLongPressTimer = null;
  }
  if (cameraModeExitAfterCaptureTimer) {
    clearTimeout(cameraModeExitAfterCaptureTimer);
    cameraModeExitAfterCaptureTimer = null;
  }
}

export function resetCameraModeControl(): void {
  clearCameraModeTimers();
  cameraModePressAt = 0;
}

export function enterCameraMode(captureImgPath: string): void {
  resetCameraModeControl();
  display({
    camera_mode: true,
    capture_image_path: captureImgPath,
  });
}

export function handleCameraModePress(): void {
  cameraModePressAt = Date.now();
  if (cameraModeLongPressTimer) {
    clearTimeout(cameraModeLongPressTimer);
  }
  cameraModeLongPressTimer = setTimeout(() => {
    if (!getCurrentStatus().camera_mode) {
      return;
    }
    resetCameraModeControl();
    display({ camera_mode: false });
  }, CAMERA_LONG_PRESS_MS);
}

export function handleCameraModeRelease(): void {
  const status = getCurrentStatus();
  if (!status.camera_mode) {
    resetCameraModeControl();
    return;
  }

  const duration = Date.now() - cameraModePressAt;
  if (cameraModeLongPressTimer) {
    clearTimeout(cameraModeLongPressTimer);
    cameraModeLongPressTimer = null;
  }

  if (cameraModePressAt > 0 && duration <= CAMERA_LONG_PRESS_MS) {
    display({ camera_capture: true });
    if (cameraModeExitAfterCaptureTimer) {
      clearTimeout(cameraModeExitAfterCaptureTimer);
    }
    cameraModeExitAfterCaptureTimer = setTimeout(() => {
      if (getCurrentStatus().camera_mode) {
        display({ camera_mode: false });
      }
      cameraModeExitAfterCaptureTimer = null;
    }, CAMERA_EXIT_AFTER_CAPTURE_MS);
  }

  cameraModePressAt = 0;
}