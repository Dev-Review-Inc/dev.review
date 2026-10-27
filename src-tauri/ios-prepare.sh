#!/bin/sh
# Regenerate gen/apple and put back what `cargo tauri ios init` overwrites.
# Run it from anywhere after changing the iOS project or bumping the version,
# then commit gen/apple. It builds and signs nothing.
#
# Init blanks both entitlements files and fills the asset catalog with
# Tauri's default icon. This script restores both from src-tauri/, then runs
# ../ios-project.test.sh and exits non-zero on any mismatch.
set -eu

cd "$(dirname "$0")"

apple=gen/apple
project=$apple/reviewer.xcodeproj/project.pbxproj

fail() {
  echo "ios-prepare: $*" >&2
  exit 1
}

cargo tauri ios init --ci

# The destinations come from the generated project, so a template change
# that moves them fails here instead of shipping an empty file.
destinations=$(sed -n 's/^[[:space:]]*CODE_SIGN_ENTITLEMENTS = "\{0,1\}\([^";]*\)"\{0,1\};$/\1/p' "$project" | sort -u)
[ "$(printf '%s\n' "$destinations" | grep -c .)" -eq 2 ] ||
  fail "expected two CODE_SIGN_ENTITLEMENTS paths in $project, found: $destinations"

for destination in $destinations; do
  case $(basename "$destination") in
    reviewer_iOS.entitlements) source=reviewer_iOS.entitlements ;;
    ReviewerWidget.entitlements) source=ReviewerWidget/ReviewerWidget.entitlements ;;
    *) fail "no entitlements source for $destination" ;;
  esac
  cp "$source" "$apple/$destination"
  echo "ios-prepare: $source -> $apple/$destination"
done

icons=$apple/Assets.xcassets/AppIcon.appiconset
rm -rf "$icons"
cp -R ios/AppIcon.appiconset "$icons"
echo "ios-prepare: ios/AppIcon.appiconset -> $icons"

../ios-project.test.sh
