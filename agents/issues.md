# Issues

Issues and features live as specs in an Obsidian base, not in this repo.

**Vault path:** `<value of OBSIDIAN_VAULT_PATH in @.env.obsidian>/vault/side projects/Houdini/NodebookMD/NodebookMD — Issue Tracker.base`

The base reads the spec files in `specs/<Type>/<Status>/`. The folder and the
frontmatter must agree: a closed issue is `Type: Issue`, `Status: Closed`.

Files are moved automatically, so no need to manually place them under `specs/####/Closed/`

## Spec format

Frontmatter: `Type` (Issue | Feature), `Status` (Open | Closed | Archived),
`Priority` (P0 | P1 | P2 | P3), `Area` (Front-end | Back-end).

Body: one short paragraph. Name the file and the behaviour. State the decision
to make. A pasted screenshot is welcome. No code blocks, no steps, no history.

## Status

When you commit work that closes a spec, set `Status: Closed` in that spec
The `/commit` command does this on its own — no need to ask for it
separately once the user has called it.
