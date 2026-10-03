#!/bin/sh
# Builds the sources for testing and runs every suite. Needs `tsc` (and puppeteer + Chrome for the visual part).
#   sh tests/run-all.sh            all suites, incl. headless-Chrome rendering → tests/visual/out/*.png
#   SKIP_VISUAL=1 sh tests/run-all.sh
set -e
cd "$(dirname "$0")/.."
rm -rf .test-build && mkdir -p .test-build/node_modules/obsidian
tsc --ignoreConfig --outDir .test-build --rootDir src --module commonjs --moduleResolution node10 \
    --ignoreDeprecations 6.0 --target ES2020 --lib ES2020,DOM --skipLibCheck --strict \
    src/@types/*.d.ts src/repository/*.ts src/core/*.ts src/views/*.ts
# The compiled code's `require("obsidian")` must be the SAME module instance the tests use
# (otherwise `instanceof TFile` fails), so the stub re-exports the test fake instead of copying it.
echo 'module.exports = require("../../../tests/fake-obsidian.js");' > .test-build/node_modules/obsidian/index.js
echo "── repository (Phase 3)";  node tests/repository.test.js
echo "── index (Phase 4)";       node tests/index.test.js
echo "── UI logic";              node tests/ui-logic.test.js
[ -n "$SKIP_VISUAL" ] || { echo "── rendered views"; node tests/visual/render.js; }
echo "ALL SUITES PASSED"
