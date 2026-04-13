# web-tbc

## Purpose
Temporary containment role for web-specific code that is clearly part of the web layer, but does not yet have a finalized canonical role.

Examples:
- browser DOM helpers
- browser route parsing
- web UI rendering helpers
- web view orchestration
- HTTP/web server glue that is clearly web-specific

## Rules
- Use only for code under `features/{feature}/infra/web/**`
- Do not use it for domain logic
- Do not use it for CLI code
- Replace it with a more specific generic web role later when approved
