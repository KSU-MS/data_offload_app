# MCAP Data Recovery System

Web application for recovering MCAP files from the car and using a shell script that invokes the MCAP CLI to recover the mcap.

## Docker Deployment (Linux/Raspberry Pi)

**Optimized for Raspberry Pi with 2GB RAM**

1. Set the host path to your unrecovered `.mcap` files in `docker-compose.yml`:
   ```yaml
   volumes:
     - /home/youruser/mcap_logs:/recordings:ro
     - ./mcap_recover:/recordings/mcap_recover.sh:ro
   ```
   - Replace `/home/youruser/mcap_logs` with the folder on your Linux host containing unrecovered `.mcap` files.
   - Inside the container the app reads from `/recordings` and runs the script at `/recordings/mcap_recover.sh`.

2. Build and run:
   ```bash
   docker compose up -d --build
   ```

3. Open the app:
   ```
   http://localhost:3000
   # Or on Pi: http://<pi-ip>:3000
   ```

**Prerequisites:**
- MCAP CLI must be installed on the host system (e.g., `/usr/local/bin/mcap`)
- Docker will mount the host's `mcap` binary into the container

**Pi Memory Optimization:**
- Node.js memory limit set to 1GB (suitable for 2GB Pi)
- Streaming ZIP creation (memory efficient)
- Optimized garbage collection settings

## Usage

1. Connect to the car's Wi‑Fi access point.
2. Open a browser to the car's IP on port 3000 (e.g., `http://<car-ip>:3000`).
3. Select the Files you need to download from car.

## How It Works

- The API reads file listings from `BASE_DIR` (set to `/recordings`).
- Selected files are copied into a temporary workspace inside the container.
- The recovery script is invoked via `sh /recordings/mcap_recover.sh <temp_dir>`.
- Recovered files are zipped and returned for download.
- The temporary workspace is removed after completion.

## Configuration

Environment variables (already set in `docker-compose.yml`):
- `BASE_DIR=/recordings` (do not change unless you also change the volume target)
- `SCRIPT_PATH=/recordings/mcap_recover.sh`

To change the in-container path, update both the `environment` values and the `volumes` target so they match.

## Troubleshooting

- **No files visible**: verify your host path on the left side of the volume mapping contains `.mcap` files and is readable.
- **Script errors**: ensure `./mcap_recover` exists in the project. The API runs it via `sh`, so it does not require the executable bit on the host.
- **Memory errors on Pi**: the app uses streaming ZIP creation and 1GB Node.js memory limit optimized for 2GB Pi RAM.
- **Different host path**: update the left side of the volume mapping to your desired folder, for example `/data/logs:/recordings:ro`.
- **Pi performance**: for better performance, consider using a Pi 4 with 4GB+ RAM or limit file selection to smaller batches.
