# Zipformer offline ASR

Install sherpa-onnx in a dedicated environment on the Pi and download the
[streaming English Zipformer model](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2).
Extract the archive to a directory on the Pi. The model directory needs
`tokens.txt` and one encoder, decoder, and joiner ONNX file per precision.
Zipformer selects the INT8 file for each component when available.

```bash
python3 -m venv --system-site-packages "$HOME/.venvs/whisplay-zipformer"
"$HOME/.venvs/whisplay-zipformer/bin/python" -m pip install sherpa-onnx==1.13.8 numpy
```

Set these values in `.env`, using the actual absolute paths on your Pi.
In `whisplay configure`, select `zipformer` under **Core → ASR_SERVER** and
set the three Zipformer settings under **Local Providers → Zipformer ASR**.

```dotenv
ASR_SERVER=zipformer
ZIPFORMER_MODEL_DIR=/home/pi/models/sherpa-onnx-streaming-zipformer-en-2023-06-26
ZIPFORMER_PYTHON_PATH=/home/pi/.venvs/whisplay-zipformer/bin/python
ZIPFORMER_THREADS=2
```

Restart the chatbot using its usual launcher. For a service-managed installation,
run `whisplay service restart`. The local microphone shows interim subtitles
during push-to-talk. Releasing the button submits the final transcript.
Wake-word and browser microphone input use complete recordings, as does fallback
when a live stream fails. The selected ASR uses the local model for all three
paths. To switch back, set `ASR_SERVER=faster-whisper` and restart.
