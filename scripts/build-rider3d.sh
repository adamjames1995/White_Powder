#!/bin/sh
# Bundles src/rider3d.js + the parts of three.js it uses into vendor/rider3d.js (needs: npm i esbuild three@0.187.0 somewhere on NODE_PATH)
set -e
cd "$(dirname "$0")/.."
NODE_PATH="${NODE_PATH:-$(npm root -g)}" npx esbuild src/rider3d.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=vendor/rider3d.js
