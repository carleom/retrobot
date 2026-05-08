# Emerald Fixture Tests

Drop real Emerald save-state fixtures here.

## Files
- `manifest.json`: describes the ROM, save files, and expected assertions
- `*.sav`: emulator save states to load
- optional screenshots/reference notes alongside each save

## Run
- `yarn test:fixtures:emerald`
- or `yarn test:fixtures:emerald fixtures/emerald`

## Notes
- The runner loads a ROM + `.sav`, reads WRAM, runs scene/layout assertions, and can step inputs/macros between assertions.
- First pass supports:
  - initial scene/layout assertions
  - step-by-step `input` actions
  - step-by-step `macro` actions
  - optional `idleFrames` between assertions
