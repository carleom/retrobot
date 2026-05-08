# Emerald Fixture Tests

This directory is the tracked scaffold/template only.

Put real Emerald save-state fixtures in `local-fixtures/emerald/` instead, which is gitignored.

## Files
- `manifest.example.json` in this repo shows the expected shape
- copy that structure into `local-fixtures/emerald/manifest.json`
- keep real `*.sav` and ROM files under `local-fixtures/emerald/`

## Run
- `yarn test:fixtures:emerald local-fixtures/emerald`

## Notes
- The runner loads a ROM + `.sav`, reads WRAM, runs scene/layout assertions, and can step inputs/macros between assertions.
- First pass supports:
  - initial scene/layout assertions
  - step-by-step `input` actions
  - step-by-step `macro` actions
  - optional `idleFrames` between assertions
