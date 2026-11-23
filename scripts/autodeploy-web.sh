#!/usr/bin/env bash
# Rebuilds and redeploys the landing page (web/) and the web platform
# (desktop/) on the prod server whenever main moves. Run from cron:
#   */2 * * * * $HOME/deploy/dilarion-app/scripts/autodeploy-web.sh >> $HOME/deploy/autodeploy.log 2>&1
#
# Only the app whose folder changed is rebuilt. The build goes into the folder
# the pm2 static server already serves, so no restart is needed.
#   DRY_RUN=1  print what would happen, change nothing
#   FORCE=1    rebuild both even if nothing changed
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

REPO=${REPO:-$HOME/deploy/dilarion-app}
BRANCH=${BRANCH:-main}
STATE=${STATE:-$HOME/deploy/state}
mkdir -p "$STATE"

exec 9>"$STATE/lock"
flock -n 9 || exit 0

cd "$REPO"
git fetch -q origin "$BRANCH"
new=$(git rev-parse "origin/$BRANCH")

serve_path() {
  pm2 jlist | python3 -c '
import json, sys
name = sys.argv[1]
for p in json.load(sys.stdin):
    if p["name"] == name:
        e = p["pm2_env"]
        print(e.get("PM2_SERVE_PATH") or e.get("env", {}).get("PM2_SERVE_PATH") or e["pm_cwd"])
        break
' "$1"
}

deploy() {
  local dir=$1 app=$2 last target
  last=$(cat "$STATE/$app" 2>/dev/null || true)
  if [ -z "${FORCE:-}" ] && [ -n "$last" ] && git diff --quiet "$last" "$new" -- "$dir"; then
    return 0
  fi

  target=$(serve_path "$app")
  if [ -z "$target" ] || [ "$target" = "$HOME" ] || [ -e "$target/package.json" ] || [ -d "$target/.git" ]; then
    echo "$(date -Is) $app: refusing to deploy into '$target' (not a build folder)"
    return 1
  fi

  echo "$(date -Is) $app: ${last:0:7} -> ${new:0:7}, building $dir into $target"
  [ -n "${DRY_RUN:-}" ] && return 0

  git reset -q --hard "$new"
  (
    cd "$dir"
    lock_hash=$(sha256sum package-lock.json | cut -c1-16)
    if [ ! -d node_modules ] || [ "$(cat "$STATE/$app.lock" 2>/dev/null)" != "$lock_hash" ]; then
      npm ci --no-audit --no-fund
      echo "$lock_hash" > "$STATE/$app.lock"
    fi
    npm run build
  )
  [ -f "$dir/dist/index.html" ] || { echo "$(date -Is) $app: build has no index.html, not deploying"; return 1; }
  rsync -a --delete "$dir/dist/" "$target/"
  echo "$new" > "$STATE/$app"
  echo "$(date -Is) $app: deployed ${new:0:7}"
}

status=0
deploy web dilarion-web || status=1
deploy desktop dilarion-webplatform || status=1
exit $status
