# Whisplay-AI-Chatbot

<img src="https://docs.pisugar.com/img/whisplay_logo@4x-8.png" alt="Whisplay AI Chatbot" width="200" />

This is a pocket-sized AI chatbot device built using a Raspberry Pi Zero 2w. Just press the button, speak, and it talks back—like a futuristic walkie-talkie with a mind of its own.

Test Video Playlist:
[https://www.youtube.com/watch?v=lOVA0Gui-4Q](https://www.youtube.com/playlist?list=PLpTS9YM-tG_mW5H7Xs2EO0qvlAI-Jm1e_)

Tutorial:
[https://www.youtube.com/watch?v=Nwu2DruSuyI](https://www.youtube.com/watch?v=Nwu2DruSuyI)

Tutorial 2 (offline version build on RPi 5):
[https://www.youtube.com/watch?v=kFmhSTh167U](https://www.youtube.com/watch?v=kFmhSTh167U)

## Hardware

- Raspberry Pi zero 2w (Recommand RRi 5, 8G RAM for offline build)
- PiSugar Whisplay HAT (including LCD screen, on-board speaker and microphone)
- PiSugar 3 1200mAh

## Pre-build Image

- Please find the pre-build images in project wiki: https://github.com/PiSugar/whisplay-ai-chatbot/wiki

## Drivers

You need to firstly install the audio drivers for the Whisplay HAT. Follow the instructions in the [Whisplay HAT repository](https://github.com/PiSugar/whisplay).

## Installation Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/PiSugar/whisplay-ai-chatbot.git
   cd whisplay-ai-chatbot
   ```
2. Install dependencies:
   ```bash
   bash install_dependencies.sh
   source ~/.bashrc
   ```
   Running `source ~/.bashrc` is necessary to load the new environment variables.
3. Create a `.env` file based on the `.env.template` file and fill in the necessary environment variables.
4. Build the project:
   ```bash
   bash build.sh
   ```
5. Start the chatbot service:
   ```bash
   bash run_chatbot.sh
   ```
6. Optionally, set up the chatbot service to start on boot:
   ```bash
   sudo bash startup.sh
   ```
   Please note that this will disable the graphical interface and set the system to multi-user mode, which is suitable for headless operation.
   You can find the output logs at `chatbot.log`. Running `tail -f chatbot.log` will also display the logs in real-time.

## Build After Code Changes

If you make changes to the node code or just pull the new code from this repository, you need to rebuild the project. You can do this by running:

```bash
bash build.sh
```

If If you encounter `ModuleNotFoundError` or there's new third-party libraries to the python code, please run the following command to update the dependencies for python:
```
cd python
pip install -r requirements.txt --break-system-packages
```

## Update Environment Variables

If you need to update the environment variables, you can edit the `.env` file directly. After making changes, please restart the chatbot service with:

```bash
systemctl restart whisplay-ai-chatbot.service
```

## Image Generation

You can enable image generation by setting the `IMAGE_GENERATION_SERVER` variable in the `.env` file. Options include: OPENAI, GEMINI, VOLCENGINE.

Then you can use prompts like "A children's book drawing of a veterinarian using a stethoscope to listen to the heartbeat of a baby otter." to generate images.

The generated images will be displayed on the screen and saved in the `data/images` folder.

## Display Battery Level

The battery level display depends on the pisugar-power-manager. If you are using PiSugar2 or PiSugar3, you need to install the pisugar-power-manager first. You can find the installation instructions in the [PiSugar Power Manager repository](https://github.com/PiSugar/pisugar-power-manager-rs).

Or use the following command to install it:

```bash
wget https://cdn.pisugar.com/release/pisugar-power-manager.sh
bash pisugar-power-manager.sh -c release
```

## Data Folder

The chatbot saves conversation history and generated images in the `data` folder. It's a temporal folder and can be deleted if you want to clear the history.

## Enclosure

[Whisplay Chatbot Case for Pi02](https://github.com/PiSugar/suit-cases/tree/main/pisugar3-whisplay-chatbot)

[Whisplay Chatbot Case (FDM) for Pi02](https://github.com/PiSugar/suit-cases/tree/main/pisugar3-whisplay-chatbot-fdm)

[Whisplay Chatbot Case (FDM) for Pi5](https://github.com/PiSugar/suit-cases/tree/main/pi5-whisplay-chatbot)

## LLM8850 Support

If you have a LLM8850 AI Accelerator, you can set up the LLM8850 services for local ASR, TTS, and LLM API to enable offline capabilities.

Please refer to the [LLM8850 Integration Guide](README-llm8850.md) for detailed setup instructions.

## Goals

- Integrate the tool with the API ✅
- Enable the AI assistant to adjust the volume autonomously ✅
- Reset the conversation history if there is no speech for five minutes ✅
- Support local llm server ✅
- Support local asr (whisper/vosk) ✅
- Support local tts (piper) ✅
- Support image generation (openai/gemini/volcengine) ✅
- Refactor python render thread, better performance ✅
- Add Google Gemini API support ✅
- Add Grok API support ✅
- RPI camera support ✅
- Support LLM8850 whisper ✅
- Support LLM8850 melottsTTS ✅
- Support LLM8850 Qwen3 llm api (not support tool) ✅
- Support LLM8850 SmolVLM2
- Support speaker recognition

## License

[GPL-3.0](https://github.com/PiSugar/whisplay-ai-chatbot?tab=GPL-3.0-1-ov-file#readme)
