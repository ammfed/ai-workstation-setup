# ClickUp workspace structure

A layout that works well with agents and the second-brain vault. ClickUp has no
API for creating spaces from a script, so set this up by hand once; the `clickup`
module then installs `clickup-axi`, signs it in, and points it at your default list.
Every name below is a placeholder.

```text
Workspace: <Your Workspace>
└── Space: <Team or Area> Projects        one space per area of work
    ├── Folder: <Project A>               one folder per project or engagement
    │   └── List: Deliverables            what the project must ship
    ├── Folder: <Project B>
    │   └── List: Deliverables
    └── Folder: Operations
        └── List: Backlog                 recurring and unplanned work
```

## Conventions

- **Statuses** (per list): `to do` → `in progress` → `review` → `done`. Keep the
  closed status named `done` so `clickup-axi tasks close` lands on it.
- **Tasks are the queue; the vault is the knowledge.** A project note in the vault
  (`30-projects/<slug>.md`) links to its ClickUp folder or list through `tracker:`
  and never copies its tasks.
- **One default list** for quick capture: `clickup-axi config set default_list "<list>"`.
  A repository can pin its own with `--project` (writes `.clickup-axi.toml` at the git root).
- **Agent sessions** start with a compact dashboard from `clickup-axi setup --global`.

## Useful commands

```sh
clickup-axi spaces                          # spaces in the workspace
clickup-axi lists --space "<space>"         # lists, with their folders
clickup-axi tasks                           # your open tasks
clickup-axi tasks create "<name>" --list "<list>"
```
