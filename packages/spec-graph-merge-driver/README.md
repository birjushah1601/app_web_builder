# @atlas/spec-graph-merge-driver

Custom Git merge driver for Atlas `.atlas/*` files. Replaces Git's default 3-way text merge for:

- `.atlas/events.jsonl` — line-union with de-duplication by `id`.
- `.atlas/spec.graph.json` — mirror-first: discards both branch versions and regenerates from the Postgres mirror when reachable; structural 3-way JSON merge as fallback.

## Install (once per clone)

```bash
npx -y @atlas/spec-graph-merge-driver install
```

This command is idempotent. It does three things in your current repository:

1. Adds two lines to `.gitattributes`:
   ```
   .atlas/events.jsonl     merge=atlas-spec-graph
   .atlas/spec.graph.json  merge=atlas-spec-graph
   ```
2. Sets `merge.atlas-spec-graph.name`, `merge.atlas-spec-graph.driver`, and `merge.atlas-spec-graph.recursive` in the local `git config`.
3. Logs a structured JSON line to stderr confirming success.

**Commit `.gitattributes`** so every collaborator's Git picks up the rule. Each collaborator still has to run `install` once — Git configuration is per-clone.

## Uninstall

```bash
npx -y @atlas/spec-graph-merge-driver uninstall
```

Removes the two lines from `.gitattributes` (deleting the file if it becomes empty) and unsets the three git config keys.

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `ATLAS_DATABASE_URL` | Postgres connection string for the mirror. If unset, `spec.graph.json` merges use the structural fallback. | *(unset)* |
| `ATLAS_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` \| `fatal` — controls the stderr log threshold. | `info` |

## How Git invokes the driver

When `.gitattributes` and `git config` are in place, every `git merge` that touches one of the two patterns calls:

```
npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P
```

Git passes four file paths (`%O` = base, `%A` = ours, `%B` = theirs, `%P` = pathname). The driver overwrites `%A` with the merged result. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Clean merge. Git uses `%A` as-is. |
| 1 | I/O error (e.g. `%A` unwritable). Git treats this as a conflict. |
| 2 | Unknown path pattern. Git treats this as a conflict. |
| 3 | Driver crashed. Git treats this as a conflict. |

## Observability

Every merge invocation increments or observes:

- `atlas_merge_driver_invocations_total{pattern, path, result}` — counter, `result` ∈ `ok` / `conflict` / `fallback`.
- `atlas_merge_driver_duration_seconds{pattern}` — histogram.
- `atlas_merge_driver_mirror_unreachable_total` — counter.

Metrics register on the shared `@atlas/spec-graph-data` registry. OpenTelemetry spans under the `atlas.merge-driver.invoke` name are emitted per invocation.

## Troubleshooting

**"The driver isn't being called."**
Confirm `.gitattributes` is committed and `git check-attr merge .atlas/events.jsonl` prints `merge: atlas-spec-graph`. If it prints `unspecified`, the pattern didn't match — check for CRLF line endings or a missing final newline.

**"The driver is called but `git merge` still shows conflicts."**
Driver exited non-zero. Inspect stderr; the driver logs a JSON line per error with `level`, `msg`, `pathname`, and `err`.

**"The mirror-first path never runs."**
Either `ATLAS_DATABASE_URL` is unset in the environment `git merge` inherited, or the connection times out (the threshold is 2 seconds). Verify with `env | grep ATLAS_DATABASE_URL` before merging.

**"`npx` is too slow."**
Install once globally: `npm i -g @atlas/spec-graph-merge-driver` and change the driver command to `atlas-merge-driver merge %O %A %B %P` via `git config merge.atlas-spec-graph.driver`.
