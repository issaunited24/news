#!/usr/bin/env bash
# Keeps the news fresh: collects every few minutes for a while, then the next robot run takes over.
#  - Each round's news goes to the "live" branch (replaced every time, so it never piles up history).
#    The app reads it straight from there, so it doesn't wait for the website to rebuild.
#  - About once an hour the data is also saved to the main branch as a backup (the website copy).
set -u
LOOP_MINUTES=${LOOP_MINUTES:-110}   # how long one robot run keeps going
EVERY=${EVERY:-210}                 # seconds from the start of one round to the next (3.5 minutes)
SYNC_EVERY=${SYNC_EVERY:-43200}     # seconds between backups to main (12h; the app reads the live branch, this is only a fallback)
END=$(( $(date +%s) + LOOP_MINUTES * 60 ))

git config user.name "briefly-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Start from the newest saved state: the live branch, if it exists
if git fetch -q --depth=1 origin live 2>/dev/null; then
  for f in news.json charts.json state.json; do git show "FETCH_HEAD:$f" > "data/$f.tmp" 2>/dev/null && mv "data/$f.tmp" "data/$f" || rm -f "data/$f.tmp"; done
  echo "Started from the live branch"
fi

publish_live() {
  export GIT_INDEX_FILE="$RUNNER_TEMP/live-index"
  rm -f "$GIT_INDEX_FILE"
  for f in news.json older.json charts.json state.json; do
    [ -f "data/$f" ] || continue
    git update-index --add --cacheinfo "100644,$(git hash-object -w "data/$f"),$f"
  done
  local tree commit
  tree=$(git write-tree)
  commit=$(git commit-tree "$tree" -m "Live news $(date -u +%H:%M)")
  unset GIT_INDEX_FILE
  for i in 1 2 3; do git push -q -f origin "$commit:refs/heads/live" && return 0; sleep 5; done
  echo "Couldn't update the live branch this round"
}

backup_to_main() {
  # only if the last backup is older than SYNC_EVERY, so the main branch doesn't grow by megabytes every hour
  git fetch -q --depth=1 origin main || return 0
  local last; last=$(git log -1 --format=%ct FETCH_HEAD -- data 2>/dev/null || echo 0)
  [ $(( $(date +%s) - ${last:-0} )) -lt "$SYNC_EVERY" ] && return 0
  for i in 1 2 3; do
    git fetch -q --depth=1 origin main && git reset -q --mixed FETCH_HEAD || { sleep 5; continue; }
    git add data
    if git diff --cached --quiet; then return 0; fi
    git commit -q -m "Update news" && git push -q origin HEAD:main && { echo "Backed up to main"; return 0; }
    sleep 5
  done
}

last_sync=$(date +%s)
round=0
while [ "$(date +%s)" -lt "$END" ]; do
  start=$(date +%s); round=$((round + 1))
  # pick up any changes to the rules and feeds made since this run started
  git fetch -q --depth=1 origin main && git checkout -q FETCH_HEAD -- scripts feeds.json 2>/dev/null
  if timeout 300 node scripts/collect.mjs; then
    publish_live
    if [ $(( $(date +%s) - last_sync )) -ge 3600 ]; then backup_to_main; last_sync=$(date +%s); fi
  else
    echo "Round $round failed; trying again next round"
  fi
  echo "Round $round took $(( $(date +%s) - start ))s"
  wait_s=$(( start + EVERY - $(date +%s) ))
  [ "$wait_s" -gt 0 ] && [ $(( $(date +%s) + wait_s )) -lt "$END" ] && sleep "$wait_s"
done
backup_to_main
echo "Done after $round rounds"
