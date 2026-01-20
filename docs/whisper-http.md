# ASR - whisper-http

To make whisper serving faster and more reliable, I have created a simple HTTP server wrapper around OpenAI's Whisper ASR model. The code can be found in the `python/speech-service/whisper-http-host.py`.

To use the whisper-http ASR service with the Whisplay AI Chatbot, You need to setup whisper on your device first.

### Install whisper

You can install whisper using pip:

```bash
pip install -U openai-whisper --break-system-packages
```

After installation, you need to download the Whisper model (e.g., "tiny") to the cache directory.

```bash
echo "import whisper; model = whisper.load_model('tiny'); print('Model downloaded.')" | python3
```

The model files will be downloaded to a path like `/home/pi/.cache/whisper/tiny.pt`.

To ensure a completely offline setup, I recommend using the local path in chatbot configuration to make sure the device runs locally without trying to access the internet.

### Python Server

There is a simple Python server script to expose the Whisper ASR model as a local HTTP service. The server will run along with the AI Chatbot application if it serves at `localhost`, `127.0.0.1` or `0.0.0.0`.

If you are using a different device for ASR, you need to run the server script `python/speech-service/whisper-http-host.py` on that device and make sure the AI Chatbot can access it over the network.

### Configure Whisplay AI Chatbot to use whisper-http

`.env` file settings:

```bash
ASR_SERVER=whisper-http

## Whisper ASR & Whisper HTTP Server
# Whisper is an open-source ASR engine that can run locally on your device, whisper-http is a lightweight HTTP server wrapper for whisper
# https://github.com/openai/whisper
# the default model size is tiny, you can also choose other model sizes: tiny, base, small, medium, large. The tiny model will take ~1GB of VRAM
# the downloaded models will be stored in ~/.cache/whisper by default, if you want to use http server in offline mode, you can also specify a local model checkpoint path here to ensure the model is loaded from local disk directly.

WHISPER_MODEL_SIZE_OR_PATH=/home/pi/.cache/whisper/tiny.pt

# the default language is English, if you leave it empty, whisper will try to detect the language automatically, but it will take more time.
WHISPER_LANGUAGE=English

# the default port for whisper-http server is host at localhost:8804, you can change it if you are running remote whisper server
WHISPER_PORT=8804
WHISPER_HOST=localhost

# the default request type is filePath, you can also choose "base64" to send audio data in base64 format, it should be set to "base64" if you are using remote whisper server
# WHISPER_REQUEST_TYPE=filePath
```

