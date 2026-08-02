FROM jellyfin/jellyfin:10.11.6

WORKDIR /app

# Use Jellyfin's own tested FFmpeg and Intel userspace stack. This keeps offline
# conversion on the exact QSV runtime already proven by the live Jellyfin server.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip docker.io docker-compose && \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe && \
    ln -sf /usr/lib/jellyfin-ffmpeg/vainfo /usr/local/bin/vainfo && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages requests flask subliminal

COPY jellyfin-control.py .

EXPOSE 5050

ENTRYPOINT []
CMD ["python3", "jellyfin-control.py"]
