FROM python:3.12-bookworm

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update && apt-get install -y ca-certificates

RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources
# Base dependencies + ffmpeg (for transcoding/reading various audio formats)
RUN apt-get update && apt-get install -y --no-install-recommends \
curl \
&& rm -rf /var/lib/apt/lists/*

# Install piper and piper[http]
RUN pip3 install --no-cache-dir piper-tts piper-tts[http] --break-system-packages

ARG VOICE_NAME=en_US-amy-medium
# ARG HTTPS_PROXY

ENV HTTPS_PROXY=${HTTPS_PROXY}
# download voice
RUN python3 -m piper.download_voices $VOICE_NAME
# save voice name to file /app/voice_name.txt
RUN echo $VOICE_NAME > /app/voice_name.txt

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Default port
EXPOSE 8805

CMD ["bash", "/app/start.sh"]