#!/usr/bin/env bash
# One-command store release for the mobile app.
#
#   npm run release                 # both stores, same version, new build number
#   npm run release -- ios          # iOS only   (ios | android | all)
#   npm run release -- all patch    # bump version first: 2.0.0 -> 2.0.1 (patch | minor | major)
#
# Build numbers (iOS buildNumber / Android versionCode) are bumped by EAS
# itself (eas.json: appVersionSource "remote" + autoIncrement), so they never
# need touching by hand. --auto-submit then uploads each finished build using
# eas.json's submit.production profile: iOS -> TestFlight / App Store
# Connect, Android -> Play Console on the track set there.
set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM="${1:-all}"
BUMP="${2:-}"

case "$PLATFORM" in ios|android|all) ;; *) echo "Platform must be ios, android or all"; exit 1 ;; esac

if [[ -n "$BUMP" ]]; then
  case "$BUMP" in patch|minor|major) ;; *) echo "Bump must be patch, minor or major"; exit 1 ;; esac
  NEW_VERSION=$(node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync("app.json", "utf8"));
    const [ma, mi, pa] = cfg.expo.version.split(".").map(Number);
    const kind = process.argv[1];
    cfg.expo.version = kind === "major" ? `${ma + 1}.0.0` : kind === "minor" ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
    fs.writeFileSync("app.json", JSON.stringify(cfg, null, 2) + "\n");
    console.log(cfg.expo.version);
  ' "$BUMP")
  echo "Version bumped to $NEW_VERSION"
fi

VERSION=$(node -p 'require("./app.json").expo.version')
echo "Releasing v$VERSION to: $PLATFORM"

npx eas-cli build --platform "$PLATFORM" --profile production --auto-submit --non-interactive --no-wait

echo
echo "Queued. Builds + store uploads run on EAS; follow progress at:"
echo "  https://expo.dev/accounts/kabilan404/projects/mobile-portal/builds"
