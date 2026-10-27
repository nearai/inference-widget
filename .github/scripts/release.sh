#!/usr/bin/env bash

verify_release_tag() {
  local commit
  commit=$(gh api "repos/$GH_REPO/commits/refs%2Ftags%2F$RELEASE_TAG" --jq .sha) || return $?
  if [ "$commit" != "$GITHUB_SHA" ]; then
    printf 'Tag %s no longer points to the workflow commit.\n' "$RELEASE_TAG" >&2
    return 1
  fi
}

verify_npm_channel() {
  local status current_version
  status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --user-agent 'nearai-inference-widget-release (https://github.com/nearai/inference-widget)' \
    "https://registry.npmjs.org/@nearai%2finference-widget/$NPM_TAG") || return $?
  case "$status" in
    200) ;;
    404) return 0 ;;
    *) printf 'npm channel lookup failed with HTTP %s.\n' "$status" >&2; return 1 ;;
  esac
  current_version=$(npm view "@nearai/inference-widget@$NPM_TAG" version \
    --registry=https://registry.npmjs.org) || return $?
  if [ -z "$current_version" ]; then
    printf 'Could not read the current npm %s version.\n' "$NPM_TAG" >&2
    return 1
  fi
  if ! pnpm dlx semver@7.8.5 --include-prerelease \
    --range ">=$current_version" "$RELEASE_VERSION" >/dev/null; then
    printf 'Cannot confirm npm %s is at least %s (%s); refusing publication.\n' \
      "$RELEASE_VERSION" "$current_version" "$NPM_TAG" >&2
    return 1
  fi
}
