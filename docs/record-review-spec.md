# Record Review Platform Capability Specification

## Goal

Make review a first-class platform capability. Workflow consumers record structured review results through the platform instead of defining workflow-specific review commands and ad hoc persistence.

The first consumer is `living-architecture`. The implementation must preserve its current workflow behavior while adding durable review data for Control Center and future workflow optimisation.

## User outcomes

### Failed review diagnosis

A user opens Control Center for a session and sees that the workflow took one hour because review failed twice. The user can open the Reviews view and see:

- which review types failed
- which attempts failed
- failure summaries
- blocking findings
- affected files and line ranges when supplied
- the later passing attempt that allowed the workflow to proceed

### Pull request review audit

A user reviewing a pull request finds bad code or missing functionality. The user can search Control Center by repository, branch, pull request, review type, and verdict to answer:

- whether the issue was flagged during workflow review
- whether the reviewer signed off without flagging it
- whether a finding was recorded as non-blocking or accepted risk
- which reviewer type recorded the decision
- which workflow session produced the decision

## Scope

### In scope

- Platform built-in `record-review` command.
- Structured review persistence in the workflow database.
- Workflow event recording so consumers can drive state gates from review results.
- Control Center session Reviews UI.
- Control Center cross-session Reviews UI with database-backed simulated data for the platform PR.
- Migration path for `living-architecture` from custom review commands to `record-review`.

### Out of scope

- Parsing markdown review reports.
- Requiring agents to write review report files.
- External GitHub review ingestion beyond storing supplied pull request metadata.
- Human approval workflows for accepting or rejecting review findings after review has been recorded.

## Platform boundary rule

The platform must not hard-code `living-architecture` review types, gates, state fields, or transition rules.

`reviewType` is an arbitrary non-empty consumer-defined string. The platform records it, indexes it, filters it, and displays it. The platform does not interpret it.

Workflow-specific state changes are owned by the consumer workflow fold. For example, `living-architecture` may map `reviewType: "code-review"` to `codeReviewPassed`, but that mapping must live in `living-architecture`, not in platform packages.

The platform implementation must not contain conditionals such as:

```ts
if (reviewType === 'code-review')
```

or platform state fields such as:

```ts
codeReviewPassed
architectureReviewPassed
bugScannerPassed
taskCheckPassed
```

Those names can appear only in consumer documentation, examples, tests that exercise consumer integration, or `living-architecture` migration work.

## Command contract

The command name is:

```bash
record-review
```

The command accepts flags:

```bash
record-review --type code-review
record-review --type architecture-review
record-review --type bug-scanner
record-review --type task-check
```

The command reads JSON from stdin. The JSON is the source of truth. Markdown report files are not required.

### Input schema

```json
{
  "verdict": "FAIL",
  "summary": "Code comments and type guards violate conventions.",
  "branch": "issue-337-code-extraction-writes-through",
  "pullRequestNumber": 337,
  "findings": [
    {
      "title": "Code comments violate SD-006",
      "severity": "major",
      "status": "blocking",
      "rule": "SD-006",
      "file": "packages/example/src/config.ts",
      "startLine": 5,
      "endLine": 40,
      "details": "The file contains explanatory comments instead of intention-revealing code.",
      "recommendation": "Remove comments and rename code to express intent."
    }
  ]
}
```

### Required fields

- `verdict`: `PASS` or `FAIL`
- `findings`: array

### Optional fields

- `summary`
- `branch`
- `pullRequestNumber`
- finding `title`
- finding `severity`: `minor`, `major`, `critical`
- finding `status`: `blocking`, `non-blocking`, `accepted-risk`
- finding `rule`
- finding `file`
- finding `startLine`
- finding `endLine`
- finding `details`
- finding `recommendation`

## Semantics

Each `record-review` call creates one review attempt. Repeated attempts for the same review type are preserved and sorted by creation time.

`PASS` and `FAIL` drive workflow gates. Severity does not drive gates in v1.

For strict reviewers in `living-architecture`, findings imply `FAIL`:

- `architecture-review`
- `code-review`
- `bug-scanner`

For `task-check`, current behavior is preserved: critical or major findings imply `FAIL`; minor findings can be recorded on a `PASS` attempt.

If a required reviewer fails to start, fails to complete, or returns invalid JSON, the workflow transitions to `BLOCKED` and does not record a review attempt.

## Persistence

The workflow database owns review persistence. The UI must read reviews from the database. It must not hard-code review rows in UI code.

Required store methods:

- `recordReview(sessionId, createdAt, input)`
- `listSessionReviews(sessionId)`
- `listReviews(filters)`

Required SQLite table shape:

```sql
reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  review_type TEXT NOT NULL,
  verdict TEXT NOT NULL,
  branch TEXT,
  pull_request_number INTEGER,
  source_state TEXT,
  payload_json TEXT NOT NULL
)
```

Required indexes:

- session and created time
- review type and verdict
- branch
- pull request number

## Workflow event

Recording a review also appends a workflow event so the consumer workflow can fold state from review results.

Event shape:

```json
{
  "type": "review-recorded",
  "at": "2026-04-25T10:00:00.000Z",
  "reviewId": 123,
  "reviewType": "code-review",
  "verdict": "FAIL"
}
```

`living-architecture` folds this event as follows:

- `architecture-review` sets `architectureReviewPassed`
- `code-review` sets `codeReviewPassed`
- `bug-scanner` sets `bugScannerPassed`
- `task-check` sets `taskCheckPassed`

## Control Center requirements

### Session Reviews tab

Session detail must include a Reviews tab showing review attempts for that session.

The session Overview metric row must include a `Failed Reviews` metric sourced from the review rows for that session.

The tab must show:

- review type
- verdict
- attempt timestamp
- summary
- finding count
- blocking finding count
- finding details
- affected file and line range when supplied

The tab must group attempts by review type and show attempt order clearly.

### Cross-session Reviews view

Control Center must include a database-backed Reviews view that can filter across sessions.

Required filters:

- repository
- branch
- pull request number
- review type
- verdict

The view must show enough information to answer whether a problem was missed, flagged, or accepted as non-blocking.

### Platform PR simulation

The platform PR must include a real UI simulation backed by database data.

The simulation data may be seeded into a local workflow database used for the demo, fixture, or test harness. It must not be hard-coded in the UI component or API response code.

The simulation must include:

- a session with two failed review attempts followed by a passing attempt
- failures from at least two review types
- one `task-check` passing attempt with a non-blocking minor finding
- one branch value
- one pull request number

## First consumer migration: living-architecture

Remove workflow-specific review recording commands:

- `record-architecture-review-passed`
- `record-architecture-review-failed`
- `record-code-review-passed`
- `record-code-review-failed`
- `record-bug-scanner-passed`
- `record-bug-scanner-failed`
- `record-task-check-passed`

Allow `record-review` in `REVIEWING`.

Update review agents to return full structured review JSON. The main workflow records each valid result with `record-review --type <review-type>`.

The `REVIEWING -> SUBMITTING_PR` and `REVIEWING -> IMPLEMENTING` guards must preserve current behavior.

## Acceptance criteria

- `record-review` rejects invalid JSON.
- `record-review` rejects unknown verdict values.
- `record-review` rejects missing active sessions.
- `record-review` stores the review row in the database.
- `record-review` appends a `review-recorded` workflow event.
- `record-review` stores the review row and `review-recorded` event atomically.
- Repeated review attempts are preserved.
- Control Center session detail shows recorded review attempts from the database.
- Control Center cross-session Reviews view filters database review rows.
- The platform PR includes database-backed simulated review data, not UI hard-coded rows.
- `living-architecture` can replace custom review commands without losing current review gate behavior.
