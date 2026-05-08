#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  printf 'Usage: scripts/grab_fixture.sh <fixture-name> [game-id] [target-dir]\n' >&2
  printf 'Example: scripts/grab_fixture.sh double_partner_move\n' >&2
  printf 'Example: scripts/grab_fixture.sh double_partner_move 255d3 /repos/retrobot/local-fixtures/emerald\n' >&2
  exit 1
fi

name="$1"
game_id="${2:-}"
target_dir="${3:-}"
repo_root="$(pwd)"
fixtures_dir="${target_dir:-$repo_root/local-fixtures/emerald}"
mkdir -p "$fixtures_dir"

if [ -n "$game_id" ]; then
  data_dir="$repo_root/data/$game_id"
else
  data_dir="$(ls -td "$repo_root"/data/* 2>/dev/null | head -n1 || true)"
fi

if [ -z "$data_dir" ] || [ ! -d "$data_dir" ]; then
  printf 'Could not locate a data directory. Pass a game id explicitly.\n' >&2
  exit 1
fi

state_src="$data_dir/state.sav"
if [ ! -f "$state_src" ]; then
  printf 'State file not found: %s\n' "$state_src" >&2
  exit 1
fi

state_dest="$fixtures_dir/$name.sav"
cp "$state_src" "$state_dest"
printf 'Copied save state to %s\n' "$state_dest"

rom_src="$(ls "$data_dir"/*.gba 2>/dev/null | head -n1 || true)"
if [ -n "$rom_src" ]; then
  rom_dest="$fixtures_dir/$(basename "$rom_src")"
  if [ ! -f "$rom_dest" ]; then
    cp "$rom_src" "$rom_dest"
    printf 'Copied ROM to %s\n' "$rom_dest"
  else
    printf 'ROM already present at %s\n' "$rom_dest"
  fi
fi
