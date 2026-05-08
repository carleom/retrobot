# Fixture Test Workflow

This project now has a scaffold for fixture-based Emerald tests.

## Directory Layout
- `fixtures/emerald/manifest.json`
- `fixtures/emerald/*.sav`
- `fixtures/emerald/<rom>.gba`

## Manifest Shape
See `fixtures/emerald/manifest.example.json`.

Top-level fields:
- `rom`: ROM path relative to `fixtures/emerald/`
- `cases`: test cases

Case fields:
- `name`: test name
- `state`: save-state path relative to `fixtures/emerald/`
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
- `yarn test:fixtures:emerald`
- `yarn test:fixtures:emerald fixtures/emerald`
