# TTS - piper-http

Piper is offical supported running as a local HTTP service. Comparing to using piper in command line mode, the HTTP server mode is more efficient and faster since it avoids the repeated model loading time for every TTS request.

More details can be found in the [piper-tts GitHub repository](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md)

### Install piper and web server

You can install using pip:

```bash
pip install -U piper-tts piper-tts[http] --break-system-packages
```

Download a voice, for example, the "en_US-amy-medium" voice:

```bash

mkdir -p ~/piper
cd ~/piper
python3 -m piper.download_voices en_US-amy-medium
```

The model path will be saved in piper's web server, so you don't need to specify the model path in the chatbot configuration.

### Run piper HTTP server

```bash
python3 -m piper.http_server -m en_US-amy-medium -p 8805
```

use another terminal to test the server:

```bash
curl -X POST -H 'Content-Type: application/json' -d '{ "text": "This is a test." }' -o test.wav localhost:8805
```

You should hear the TTS audio in `test.wav`.

```bash
aplay test.wav
```

### Configure AI Chatbot to use piper-http

`.env` file settings:

```bash
TTS_SERVER=piper-http

## Piper HTTP TTS
# if you are using piper-http as TTS server, the server will be hosted at localhost:8805 by default
# installation command: `python3 -m pip install piper-tts[http] --break-system-packages`

# PIPER_HTTP_HOST=localhost
# PIPER_HTTP_PORT=8805

# specify the voice model to use, you should download it beforehand, use this command to download a model: `python3 -m piper.download_voices en_US-amy-medium`

PIPER_HTTP_MODEL=en_US-amy-medium

# specify the speech speed, default is 1. The larger the value, the slower the speech.

PIPER_HTTP_LENGTH_SCALE=1
```