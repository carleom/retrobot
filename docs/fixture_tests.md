# Fixture Test Workflow

This project now has a scaffold for fixture-based Emerald tests.

## Directory Layout
Tracked scaffold/template:
- `fixtures/emerald/manifest.example.json`
- `fixtures/emerald/README.md`

Local gitignored runtime fixtures (recommended):
- `local-fixtures/emerald/manifest.json`
- `local-fixtures/emerald/*.sav`
- `local-fixtures/emerald/<rom>.gba`

## Public Repo Safety
This is a public-facing repository. Keep committed fixture support generic and safe for public review.

Safe to commit:
- fixture runner source code
- docs and generic workflow notes
- manifest templates with placeholder names only
- assertion examples that do not include real save data

Do not commit:
- ROMs, BIOS files, save states, screenshots, GIFs, or other copyrighted game-derived assets
- real `.sav`, `.gba`, `.gb`, `.gbc`, `.nds`, or similar emulator files
- private server paths, SSH usernames, hostnames, IP addresses, tokens, keys, or credentials
- local helper scripts that include personal workflow details
- `local-fixtures/`, `local-scripts/`, `data/`, or `roms/` contents

If a workflow needs private values, put them in ignored local files or environment variables. Keep tracked docs to placeholders like `user@server`, `/repos/retrobot`, and `emerald.gba`.

## Manifest Shape
See `fixtures/emerald/manifest.example.json`. Copy it to `local-fixtures/emerald/manifest.json` and edit there.

Top-level fields:
- `rom`: ROM path relative to the fixture directory you pass to the runner
- `cases`: test cases

Case fields:
- `name`: test name
- `state`: save-state path relative to the fixture directory you pass to the runner
- `multiplier`: optional layout multiplier
- `assert`: initial assertions
- `steps`: optional step assertions

Step fields:
- `name`: step label
- `input`: raw input state, e.g. `{ "A": true }`
- `duration`: frames to hold the input
- `macro`: simple macro label, e.g. `move:3`, `move-list:1`, `target-confirm`, `target-left`, `target-right`, `item:0`, `switch:2`, `run`
- `idleFrames`: optional extra idle frames after the action
- `assert`: assertions after the step

## Assertions
Supported assertion keys:
- `scene`
- `layoutScene`
- `labelsInclude`
- `labelsExclude`
- `customIdsInclude`
- `customIdsExclude`
- `disabledIds`
- `enabledIds`

## Current Scope
The scaffold is primarily for RAM/layout verification with real saves.
It is meant to grow into broader double-battle integration coverage once you provide representative saves.

## Run
- `yarn test:fixtures:emerald local-fixtures/emerald`

The tracked `fixtures/emerald/` directory is only a template. The runner needs a real ROM and real `.sav` state files, so use `local-fixtures/emerald/` for actual runs.

## Capture Saves On Server
The fixture capture helper is local-only and gitignored at `local-scripts/grab_fixture.sh`.

Local capture from a checkout that has `data/<game-id>/state.sav`:

```sh
local-scripts/grab_fixture.sh overworld_basic
local-scripts/grab_fixture.sh double_partner_move 255d3
```

Desktop pull from a server checkout:

```sh
RETROBOT_FIXTURE_REMOTE=user@server \
RETROBOT_FIXTURE_REMOTE_REPO=/repos/retrobot \
local-scripts/grab_fixture.sh double_partner_move 255d3
```

Environment variables:
- `RETROBOT_FIXTURE_REMOTE`: SSH target for the server, e.g. `user@server`. If unset, the script reads from the current local checkout.
- `RETROBOT_FIXTURE_REMOTE_REPO`: repo path on the server. Defaults to the current local path, which is usually only correct when both machines use the same path.

Then create or update `local-fixtures/emerald/manifest.json` so its `rom` and `state` entries match the copied files.
