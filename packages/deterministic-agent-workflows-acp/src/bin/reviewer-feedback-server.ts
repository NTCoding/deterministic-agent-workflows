#!/usr/bin/env node
import { runReviewerFeedbackServer } from '../features/reviewer-feedback-server/entrypoint/run-reviewer-feedback-server'

try {
  runReviewerFeedbackServer({
    argv: process.argv.slice(2),
    env: process.env,
    input: process.stdin,
    output: process.stdout,
  })
} catch (error) {
  process.stderr.write(`reviewer-feedback-server failed to start: ${String(error)}\n`)
  process.exitCode = 1
}
