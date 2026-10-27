#!/bin/sh
# Give the iOS build a CFBundleVersion that TestFlight accepts twice for one
# version. The Tauri CLI writes the version string into CFBundleVersion on every
# build, so Xcode runs this as the app target's last phase (Set Build Number in
# ios-project.yml): after the plists are copied in, before the signature is
# taken. The same as Follow Along's and 66 Scripts'.
#
# The number is whole minutes since 2026-01-01 UTC: one integer that rises with
# the clock whatever git history does. The widget gets the same number, because
# App Store Connect wants an extension's build number to match its app's.
set -e
epoch=1767225600   # 2026-01-01T00:00:00Z
build=$(( ($(date -u '+%s') - epoch) / 60 ))
plist=${TARGET_BUILD_DIR:?}/${INFOPLIST_PATH:?}
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build" "$plist"
for widget in "$TARGET_BUILD_DIR/${PLUGINS_FOLDER_PATH:?}"/*.appex/Info.plist; do
  [ -f "$widget" ] && /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build" "$widget"
done
echo "CFBundleVersion $build ($(date -u '+%Y-%m-%d %H:%M') UTC)"
