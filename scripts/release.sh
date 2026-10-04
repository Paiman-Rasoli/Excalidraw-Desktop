#!/usr/bin/env bash
# Release helper for Excalidraw Desktop.
#
#   scripts/release.sh bump <patch|minor|major|X.Y.Z>
#       From an up-to-date main: create branch release/vX.Y.Z, set the version in
#       package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml and
#       src-tauri/Cargo.lock, commit, push and open a PR.
#
#   scripts/release.sh tag
#       After that PR is merged: check that all version files agree on main,
#       then create and push tag vX.Y.Z. The tag push starts the Release
#       workflow, which builds every platform and publishes the GitHub release.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

repo_slug() {
  git remote get-url origin | sed -E 's#^.*[:/]([^/]+/[^/]+)$#\1#; s#\.git$##'
}

require_clean_main() {
  [ -z "$(git status --porcelain)" ] || die "working tree has uncommitted changes"
  git switch -q main
  git pull -q --ff-only origin main
}

current_version() {
  node -p "require('./package.json').version"
}

# Reads the version from every file the app version lives in.
file_versions() {
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
    const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
    const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
    const lock = fs.readFileSync("src-tauri/Cargo.lock", "utf8").match(/name = "excalidraw_desktop"\r?\nversion = "([^"]+)"/)?.[1];
    console.log(`package.json=${pkg} tauri.conf.json=${tauri} Cargo.toml=${cargo} Cargo.lock=${lock}`);
  '
}

next_version() {
  local current=$1 kind=$2 major minor patch
  IFS=. read -r major minor patch <<<"$current"
  case $kind in
    patch) echo "$major.$minor.$((patch + 1))" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    major) echo "$((major + 1)).0.0" ;;
    *) echo "$kind" ;;
  esac
}

set_version() {
  VERSION=$1 node -e '
    const fs = require("fs");
    const v = process.env.VERSION;
    const edit = (file, re, label) => {
      const src = fs.readFileSync(file, "utf8");
      if (!re.test(src)) { console.error(`error: version not found in ${file}`); process.exit(1); }
      fs.writeFileSync(file, src.replace(re, `$1${v}$2`));
      console.log(`  ${file}`);
    };
    edit("package.json", /("version"\s*:\s*")[^"]+(")/);
    edit("src-tauri/tauri.conf.json", /("version"\s*:\s*")[^"]+(")/);
    edit("src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/);
    edit("src-tauri/Cargo.lock", /(name = "excalidraw_desktop"\r?\nversion = ")[^"]+(")/);
  '
}

cmd_bump() {
  [ $# -eq 1 ] || usage
  require_clean_main

  local current version branch
  current=$(current_version)
  version=$(next_version "$current" "$1")
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version '$version' (want X.Y.Z)"
  [ "$version" != "$current" ] || die "version is already $current"
  if git rev-parse -q --verify "refs/tags/v$version" >/dev/null ||
     git ls-remote --exit-code --tags origin "v$version" >/dev/null 2>&1; then
    die "tag v$version already exists"
  fi

  branch="release/v$version"
  echo "Bumping $current -> $version on branch $branch"
  git switch -q -c "$branch"
  set_version "$version"

  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  git commit -q -m "chore: release v$version"
  git push -q -u origin "$branch"

  if ! gh pr create --base main --head "$branch" \
       --title "chore: release v$version" \
       --body "Bump app version to $version. After merging, run \`scripts/release.sh tag\`." 2>/dev/null; then
    echo
    echo "Could not open the PR with gh. Open it here:"
    echo "  https://github.com/$(repo_slug)/compare/main...$branch?expand=1"
  fi
  echo
  echo "Next: merge the PR, then run: scripts/release.sh tag"
}

cmd_tag() {
  [ $# -eq 0 ] || usage
  require_clean_main

  local version versions tag
  version=$(current_version)
  versions=$(file_versions)
  for pair in $versions; do
    [ "${pair#*=}" = "$version" ] || die "version mismatch on main: $versions"
  done

  tag="v$version"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null ||
     git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
    die "tag $tag already exists; did you forget to merge the bump PR?"
  fi

  git tag -a "$tag" -m "$tag"
  git push -q origin "$tag"
  echo "Pushed $tag at $(git rev-parse --short HEAD)."
  echo "Build: https://github.com/$(repo_slug)/actions"
  echo "Release (when the build finishes): https://github.com/$(repo_slug)/releases/tag/$tag"
}

case ${1:-} in
  bump) shift; cmd_bump "$@" ;;
  tag) shift; cmd_tag "$@" ;;
  *) usage ;;
esac
