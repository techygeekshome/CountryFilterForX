#!/usr/bin/env bash
# Builds the release packages into dist/.
#   CountryFilterForX.zip          Chrome, Edge, Brave, Opera, Vivaldi (unzip, then Load unpacked)
#   CountryFilterForX-chrome.zip   same files, named for Chrome users
#   CountryFilterForX-edge.zip     same files, named for Edge users
#   CountryFilterForX-firefox.zip  Firefox package (Firefox manifest, files at the root)
set -euo pipefail
cd "$(dirname "$0")"
FILES="content.js content.css page.js regions.js popup.html popup.js list.html list.js ui.css icons"
OUT=dist; TMP=$(mktemp -d)
mkdir -p "$OUT"
rm -f "$OUT"/CountryFilterForX*.zip

mkdir "$TMP/country-filter-for-x"
cp -r $FILES manifest.json LICENSE "$TMP/country-filter-for-x/"
(cd "$TMP" && zip -qr -X pkg.zip country-filter-for-x)
for n in CountryFilterForX CountryFilterForX-chrome CountryFilterForX-edge; do cp "$TMP/pkg.zip" "$OUT/$n.zip"; done

mkdir "$TMP/ff"
cp -r $FILES LICENSE "$TMP/ff/"
cp manifest.firefox.json "$TMP/ff/manifest.json"
(cd "$TMP/ff" && zip -qr -X ../ff.zip .)
cp "$TMP/ff.zip" "$OUT/CountryFilterForX-firefox.zip"

rm -r "$TMP"
ls -l "$OUT"
