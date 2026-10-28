# Operations

## Start and stop

`node src/cli.js --workspace /path --port 4318` binds only to IPv4 loopback. Use the full printed URL privately. The browser stores the per-run token in sessionStorage, not a cookie; a new server run generates a new token. If the page says it is not connected, reopen the latest printed link. Do not expose this server through a public tunnel.

Closing the browser does not stop execution. Pause stops scheduling after the current task; Stop aborts the active CLI and pauses. On macOS/Linux, the runner terminates its own child process group (TERM, then KILL when necessary). It does not roll back file changes or actions already taken. Windows native descendant cleanup is not verified.

Keep the computer awake with normal OS power settings or a tool you already trust. This project does not change power settings or install a background service. After sleep, due work is checked when Node resumes. After a process restart, click Start yourself.

## Error handling

| State | What to do |
| --- | --- |
| CLI not installed | Install from its official documentation and ensure it is on PATH |
| Not signed in | Sign in through the official CLI; do not paste credentials into Task Relay |
| Waiting for quota | Check the provider's own account screen; adjust a future start time if needed |
| Authentication/network/unknown error | Fix the cause, inspect partial work, then explicitly requeue |
| Tool permission denied | Reconsider task scope or use the official interactive CLI for the approval step |
| Interrupted | Check files and remaining processes; never assume nothing happened |
| Lock after crash | Inspect remaining CLI processes, then `--recover-lock`; interrupted jobs stay blocked |

Retries submit the same task anew, with previous completed output if enabled. They do not infer which side effects already occurred. Prefer tasks with clear acceptance criteria and repeatable operations.

## Storage and limits

State lives in `.task-relay/queue.json`. Add `.task-relay/` to your workspace's `.gitignore` before committing that workspace. The project's own `.gitignore` already does so. The file contains prompts, outputs, local paths and error text; export and share deliberately.

Limits: 200 tasks, 20000 characters per prompt, 64000 characters per saved final output, 8000 per error, 16000 prior-result characters, 100 queue events, 8 MB streamed stdout per attempt / 1 MB per JSONL buffer, and a configurable 1–240 minute timeout. Oversized protocol output fails closed. These are bounds, not a guarantee for arbitrarily long agent jobs.

No automatic cleanup erases pending/failed tasks. The UI's clear action removes only completed/skipped tasks after confirmation. Export first if you want a backup. There is no encrypted vault: local disk permissions are the protection for stored prompts/results.
