# Emerald Fixture Tests

This directory is the tracked scaffold/template only.

Put real Emerald save-state fixtures in `local-fixtures/emerald/` instead, which is gitignored.

## Public Repo Safety
This repo is public-facing. Do not commit ROMs, save states, private server details, credentials, screenshots, GIFs, or local helper scripts with personal paths/hosts.

Committed fixture files should stay generic: runner code, docs, manifest templates, and placeholder names only.

## Files
- `manifest.example.json` in this repo shows the expected shape
- copy that structure into `local-fixtures/emerald/manifest.json`
- keep real `*.sav` and ROM files under `local-fixtures/emerald/`

## Run
- `yarn test:fixtures:emerald local-fixtures/emerald`

The tracked `fixtures/emerald/` directory is not runnable by itself because it intentionally does not contain a ROM or real save states.

## Notes
- The runner loads a ROM + `.sav`, reads WRAM, runs scene/layout assertions, and can step inputs/macros between assertions.
- The fixture capture helper is intentionally local-only and ignored at `local-scripts/grab_fixture.sh`; see `docs/fixture_tests.md` for the env-var based remote pull workflow.
- First pass supports:
  - initial scene/layout assertions
  - step-by-step `input` actions
  - step-by-step `macro` actions
  - optional `idleFrames` between assertions
