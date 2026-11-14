#!/usr/bin/env bash
# Builds:
#   dist/purple-sector-live-timing@jgu.shell-extension.zip   (extensions.gnome.org upload)
#   dist/linux-purple-sector-live-timing_<version>_all.deb   (system-wide install)
set -euo pipefail
cd "$(dirname "$0")/.."

UUID=purple-sector-live-timing@jgu
SCHEMA=org.gnome.shell.extensions.purple-sector-live-timing.gschema.xml
PKG=linux-purple-sector-live-timing
VERSION=${VERSION:-1.0.5}

mkdir -p dist
gnome-extensions pack extension --force -o dist \
    --extra-source=lib --extra-source=icons --extra-source=data \
    --podir=../po --schema="schemas/$SCHEMA"
ZIP="dist/$UUID.shell-extension.zip"

BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
EXT_DIR="$BUILD/usr/share/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR" "$BUILD/DEBIAN" "$BUILD/usr/share/doc/$PKG"
unzip -q "$ZIP" -d "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"
find "$EXT_DIR" -type d -exec chmod 755 {} +
find "$EXT_DIR" -type f -exec chmod 644 {} +
install -m644 README.md "$BUILD/usr/share/doc/$PKG/README.md"
install -m644 LICENSE "$BUILD/usr/share/doc/$PKG/copyright"

cat > "$BUILD/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: gnome
Priority: optional
Architecture: all
Installed-Size: $(du -sk "$BUILD/usr" | cut -f1)
Depends: gnome-shell (>= 46)
Conflicts: linux-f1-live-timing
Replaces: linux-f1-live-timing
Maintainer: JGu <jaroslawguza83@gmail.com>
Homepage: https://github.com/jgu-linux-apps/$PKG
Description: Purple Sector Live Timing – live session results in the GNOME top bar
 GNOME Shell extension showing live motorsport session results: panel icon,
 optionally the top 1–3 drivers, and a menu with the full classification,
 Q1/Q2/Q3 sections and an expandable table. Unofficial; uses the public
 live timing feed. Enable with:
   gnome-extensions enable $UUID
 Created by: JGu. Supported by Claude.
EOF

fakeroot dpkg-deb --build -Zxz "$BUILD" "dist/${PKG}_${VERSION}_all.deb" >/dev/null
echo "$ZIP"
echo "dist/${PKG}_${VERSION}_all.deb"
