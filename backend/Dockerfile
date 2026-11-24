FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg openssh-client tzdata libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY resets.py devices.py catalog.py media.py companions.py settings.py archive.py transfers.py offload.py remote_index.py incoming_cleanup.py uploads.py records.py api.py worker.py ./
