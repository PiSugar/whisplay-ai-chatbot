# Integrate LLM8850 Local Services

This section explains how to set up and integrate the LLM8850 local services (Whisper ASR, Melotts TTS, and Qwen3 LLM API) with the Whisplay AI Chatbot.
I did some modifications on the LLM8850 demo project to make it easier to integrate with the Whisplay AI Chatbot.

### LLM8850 Whisper ASR

The [demo project](https://github.com/ml-inory/whisper.axcl) provides a local whisper ASR running on LLM8850. However, it's a one-time use command line tool, which will take about 8 seconds to initialize the model each time.
I modified the code to run a local web service for ASR, so the model is loaded only once. And it takes less than one second to process each sentence after that.

Check out this link: https://github.com/PiSugar/whisper.axcl

Plese follow the instructions in the README file to set up the LLM8850 whisper service. After that, you can set the `LLM8850_WHISPER_HOST` variable in the `.env` file to point to your LLM8850 whisper service.

### LLM8850 Melotts TTS

The [demo project](https://github.com/ml-inory/melotts.axcl) provides a local melotts TTS running on LLM8850. It has the same issue as the whisper demo project.
I also did similar modifications to run a local web service for TTS.

Check out this link: https://github.com/PiSugar/melotts.axcl

Please follow the instructions in the README file to set up the LLM8850 melotts TTS service. After that, you can set the `LLM8850_MELOTTS_HOST` variable in the `.env` file to point to your LLM8850 melotts TTS service.

### LLM8850 Qwen3 LLM API

Follow the instructions of the [official document](https://docs.m5stack.com/en/guide/ai_accelerator/llm-8850/m5_llm_8850_qwen3_1.7b) to set up the Qwen3:1.7b LLM project.

Since the project should be run on two separate parts: model api server and tokenizer server, I created a simple script to start both servers easily, and also a startup script to run the servers on system boot.

Create a `serve.sh` to the project folder with the following content:

```bash
#!/bin/bash
PORT=12300

working_dir=$(pwd)
cd $working_dir

echo "Working directory: $working_dir"

echo "Starting tokenizer server on port $PORT..."
# Start the tokenizer server in the background
python qwen3_tokenizer_uid.py --port $PORT &

# tokenizer server startup time
sleep 8

echo "Starting main API application..."

# Run the main API application
./main_api_axcl_aarch64 \
--system_prompt "You are Qwen, created by Alibaba Cloud. You are a helpful assistant." \
--template_filename_axmodel "qwen3-1.7b-ax650/qwen3_p128_l%d_together.axmodel" \
--axmodel_num 28 \
--url_tokenizer_model "http://127.0.0.1:$PORT" \
--filename_post_axmodel qwen3-1.7b-ax650/qwen3_post.axmodel \
--filename_tokens_embed qwen3-1.7b-ax650/model.embed_tokens.weight.bfloat16.bin \
--tokens_embed_num 151936 \
--tokens_embed_size 2048 \
--use_mmap_load_embed 1 \
--devices 0

# exit the script

# After the main application exits, kill the tokenizer server
pkill -f "python qwen3_tokenizer_uid.py --port $PORT"
exit 0
```

Also create a `startup.sh` script with the following content:

```bash
#!/bin/bash

# set the serve.sh as systemctl service

echo "Setting up startup service..."

# Create the service file
WORKDIR=$(pwd)
SERVICE_NAME="qwen3"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

echo "[Service]
Environment="PATH=/usr/local/bin:/usr/bin:/bin:/home/pi/.local/bin"
[Unit]
Description=Qwen3 Service
After=network.target
[Service]
User=pi
Type=simple
WorkingDirectory=$WORKDIR
ExecStart=bash $WORKDIR/serve.sh
Restart=on-failure
LogLevel=info
StandardOutput=append:$WORKDIR/server.log
StandardError=append:$WORKDIR/server-err.log

[Install]
WantedBy=multi-user.target" | sudo tee $SERVICE_FILE

# Reload systemd to recognize the new service
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME.service
sudo systemctl start $SERVICE_NAME.service
```

Then run the following command to set up the startup service:

```bash
sudo bash startup.sh
```

After setting up the service, you can set the `LLM8850_LLM_HOST` variable in the `.env` file to point to your LLM8850 Qwen3 LLM service.

### Environment Configuration

After setting up the three services above, you need to configure the environment variables in the `.env` file.

```
ASR_SERVER=llm8850_whisper
LLM_SERVER=llm8850_llm
TTS_SERVER=llm8850_melotts

# default settings for LLM8850 services, you can change them if needed
LLM8850_LLM_HOST=http://localhost:8000
LLM8850_LLM_TEMPERATURE=0.7
LLM8850_WHISPER_HOST=http://localhost:8801
LLM8850_MELOTTS_HOST=http://localhost:8802
```

### Note

The services need some time to initialize when system boots up. Even when the screen shows that the chatbot is ready, the LLM8850 services may not be ready yet. So please wait for a while (about one minute) after system startup before talking to the chatbot.
