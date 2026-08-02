# Jellyfin Control reference

This is the current reference snapshot of the Jellyfin Control service described in Part 3 of the homelab series. It coordinates scheduled library optimization, publishes job progress, refreshes Jellyfin, and selects Intel QSV, VA-API, or software encoding only after a small encoder smoke test.

The article describes the earlier Raspberry Pi setup, where software transcoding was deliberately moved into an overnight window. This snapshot has since evolved for the HP ProDesk migration, while retaining software fallback.

The main paths are:

- `jellyfin-control.py`: dashboard, schedule, job status, progress, start/stop, and logs.
- `scripts/jellyfin-master.sh`: scheduled pipeline across shows, movies, and UHD movies.
- `scripts/jellyfin-optimize-*.py`: video, audio, and subtitle compatibility checks plus conversion work.
- `scripts/transcode_backend.py`: QSV, VA-API, and software backend selection.
- `scripts/jellyfin-scheduled-run.sh`: active-window check and scheduled start.

This is a reference implementation, not a drop-in Compose stack. Review every path, group ID, device mapping, codec policy, and Jellyfin URL before using it. The supplied Compose file mounts the Docker socket and uses host PID visibility; both grant powerful host access and should be narrowed for a real deployment.
