# Security and privacy

The HTTP service binds only to `127.0.0.1`. API requests require a random per-start bearer token in a custom header, an expected Host and, when present, a same-origin Origin. It does not enable CORS. The token is printed for the local user, sent to the page in a fragment and removed from the address bar after loading. Do not share the startup link or expose the service through a proxy.

Only four explicit frontend files are served. Queue/output data are not public static assets. Browser rendering uses `textContent`; prompts are passed to a fixed CLI using stdin and `shell:false`. The runner never extracts or stores provider authentication credentials. Existing provider CLI configuration and project hooks may still run; use trusted workspaces.

State is stored as plaintext JSON with restrictive creation permissions, atomic replacement and a workspace lock. Directory symlinks are rejected. Filesystem permissions are not encryption. Root or another process running as the same OS user can read local state and control local processes.

No bypass-permissions/full-access flags are offered. Codex uses explicit read-only/workspace-write sandbox settings. Claude's allowed tool list is not an OS sandbox and does not make arbitrary project hooks safe. Do not queue irreversible outside-world actions without a separate human step; retries can repeat partial work.

Please use the repository's security reporting option if available. Never include tokens, model credentials, private prompts or raw project logs in public issues.
