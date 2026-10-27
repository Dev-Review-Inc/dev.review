#!/bin/sh
# src-tauri/gen/apple is committed, and it repeats what src-tauri says.
# `cargo tauri ios init` rewrites it and drops the hand-set parts. This fails
# until the generated project agrees with src-tauri and carries them again;
# src-tauri/ios-prepare.sh regenerates it and then runs this. The TestFlight
# workflow Follow Along and 66 Scripts share runs it before every build.
set -e
cd "$(dirname "$0")/src-tauri"

apple=gen/apple
project=$apple/reviewer.xcodeproj/project.pbxproj
group=group.review.dev.app
team=L22C9S8VZ7
target=17.0
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' tauri.conf.json)

fail() {
  echo "ios-project: $* Run src-tauri/ios-prepare.sh." >&2
  exit 1
}

for pair in reviewer_iOS/reviewer_iOS.entitlements:reviewer_iOS.entitlements \
  ReviewerWidgetExtension/ReviewerWidget.entitlements:ReviewerWidget/ReviewerWidget.entitlements; do
  generated=$apple/${pair%%:*}
  cmp -s "${pair#*:}" "$generated" || fail "$generated differs from ${pair#*:}."
  grep -q "$group" "$generated" || fail "$generated does not name $group."
done

diff -r ios/AppIcon.appiconset "$apple/Assets.xcassets/AppIcon.appiconset" >/dev/null ||
  fail "the app icon differs from ios/AppIcon.appiconset."

! grep "IPHONEOS_DEPLOYMENT_TARGET = " "$project" | grep -qv "= $target;" ||
  fail "$project has a deployment target other than $target."

! grep "DEVELOPMENT_TEAM = " "$project" | grep -Eqv "= \"?$team\"?;" ||
  fail "$project has a team other than $team."

for file in "$apple/project.yml" "$project"; do
  grep -q "ios-build-number.sh" "$file" || fail "the Set Build Number phase is missing from $file."
done

! grep "CFBundleShortVersionString:" "$apple/project.yml" | grep -qv ": $version$" ||
  fail "$apple/project.yml is not at version $version."

echo "ios project: ok"
