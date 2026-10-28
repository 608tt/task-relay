# Validation record

Date: 2026-10-28. Release: 0.1.0. Local Node.js: 26.8.1; CI target: 22 on Linux.

## Automated checks

`npm test`: 24 passing tests covering FIFO scheduling, future start time, no concurrent dispatch, reserve-before-execute persistence, bounded quota retries, failure pause, immediate stop vs pause-after-current, interrupted restart, manual handoff, context isolation by provider, validation bounds, explicit requeue and skip.

Protocol tests include Codex/Claude terminal success and failure events, split JSONL, denied Claude tools, oversized output, literal stdin containing shell syntax, missing executable and terminating a real Node fixture subprocess. The fixture is not an AI model.

HTTP integration uses a real ephemeral localhost listener: missing tokens and foreign Origins are rejected, non-public files are not served, tasks execute in order, tokens are absent from state responses, and reopening saved state starts paused. A sandbox initially denied listening sockets; the same tests passed with local-listener permission. This was an environment restriction, not a skipped test.

## Real Codex smoke test

Installed official CLI: `codex-cli 0.165.0-alpha.1.2`, authenticated using ChatGPT. From the actual dashboard, a single read-only task requested exactly `TASK_RELAY_OK`, with no tools or file operations. It completed successfully and the queue stored `TASK_RELAY_OK` with status `done`. No API key, login token, user project files or private prompts are included here.

The dashboard then ran two local-demo jobs in order with previous-result context. These exercises do not consume AI quota.

## What remains unverified

- Claude Code actual login/model execution: it was not installed on the test machine. Its documented protocol adapter and fixtures pass; real provider verification is still needed.
- Actual provider quota exhaustion and later reset: simulated deterministically; no account was deliberately exhausted.
- Overnight uptime, network recovery over many hours, Windows native descendant cleanup and long production coding tasks.
- Semantic correctness of AI output; success means a confirmed CLI turn, not independently accepted work.

The public Pages version is a separate, clearly labeled browser simulation. It never sends prompts to a model or controls the local runner.
