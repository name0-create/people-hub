Behavioural tests for the repository layer against an in-memory fake Obsidian
(lagging metadata cache, atomic processFrontMatter, write log).

    tsc --ignoreConfig --outDir .test-build --rootDir src --module commonjs --moduleResolution node10 \
        --ignoreDeprecations 6.0 --target ES2020 --lib ES2020,DOM --skipLibCheck --strict \
        src/@types/*.d.ts src/repository/*.ts src/core/*.ts
    # tests resolve "obsidian" via tests/fake-obsidian.js:
    # SYMLINK (not copy): the compiled code and the tests must share one TFile class for `instanceof` to hold
    mkdir -p .test-build/node_modules && ln -s "$PWD/tests/fake-obsidian.js" .test-build/node_modules/obsidian.js
    node tests/repository.test.js
    node tests/index.test.js
