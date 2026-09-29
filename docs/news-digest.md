# News digest

The opt-in `news-digest` module sets up a scheduled collector. Every few hours it reads the
sources you list, keeps only the items it has not seen before, and writes them as one Markdown
digest. It is off until you pick the module, and its sources file starts with examples only,
so it follows nothing until you say what.

```sh
./install.sh --modules news-digest
```

## Sources

`NEWS_DIGEST_SOURCES` (default `~/.config/ai-workstation-setup/news-digest/sources.txt`) has
one source per line: `name | kind | url`.

| Kind | Reads |
| --- | --- |
| `feed` | An RSS or Atom feed: each entry's title, link and date. |
| `page` | A web page: every link whose text reads like a headline (at least four words). |

A feed is the more reliable choice where a site offers one. A page that builds its content in
the browser shows no links to a plain fetch, so it yields nothing.

## What a run does

1. Stops at once if a file named `off` sits next to its config, or if another run holds the lock.
2. Fetches each source (30 seconds each) and logs `<name>: N items, M new`, or `FAILED` for a source that did not answer.
3. Writes `digest-YYYYMMDD-HHMM.md` in `NEWS_DIGEST_OUT` (default `~/news-digest`) with the new items, grouped by source, and keeps the newest 60 digests.
4. With `NEWS_DIGEST_MODEL` set, pipes the new items to that command and puts its answer at the top as a summary. Empty means no model is ever called.

The model is yours to choose. For example, with Claude Code:

```sh
NEWS_DIGEST_MODEL='claude -p --model haiku --tools "" --strict-mcp-config --no-session-persistence --system-prompt "Summarise these items in five short lines."'
```

A run exits 1 only when every source failed, so a scheduler reports a real outage and not a
quiet day. `node ~/.config/ai-workstation-setup/news-digest/bin/news-digest.mjs --dry-run`
fetches and reports counts, writes nothing, and calls no model.

## Schedule

`NEWS_DIGEST_EVERY_HOURS` (default 6) sets how often it runs. With `NEWS_DIGEST_SCHEDULE=auto`
it uses a systemd user timer, launchd on macOS, or else cron. On Windows the installer prints
the Task Scheduler command for you to run. Settings live in
`~/.config/ai-workstation-setup/news-digest/config.json`, and the run log is `runs.log` next to it.
