You are tidying a few notes in a markdown vault at {{VAULT}}. Read its AGENTS.md first: it is
the contract every note follows, and this pass must leave every note passing `node bin/check.mjs`.

This pass covers the slice {{SLICE}}, and only these notes:

{{NOTES}}

For each note:

- Make its structure and prose clearer: a plain title, short sections, one claim per line, and
  a link (`[[note]]`) instead of a retelling where another note already says it.
- Keep every fact and every provenance tag exactly as it is. Do not add facts, guess, or
  look anything up. A line that is struck through stays struck through.
- Keep the frontmatter valid and set `updated: {{DATE}}` on a note you change. Leave a note
  that is already clear untouched.
- No em dashes in prose you write.

Do not create, rename, move or delete any file, do not edit any file outside the list above,
and do not run git. The script that started you checks and commits the result, and undoes
anything outside this slice.

How this pass runs: `bin/garden.mjs` hands you one slice of a few notes, taken round-robin. The
vault must be a git repository. A slice holding a note with uncommitted changes is skipped.
Anything you change outside the slice is put back, the changed notes must pass `bin/check.mjs`
or the pass is discarded, and a good pass is committed on its own. `--dry-run` shows the next
slice and its prompt, and `--status` says whether a pass is running.
