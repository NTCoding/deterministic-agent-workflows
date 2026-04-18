#!/usr/bin/env bash
# Build and run the deterministic-agent-workflows control center.
#
# Usage:
#   ./start-ui.sh                 # default db (~/.workflow-events.db), port 3120
#   ./start-ui.sh --db <path>     # custom db path
#   ./start-ui.sh --port <n>      # custom port
#   ./start-ui.sh --open          # open the browser on start
#   ./start-ui.sh --skip-build    # reuse existing dist/ui (fast restart)
#
# Any flags not listed above are forwarded to the server CLI.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$REPO_ROOT/apps/deterministic-agent-workflows-control-center"

SKIP_BUILD=0
SERVER_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--skip-build" ]]; then
    SKIP_BUILD=1
  else
    SERVER_ARGS+=("$arg")
  fi
done

cd "$REPO_ROOT"

if [[ ! -d node_modules ]]; then
  echo "==> Installing dependencies (pnpm install)"
  pnpm install
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> Building UI (esbuild)"
  (cd "$APP_DIR" && node build-ui.mjs)
else
  echo "==> Skipping UI build (--skip-build)"
  if [[ ! -f "$APP_DIR/dist/ui/index.html" ]]; then
    echo "ERROR: dist/ui/index.html missing — run without --skip-build first." >&2
    exit 1
  fi
fi

echo "==> Starting server"
exec pnpm --dir "$APP_DIR" exec tsx "$APP_DIR/src/shell/main.ts" ${SERVER_ARGS[@]+"${SERVER_ARGS[@]}"}
