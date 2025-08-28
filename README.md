# MCAP Data Recovery System

Web application for recovering MCAP files using the MCAP CLI tool.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   pip install mcap-cli
   ```

2. **Create `.env.local`**
   ```bash
   BASE_DIR=/path/to/your/mcap/files
   SCRIPT_PATH=/path/to/your/mcap_recover.sh
   ```

3. **Make script executable**
   ```bash
   chmod +x /path/to/your/mcap_recover.sh
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open** [http://localhost:3000](http://localhost:3000)

## Production

```bash
npm run build
npm start
```

## How It Works

1. User selects MCAP files from web interface
2. Files are copied to temporary workspace
3. `mcap_recover.sh` script processes files
4. Recovered files are zipped and downloaded
5. Temporary workspace is cleaned up

## Troubleshooting

- **"Recovery script failed"**: Check `mcap-cli` installation and script permissions
- **"No .mcap files found"**: Verify `BASE_DIR` path and file existence
- **"Permission denied"**: Ensure script has execute permissions (`chmod +x`)
