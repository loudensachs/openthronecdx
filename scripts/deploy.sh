#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '\n[%s] %s\n' "OpenThrone" "$1"
}

fail() {
  printf '\n[OpenThrone] ERROR: %s\n' "$1" >&2
  exit 1
}

require_tool() {
  local tool="$1"
  local hint="$2"
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "Missing required tool: $tool. Install it with: $hint"
  fi
}

prompt_default() {
  local label="$1"
  local default_value="$2"
  local result
  read -r -p "$label [$default_value]: " result
  printf '%s' "${result:-$default_value}"
}

ensure_auth() {
  local label="$1"
  local check_cmd="$2"
  local login_cmd="$3"
  if ! eval "$check_cmd" >/dev/null 2>&1; then
    log "$label authentication is required."
    eval "$login_cmd"
  fi
}

commit_if_needed() {
  if git diff --cached --quiet && git diff --quiet; then
    log "Working tree already committed."
    return
  fi

  git add .
  if git diff --cached --quiet; then
    log "No staged changes to commit."
    return
  fi

  git commit -m "Deploy OpenThrone"
}

extract_partykit_url() {
  local output="$1"
  local found
  found="$(printf '%s' "$output" | grep -Eo 'https://[A-Za-z0-9._/-]+partykit.dev' | tail -n 1 || true)"
  printf '%s' "$found"
}

main() {
  require_tool "node" "https://nodejs.org/"
  require_tool "npm" "https://nodejs.org/"
  require_tool "git" "https://git-scm.com/"
  require_tool "gh" "https://cli.github.com/"
  require_tool "netlify" "https://docs.netlify.com/cli/get-started/"
  require_tool "npx" "bundled with npm"

  local repo_name
  local site_name
  local partykit_name
  repo_name="$(prompt_default 'GitHub repo name' 'openthrone')"
  site_name="$(prompt_default 'Netlify site name' 'openthrone')"
  partykit_name="$(prompt_default 'PartyKit project name' "$repo_name")"

  ensure_auth "GitHub" "gh auth status" "gh auth login"
  ensure_auth "Netlify" "netlify status" "netlify login"
  ensure_auth "PartyKit" "npx partykit whoami" "npx partykit login"

  log "Installing dependencies"
  npm install

  log "Running production build"
  npm run build

  if [ ! -d .git ]; then
    log "Initializing git repository"
    git init
  fi

  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    log "Creating initial commit"
    git add .
    git commit -m "Initial OpenThrone commit"
  else
    log "Committing current changes"
    commit_if_needed
  fi

  if ! git remote get-url origin >/dev/null 2>&1; then
    log "Creating GitHub repository"
    gh repo create "$repo_name" --public --source=. --remote=origin --push
  else
    log "Pushing git history to origin"
    git push -u origin HEAD
  fi

  log "Deploying PartyKit backend"
  local partykit_output
  partykit_output="$(npx partykit deploy src/server/index.ts --name "$partykit_name" 2>&1)"
  printf '%s\n' "$partykit_output"

  local partykit_url
  partykit_url="$(extract_partykit_url "$partykit_output")"
  if [ -z "$partykit_url" ]; then
    partykit_url="$(printf 'https://%s.partykit.dev' "$partykit_name")"
  fi

  log "Configuring Netlify runtime"
  netlify env:set PARTYKIT_HOST "$partykit_url" --context production --scope runtime --force --site "$site_name" >/dev/null 2>&1 || true

  log "Deploying frontend to Netlify"
  if ! netlify deploy --dir dist --site "$site_name" --prod --message "OpenThrone deploy" --json >/tmp/openthrone-netlify.json 2>/tmp/openthrone-netlify.err; then
    log "Site not found; creating Netlify site"
    netlify deploy --dir dist --create-site "$site_name" --prod --message "OpenThrone initial deploy" --json >/tmp/openthrone-netlify.json
  fi

  local netlify_url
  netlify_url="$(grep -Eo '"url":"[^"]+"' /tmp/openthrone-netlify.json | head -n 1 | cut -d'"' -f4)"
  local github_url
  github_url="$(gh repo view "$repo_name" --json url --jq .url)"

  log "Deployment complete"
  printf 'GitHub: %s\n' "$github_url"
  printf 'PartyKit: %s\n' "$partykit_url"
  printf 'Netlify: %s\n' "$netlify_url"
}

main "$@"
