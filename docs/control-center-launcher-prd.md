# Control Center launcher

## Problem

Starting the Control Center requires remembering separate UI build and server commands.

## Requirements

- The repository root provides `start-ui.sh` as the everyday launcher.
- It builds and starts the Control Center, then opens the browser.
- The default event database is `~/ai-workflow-database/.workflow-events.db`.
- `WORKFLOW_EVENTS_DB` may override the event database.
- `WORKFLOW_UI_PORT` may override the default port of `3120`.
