# ASR - faster-whisper

Faster-whisper is a fast implementation of OpenAI's Whisper ASR model, using CTranslate2 for acceleration. More details can be found in the [faster-whisper GitHub repository](https://github.com/SYSTRAN/faster-whisper)

This section explains how to set up and integrate the faster-whisper as a local ASR service with the Whisplay AI Chatbot.

### Install faster-whisper

You can install faster-whisper using pip:

```bash
pip install -U faster-whisper --break-system-packages
```

After installation, you need to download the Whisper model (e.g., "tiny") to the cache directory.

```bash
echo "from faster_whisper import WhisperModel; model = WhisperModel('tiny', device='cpu'); print('Model downloaded.')" | python3
```

After running the above command, the model files will be downloaded to folder like `/home/pi/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356`.

**Important**: Since faster-whisper uses the HuggingFace model hub, it needs network access to check if there are updates to the model files at every boot. To make a completely offline setup, you need to use the local path to make sure the device runs locally without trying to access the internet.

### Python Server

There is a simple Python server script to expose the faster-whisper ASR model as a local HTTP service. The server will run along with the AI Chatbot application if it serves at `localhost`, `127.0.0.1` or `0.0.0.0`.

If you are using a different device for ASR, you need to run the server script `python/speech-service/faster-whisper-server.py` on that device and make sure the AI Chatbot can access it over the network. 

### Configure Whisplay AI Chatbot to use faster-whisper

`.env` file settings:

```bash
ASR_SERVER=faster-whisper

## Faster Whisper ASR
# By default, faster-whisper ASR server will be hosted at localhost:8803, change the following environment variables if you are running the server at somewhere else.
# FASTER_WHISPER_REQUEST_TYPE should be set to "base64" if you are using remote faster-whisper server.

FASTER_WHISPER_PORT=8803
FASTER_WHISPER_HOST=localhost
# FASTER_WHISPER_REQUEST_TYPE=filePath

# the default model size is tiny, you can also choose other model sizes: tiny, base, small, medium, large. (It will validate the model from huggingface if you just provide a size name)
# Or you can specify a local model directory path if you want it fully offline. The path should contain the model files like: model.bin, config.json, etc.

FASTER_WHISPER_MODEL_SIZE_OR_PATH=/home/pi/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots/d90ca5fe260221311c53c58e660288d3deb8d356

# the default language is en (English), if you leave it empty, faster-whisper will try to detect the language automatically, but it will take more time.

FASTER_WHISPER_LANGUAGE=en
```

