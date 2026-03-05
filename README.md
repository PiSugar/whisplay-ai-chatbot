# Whisplay-AI-Chatbot

<img src="https://docs.pisugar.com/img/whisplay_logo@4x-8.png" alt="Whisplay AI Chatbot" width="200" />

This is a pocket-sized AI chatbot device built using a Raspberry Pi Zero 2w / 5. Just press the button, speak, and it talks back—like a futuristic walkie-talkie with a mind of its own.

Test Video Playlist:
[https://www.youtube.com/watch?v=lOVA0Gui-4Q](https://www.youtube.com/playlist?list=PLpTS9YM-tG_mW5H7Xs2EO0qvlAI-Jm1e_)

Tutorial:
[https://www.youtube.com/watch?v=Nwu2DruSuyI](https://www.youtube.com/watch?v=Nwu2DruSuyI)

Tutorial (offline version build on RPi 5):

[https://youtu.be/kFmhSTh167U](https://youtu.be/kFmhSTh167U)

[https://youtu.be/QNbHdJUW6z8](https://youtu.be/QNbHdJUW6z8)

[https://youtu.be/xGzvFzdBAwc](https://youtu.be/xGzvFzdBAwc)


## Hardware

- Raspberry Pi zero 2w (Recommand RRi 5, 8G RAM for offline build)
- PiSugar Whisplay HAT (including LCD screen, on-board speaker and microphone)
- PiSugar 3 1200mAh (Plus version 5000mAh for RPi 5)

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
   bash startup.sh
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

The env template may be updated from time to time. If you want to upgrade your existing `.env` file based on the latest `.env.template`, you can run the following command:

```bash
bash upgrade-env.sh
```

## Update Environment Variables

If you need to update the environment variables, you can edit the `.env` file directly. After making changes, please restart the chatbot service with:

```bash
sudo systemctl restart chatbot.service
```

## More Features

**[Wake Word](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/Wakeword)** for hands-free interaction.

**[Image Generation](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/Image-Generation)** for generating images from text prompts.

**[Battery Level Display](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/Battery-Level-Display)** for installation instructions.

**[Data Folder](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/Data-Folder)** for details on sub-folder layout and cleanup options.

## Enclosure

[Whisplay Chatbot Case for Pi02](https://github.com/PiSugar/suit-cases/tree/main/pisugar3-whisplay-chatbot)

[Whisplay Chatbot Case (FDM) for Pi02](https://github.com/PiSugar/suit-cases/tree/main/pisugar3-whisplay-chatbot-fdm)

[Whisplay Chatbot Case (FDM) for Pi5](https://github.com/PiSugar/suit-cases/tree/main/pi5-whisplay-chatbot)

[Whisplay Chatbot Case (FDM) for Pi5 & LLM8850](https://github.com/PiSugar/suit-cases/tree/main/pi5-whisplay-chatbot-llm8850)

## AI Accelerator Card Support

[LLM8850](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/LLM8850-Integration)

[Raspberry Pi AI HAT+ 2 (Hailo-10H)](https://github.com/PiSugar/whisplay-ai-chatbot/wiki/Raspberry-Pi-AI-HAT+-2)

## Goals

- Support LLM8850 whisper ✅
- Support LLM8850 melottsTTS ✅
- Support LLM8850 Qwen3 llm api (not support tool) ✅
- Support LLM8850 Qwen3-VL multimodal llm api (not support tool) ✅ 
- Support LLM8850 image generation ✅
- Suppprt Raspberry Pi AI Hat+2 (Hailo-10H) whisper, llm, vlm ✅
- Support speaker recognition

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=PiSugar/whisplay-ai-chatbot&type=date&legend=bottom-right)](https://www.star-history.com/#PiSugar/whisplay-ai-chatbot&type=date&legend=bottom-right)

## License

[GPL-3.0](https://github.com/PiSugar/whisplay-ai-chatbot?tab=GPL-3.0-1-ov-file#readme)
