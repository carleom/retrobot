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
- `yarn test:fixtures:emerald fixtures/emerald` (only for the tracked example scaffold)

## Capture Saves On Server
- `yarn fixture:grab overworld_basic`
- `yarn fixture:grab double_partner_move 255d3`
- optional explicit target dir: `yarn fixture:grab double_partner_move 255d3 /repos/retrobot/local-fixtures/emerald`
