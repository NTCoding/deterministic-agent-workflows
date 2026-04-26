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
- Events excluded from default workflow-state reconstruction are platform internals.
- If consumers need a platform event, the platform must expose it as a first-class event instead of forcing consumers to redefine it.
- New platform events must default to being exposed for consumer use unless they are clearly platform-internal only.
