FROM python:3.12-bookworm

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update && apt-get install -y ca-certificates

RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources
# Base dependencies + ffmpeg (for transcoding/reading various audio formats)
RUN apt-get update && apt-get install -y --no-install-recommends \
curl \
&& rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /app/requirements.txt
COPY download-model.sh /app/download-model.sh
RUN pip3 install --no-cache-dir -r /app/requirements.txt --break-system-packages

ARG MODEL_SIZE=tiny

# trigger model download
RUN /bin/bash /app/download-model.sh "$MODEL_SIZE"

# Copy service code
COPY faster-whisper-host.py /app/server.py

# Default port
EXPOSE 8803

CMD ["python3", "/app/server.py"]