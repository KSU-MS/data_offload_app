# MCAP Data Recovery System

Web application for recovering MCAP files from the car and using the MCAP CLI to recover the mcap.

## Architecture

- **Frontend**: Next.js (Port 3000)
- **Backend**: Django (Port 8000)

## Development Setup

### Prerequisites
- Node.js & npm
- Python 3.10+ & uv (or pip)
- `mcap` CLI tool installed and accessible in PATH (e.g. `brew install mcap`)
- A directory with `.mcap` files

### 1. Backend (Django)

Navigate to the `backend` directory:

```bash
cd backend
```

Install dependencies using `uv`:

```bash
uv venv
source .venv/bin/activate
uv pip install -r pyproject.toml
```

Configure environment variables (optional, defaults provided):

```bash
export BASE_DIR=/path/to/mcap/files
```

Run the server:

```bash
python manage.py runserver 0.0.0.0:8000
```

### 2. Frontend (Next.js)

Navigate to the project root:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker Deployment

*Note: Docker setup needs updating for the split architecture (Django + Next.js).*

## Usage

1. Connect to the car's Wi‑Fi access point.
2. Open a browser to the car's IP on port 3000.
3. Select the unrecovered `.mcap` files you need from the list and start recovery.
