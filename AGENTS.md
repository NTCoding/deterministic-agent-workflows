# AGENTS

Bypassing lint rules and test coverage is forbidden. You are not allowed to modify lint or test coverage files. 

## Agent startup checklist

1. Read `plan.md` and continue with the next unfinished item.
2. Keep architecture boundaries and dependency directions from `plan.md` intact.
3. Prefer minimal, incremental changes.
4. Mark completed plan items as `DONE`.

## Platform event ownership

- Built-in platform features must persist platform-owned events in the platform itself.
- Consumers may query platform-owned events to rebuild their own state or projections.
- Consumers must never be required to declare, parse, append, or persist platform-owned events in `appendEvent(...)` for built-in platform features to work.
