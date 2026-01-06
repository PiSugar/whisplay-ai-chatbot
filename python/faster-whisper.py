import base64
import time
import tempfile
import os
from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import argparse
import signal
import sys

# ---------- Configuration ----------
MODEL_NAME = "tiny"      # tiny / base
DEVICE = "cpu"
COMPUTE_TYPE = "int8"    # Pi must use int8

# ---------- Initialization ----------
app = Flask(__name__)

t0 = time.perf_counter()
print("[INIT] Loading whisper model...")
model = WhisperModel(
  MODEL_NAME,
  device=DEVICE,
  cpu_threads=3,   # Limit CPU threads for Pi
  compute_type=COMPUTE_TYPE,
)
t1 = time.perf_counter()
print(f"[INIT] Model loaded in {round(t1 - t0, 2)} seconds")


# ---------- Utility Functions ----------
def save_base64_to_temp_file(b64: str):
  """Save base64 audio to a temporary file and return its path"""
  try:
    audio_bytes = base64.b64decode(b64)
    # Create temporary file
    fd, temp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)  # Close file descriptor
    
    # Write to file
    with open(temp_path, 'wb') as f:
      f.write(audio_bytes)
    
    return temp_path
  except Exception as e:
    raise ValueError(f"Failed to save base64 to temp file: {e}")

# ---------- API ----------
@app.route("/recognize", methods=["POST"])
def recognize():
  data = request.get_json(force=True, silent=True)
  if not data:
    return jsonify({"error": "Invalid JSON"}), 400

  file_path = data.get("filePath")
  b64_audio = data.get("base64")
  language = data.get("language")

  if not file_path and not b64_audio:
    return jsonify({
      "error": "Either filePath or base64 must be provided"
    }), 400

  temp_file = None
  try:
    t0 = time.perf_counter()

    # 1. Determine audio file path
    if file_path:
      audio_path = file_path
    else:
      # Convert base64 to temporary file
      temp_file = save_base64_to_temp_file(b64_audio)
      audio_path = temp_file

    # 2. Transcribe using file path
    segments, info = model.transcribe(
      audio_path,
      language=language,
      vad_filter=True
    )

    text = "".join(seg.text for seg in segments).strip()

    t1 = time.perf_counter()

    return jsonify({
      "recognition": text,
      "language": info.language,
      "time_cost": round(t1 - t0, 3)
    })

  except Exception as e:
    return jsonify({"error": str(e)}), 500
  
  finally:
    # Clean up temporary file
    if temp_file and os.path.exists(temp_file):
      try:
        os.remove(temp_file)
      except:
        pass

def shutdown(sig, frame):
    print("Shutting down python server...")
    sys.exit(0)

# ---------- Startup ----------
if __name__ == "__main__":
  parser = argparse.ArgumentParser(description='Faster Whisper API Server')
  parser.add_argument('--port', type=int, default=8000, help='Port to run the server on')
  args = parser.parse_args()
  
  signal.signal(signal.SIGTERM, shutdown)
  signal.signal(signal.SIGINT, shutdown)
  
  print(f"[STARTING] Starting Faster Whisper server on port {args.port}...")
  
  app.run(
    host="0.0.0.0",
    port=args.port,
    threaded=False  # Very important on Pi
  )