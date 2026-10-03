Behavioural tests against an in-memory fake Obsidian (lagging metadata cache, atomic
processFrontMatter, real event stream, write log). One command:

    sh tests/run-all.sh                 # everything
    SKIP_VISUAL=1 sh tests/run-all.sh   # without the headless-Chrome part

Suites
  repository.test.js   Phase 3: repositories (safe frontmatter writes, rename, archive, validation)
  index.test.js        Phase 4: recognition, scan, incremental updates, "incremental == fresh scan" invariant
  ui-logic.test.js     zodiac/lunar, directory filter+sort, photo refs, birthday stats
  visual/render.js     renders the real compiled views + styles.css in headless Chrome (fake Obsidian runtime,
                       approximated Obsidian base styles, date frozen to 2026-09-29), asserts on the DOM and writes
                       screenshots to tests/visual/out/. Set CHROME_PATH / PUPPETEER_PATH if auto-detection fails.

Note: the visual harness approximates Obsidian's base button/input styles; it verifies structure, layout and
behaviour, not pixel parity with your theme.
