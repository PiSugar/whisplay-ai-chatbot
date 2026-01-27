#!/bin/bash

# accept model size from first arg or environment variable MODEL_SIZE, default to "tiny"
MODEL_SIZE="${1:-${MODEL_SIZE:-tiny}}"

# test if huggingface.hub is reachable
if curl --output /dev/null --silent --head --fail "https://huggingface.co"; then
  echo "Huggingface is reachable."
else
  echo "Huggingface is not reachable. Use mirror endpoint."
  export HF_ENDPOINT="https://hf-mirror.com"
fi

# trigger model download
echo "Downloading model size: $MODEL_SIZE"
python3 -c "import faster_whisper; model = faster_whisper.WhisperModel('$MODEL_SIZE'); print('Model downloaded.')"

# find the model cache directory in the path below, find the hash folder
# /root/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/

MODEL_CACHE_DIR="/root/.cache/huggingface/hub/models--Systran--faster-whisper-$MODEL_SIZE/snapshots"

if [ -d "$MODEL_CACHE_DIR" ]; then
  HASH_DIR=$(ls "$MODEL_CACHE_DIR" | head -n 1)
  FULL_MODEL_PATH="$MODEL_CACHE_DIR/$HASH_DIR"
  echo "Model cached at: $FULL_MODEL_PATH"
else
  echo "Model cache directory not found."
fi

# save the full path to a file
echo "$FULL_MODEL_PATH" > model_path.txt



