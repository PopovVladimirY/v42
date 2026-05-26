#!/bin/sh
# V.42 Offline Installer
# Loads pre-built Docker images from the package, then guides you through
# .env configuration. Run once before first docker compose up.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGES_DIR="$SCRIPT_DIR/images"

echo "==================================================================="
echo " V.42 Offline Installer"
echo "==================================================================="
echo ""

# ----------------------------------------------------------------
# Sanity checks
# ----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker is not installed or not in PATH."
    echo "Install Docker Desktop from https://docs.docker.com/get-docker/"
    exit 1
fi

if [ ! -d "$IMAGES_DIR" ]; then
    echo "ERROR: images/ directory not found next to install.sh"
    echo "Make sure you extracted the full package and run from its root."
    exit 1
fi

# ----------------------------------------------------------------
# Step 1: Load Docker images
# ----------------------------------------------------------------
echo "[1/2] Loading Docker images..."
echo ""

LOADED=0
for img in "$IMAGES_DIR"/*.tar.gz; do
    [ -f "$img" ] || continue
    printf "      %-40s" "$(basename "$img")..."
    docker load -i "$img" > /dev/null 2>&1
    echo "OK"
    LOADED=$((LOADED + 1))
done

if [ "$LOADED" -eq 0 ]; then
    echo "ERROR: No *.tar.gz files found in images/"
    exit 1
fi

echo ""
echo "      $LOADED image(s) loaded."
echo ""

# ----------------------------------------------------------------
# Step 2: Environment setup
# ----------------------------------------------------------------
echo "[2/2] Environment setup..."
echo ""

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.dist" "$SCRIPT_DIR/.env"

    echo "==================================================================="
    echo " ACTION REQUIRED: configure .env before starting"
    echo "==================================================================="
    echo ""
    echo "  Secrets to set in .env:"
    echo ""
    echo "    DB_PASSWORD          strong random password"
    echo "                         e.g.  openssl rand -base64 18"
    echo ""
    echo "    JWT_SECRET           32+ char hex string"
    echo "                         e.g.  openssl rand -hex 32"
    echo ""
    echo "    SEED_ADMIN_EMAIL     admin login email"
    echo "    SEED_ADMIN_PASSWORD  temporary password (forced change on first login)"
    echo ""
    echo "  Optional -- change the port the app listens on (default 8042):"
    echo "    FRONTEND_PORT=8042"
    echo ""
    echo "  After editing .env, start the stack:"
    echo ""
    echo "    docker compose up -d"
    echo ""
    echo "  Then open http://localhost:8042 (or your FRONTEND_PORT)."
    echo ""
else
    echo "      .env already exists -- skipping template copy."
    echo ""
    echo "  Start the stack:"
    echo ""
    echo "    docker compose up -d"
    echo ""
fi

# ----------------------------------------------------------------
# MCP Server (AI agent integration)
# ----------------------------------------------------------------
echo "-------------------------------------------------------------------"
echo " MCP Server -- AI Agent integration"
echo "-------------------------------------------------------------------"
echo ""
echo "  bin/v42-mcp lets Claude Desktop (and any MCP-compatible client)"
echo "  read and write the V42 backlog, tasks, and tests directly."
echo ""
echo "  1. Get a V42 API token (log in -> Profile -> API Tokens)."
echo "  2. Add to your Claude Desktop config (~/.config/claude/claude_desktop_config.json):"
echo ""
echo '     {'
echo '       "mcpServers": {'
echo '         "v42": {'
echo '           "command": "'"$SCRIPT_DIR"'/bin/v42-mcp",'
echo '           "env": {'
echo '             "V42_API_URL":   "http://<your-host>:8042/api/v1",'
echo '             "V42_API_TOKEN": "<your-token>"'
echo '           }'
echo '         }'
echo '       }'
echo '     }'
echo ""
echo "-------------------------------------------------------------------"
echo ""
