# Architecture and feasibility

Research date: 2026-10-28.

```text
Local dashboard → authenticated loopback HTTP → durable FIFO queue
                                                 ↓
                                  official CLI subprocess (no shell)
                                                 ↓
                            JSONL completion/error event + exit status
                                                 ↓
                           done / wait for quota / pause for review
```

## Why this implementation

OpenAI documents `codex exec --json` for non-interactive workflows, with thread/turn/item events. We combine completion events with the process exit code rather than assuming a closed process succeeded. [Official documentation](https://learn.chatgpt.com/docs/non-interactive-mode)

Claude Code documents print mode and structured output for scripts, along with explicit tool permissions and session handling. Our adapter uses stream JSON with verbose events, a finite turn cap and an allowlist of file tools. [Programmatic use](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference)

We do not assume a universal five-hour reset. The start time is user-specified; subsequent quota waits use a user-configured interval. No account polling endpoint, reset-time scraping, account rotation or limit bypass is implemented. Unknown error formats pause rather than being guessed into a retry.

## Alternatives considered

| Form | Advantage | Cost / boundary |
| --- | --- | --- |
| Browser auto-send extension | Can target an open chat | DOM changes, background throttling, ambiguous completion, service-specific automation constraints |
| Official CLI queue | Structured results, local files, real task chaining | Requires installed/authenticated CLI and an awake computer |
| API service | More controllable remote automation | Separate API billing; cannot assume subscription quota transfers |
| Product-native scheduled automation | Useful when that product supports the needed workflow | Product-specific; does not establish a cross-provider queue interface |

The current release chooses official CLIs for actual automation and offers manual web handoff. It does not claim feature parity with every provider or promise existing desktop-session resumption.

## Invariants

- One in-flight task per workspace. The queue reserves and saves the task before spawning.
- Execution uses fixed executable names and argument arrays with `shell:false`. Prompts travel through stdin.
- Only an explicit successful terminal event plus zero exit permits automatic advancement.
- A successful model turn is not proof of semantic task completion. Review tests/artifacts or use stricter acceptance checks in your task.
- Failed jobs block following jobs until explicitly retried or skipped.
- Rate-limit classification reads error channels, not ordinary generated content.
- Initial execution and every process restart are paused. No hidden auto-start from saved state.
- This is at-most-one-in-flight scheduling, **not exactly-once execution**. Crashes, quotas and retries can leave partial side effects.

## Privacy boundary

The dashboard has no model credentials. Official CLIs use their existing authentication and configuration. Prompts, workspace files read by the CLI, configured tools and prior-result context remain subject to provider behavior. Trusted project configurations can include hooks/MCP integrations; review them before unattended execution. The queue is not an additional OS sandbox for Claude Code.
