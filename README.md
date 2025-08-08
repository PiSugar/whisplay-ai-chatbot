# Whisplay-AI-Chatbot

<img src="https://docs.pisugar.com/img/whisplay_logo@4x-8.png" alt="Whisplay AI Chatbot" width="200" />

This is a pocket-sized AI chatbot device built using a Raspberry Pi Zero 2w. Just press the button, speak, and it talks back—like a futuristic walkie-talkie with a mind of its own.

Test Video:
[https://www.youtube.com/watch?v=lOVA0Gui-4Q](https://www.youtube.com/playlist?list=PLpTS9YM-tG_mW5H7Xs2EO0qvlAI-Jm1e_)

## Hardware

- Raspberry Pi zero 2w
- PiSugar Whisplay HAT (including LCD screen, on-board speaker and microphone)
- PiSugar 3 1200mAh

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
   ```
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

## Build After Code Changes

If you make changes to the code, you need to rebuild the project. You can do this by running:

```bash
yarn
yarn build
```

## Update Environment Variables

If you need to update the environment variables, you can edit the `.env` file directly. After making changes, please run `yarn copy-env` to copy the updated environment variables to `dist/.env`. Then, restart the chatbot service with:

```bash
systemctl restart whisplay-ai-chatbot.service
```

## Display Battery Level

The battery level display depends on the pisugar-power-manager. If you are using PiSugar2 or PiSugar3, you need to install the pisugar-power-manager first. You can find the installation instructions in the [PiSugar Power Manager repository](https://github.com/PiSugar/pisugar-power-manager-rs).

Or use the following command to install it:

```bash
wget https://cdn.pisugar.com/release/pisugar-power-manager.sh
bash pisugar-power-manager.sh -c release
```

## Enclosure

[Whisplay Chatbot Case](https://github.com/PiSugar/suit-cases/tree/main/pisugar3-whisplay-chatbot)

## Goals

- Integrate the tool with the API
- Enable the AI assistant to adjust the volume autonomously
- Reset the conversation history if there is no speech for five minutes
- Support speaker recognition
