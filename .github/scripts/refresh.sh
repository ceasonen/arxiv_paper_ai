#!/usr/bin/env bash
set -euo pipefail

branch=paper-data
archive="${RUNNER_TEMP:?}/paper-radar-data"
catalog=dist/data/catalog.json

mkdir -p dist/data
cp web/index.html web/app.js web/theme.css dist/
cp -R web/vendor web/fonts dist/

if git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null; then
  git fetch --depth=1 origin "refs/heads/$branch"
  git worktree add --detach "$archive" FETCH_HEAD
  cp "$archive/catalog.json" "$catalog"
else
  status=$?
  if [[ "$status" != 2 ]]; then
    exit "$status"
  fi
  git worktree add --detach "$archive" HEAD
  git -C "$archive" switch --orphan "$branch"
fi
trap 'git worktree remove --force "$archive"' EXIT

python3 radar.py update --output "$catalog" --affiliation-limit 10
chmod 644 "$catalog"
cp "$catalog" "$archive/catalog.json"
git -C "$archive" add catalog.json
if ! git -C "$archive" diff --cached --quiet; then
  git -C "$archive"     -c user.email=41898282+github-actions[bot]@users.noreply.github.com     -c user.name='github-actions[bot]'     commit -m "Refresh arXiv paper catalog"
  git -C "$archive" push origin "HEAD:refs/heads/$branch"
fi
