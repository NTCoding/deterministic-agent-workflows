#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
database_path="${WORKFLOW_EVENTS_DB:-"$HOME/ai-workflow-database/.workflow-events.db"}"
port="${WORKFLOW_UI_PORT:-3120}"

if ! [[ "$port" =~ ^[0-9]+$ ]] || (( ${#port} > 5 || 10#$port > 65535 )); then
  printf 'WORKFLOW_UI_PORT must be an integer from 0 to 65535: %s\n' "$port" >&2
  exit 1
fi

port="$((10#$port))"
database_directory="$(dirname -- "$database_path")"
if ! database_directory="$(cd -- "$database_directory" 2>/dev/null && pwd)"; then
  printf 'Workflow events database not found: %s\n' "$database_path" >&2
  printf 'Start a workflow first, or set WORKFLOW_EVENTS_DB to an existing database.\n' >&2
  exit 1
fi
database_path="$database_directory/$(basename -- "$database_path")"

if [[ ! -f "$database_path" ]]; then
  printf 'Workflow events database not found: %s\n' "$database_path" >&2
  printf 'Start a workflow first, or set WORKFLOW_EVENTS_DB to an existing database.\n' >&2
  exit 1
fi

pnpm --dir "$repo_root" build
exec pnpm --dir "$repo_root" --filter deterministic-agent-workflows-control-center start -- --db "$database_path" --port "$port" --open
