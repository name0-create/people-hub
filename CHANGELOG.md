# People Hub — Changelog

## Unreleased — UI refactor: People directory (main window) + Birthdays sidebar

- **Main window — People directory** (`views/directory-view.ts`, command "People Hub: Open People directory",
  second ribbon icon): header with "N people in <folder>" and **Add person**, search, sort (name ↑/↓, last contact
  newest/oldest, next encounter, favourites first), company and tag filters, "N of M" count, and a responsive card
  grid (photo or initials tile, name, company/role, "Last contact", favourite star). Click / Ctrl-click / middle-click /
  Enter open the note; right-click gives Open, Open in new tab, Log talk, Quick log. Built from `PeopleIndex` entries,
  updates live (search text and focus survive), refresh button in the tab header. Archived people are hidden; the
  plugin's own `type/` and `status/` tags are hidden from the tag filter.
- **Sidebar — Birthdays tab** (`views/birthdays-panel.ts`): stat tiles (Total · Today · 7d · 30d), **Next 30 Days** and
  **Later Birthdays** cards (zodiac + lunar line, birthday, next date, "21d", "21 years old"), and a two-month
  **Birthday Calendar** with Prev / Today / Next (🎂 birthdays and 💍 anniversaries as chips; today outlined).
  Anniversary and "no birthday on file" lists are kept below.
- **Zodiac & lunar date** (`core/astro.ts`): Chinese zodiac + lunar date from the platform's Chinese calendar
  (correct around lunar new year, leap months labelled), western sign from month/day (works for year-less
  birthdays). New setting **Zodiac & lunar date** (default on).
- Sidebar rows and section headings share the new card style; tier colour is now an accent stripe.
- Photos: `photo` may be a URL, `[[wikilink]]`, `![[embed]]`, markdown image or vault path (`core/photo.ts`).
- Styles use Obsidian theme variables (dark/light/any theme), mobile layout, and selectors specific enough to
  beat Obsidian's own input/select rules.
- Tests: `sh tests/run-all.sh` builds and runs everything (repository, index, UI logic, and a headless-Chrome render of
  the real views with DOM assertions + screenshots in `tests/visual/out/`). Fixed a bug in the test setup shipped with
  Phases 3–4 (two copies of the fake `TFile` made `instanceof` fail outside my scratch directory).

## Unreleased — Phase 4: People index

- **`PeopleIndex` is now incremental.** A cache derived only from Obsidian's metadata cache; never persisted,
  never written to, rebuildable at any time. Per person it keeps a lean **`IndexEntry`** (path, id, name,
  display_name, photo, favorite, relationship_type, company, role, status, birthday, last_contacted,
  next_encounter, cadence, importance, tags) plus the v0.2 `PersonView` projection, parsed in one pass.
- **Events:** `bind()` listens to metadataCache `changed` (created + modified, once frontmatter is parsed),
  vault `rename` (folder move → rescan) and `delete`; only the affected note is re-parsed.
- **Batched notifications:** `index.onChange(fn)` gets one `{paths, full}` per burst, and only when something
  a view could show actually changed (editing a note body no longer re-renders views).
- **Recognition** is one pure function (`core/recognition.ts`): `type: person`, or a `type/person` tag
  (list or string), or — with the new **Detect by folder** setting (default on) — frontmatter without a `type`
  inside the People folder. Excluded folders always win.
- **`models/PersonNormalizer.ts`**: the single frontmatter→`Person` interpreter, shared by `PersonRepository`
  and `PeopleIndex`. **`models/IndexEntry.ts`**: the entry shape.
- New index API: `entries()`, `entry(path)`, `entryById(id)`, `view(path)`, `size`, `search(q)`,
  `duplicateIds()`, `refreshFile`, `removePath`, `rebuild`, `rolloverIfNeeded`, `flush`, `stats`.
- `PersonRepository` refreshes just the affected entry after each write (no more whole-index invalidation).
- Plugin: initial scan at layout-ready; the hourly full rebuild is replaced by a 15-minute day-rollover check
  (date-based fields such as "due in N days" are recomputed when the day changes).
- Fix: registry now lists `biz` as a legacy key of `company` (the old index already read it).

## Unreleased — Phase 3: Markdown repository layer

- **`repository/MarkdownStore.ts`** — the only module that calls vault/file-manager write APIs.
  Frontmatter via `processFrontMatter` (atomic, no YAML string handling, body untouched); renames via
  `fileManager.renameFile` (updates links); deletes via `fileManager.trashFile`; nothing is overwritten;
  waits for the metadata cache after writes so re-reads aren't stale; per-note lock for multi-step ops.
- **`repository/PersonRepository.ts`** — `getPerson`, `getPersonById`, `createPerson`, `updatePerson`,
  `renamePerson`, `archivePerson`, `restorePerson`, `deletePerson`. Patches are validated against
  `SchemaRegistry`; name edits sync `display_name`/`title` and rename the file; `updated` is maintained;
  reads normalise legacy v0.2 keys to the canonical `Person` without modifying the note.
- **`repository/InteractionRepository.ts`**, **`MeetingRepository.ts`** (on a generic `NoteRepository`).
- **`models/PropertyValidation.ts`** — `coerceValue` (lenient read) / `validateValue` (strict write).
- `PropertyDefinition.partialDate` — birthdays/anniversaries may stay year-less (`--MM-DD`).
- **Renamed** the old query class `PersonRepository` → `PeopleIndex` (read side); `plugin.repo` → `plugin.index`.
  New: `plugin.people`, `plugin.interactions`, `plugin.meetings`.
- `person-actions.ts` (`logTalk`, `snooze`, `setPaused`, `createPerson`) now writes through `PersonRepository`;
  UI call sites show repository errors as notices.
- `PeopleIndex` also reads canonical keys (`relationship_type`, `prm_tier`, `cadence`).
- **`minAppVersion` 1.5.0 → 1.6.6** (`FileManager.trashFile`).
- Behaviour change: new people are written with canonical keys (`birthdate`, `instagram`, `prm_tier`, `PER-…` id,
  ISO `created`, …); v0.2 scoring fields are kept as extension fields. Snooze now writes `next_encounter`.

## Unreleased — Phase 2: Canonical People data model

- **`models/Person.ts`** — canonical stored person (frontmatter) interface, `schema_version`, `PER` id prefix.
- **`models/PersonProperty.ts`** — `PropertyDefinition`, `PropertyType`, `MetaBindControl`, `PropertyGroup`.
- **`models/Interaction.ts`**, **`models/Meeting.ts`** — canonical models for stand-alone interaction / meeting notes.
- **`models/SchemaRegistry.ts`** — single registry of all 64 person properties (type, editable, Meta Bind
  control, searchable, filterable, options, legacy keys). Typed against `Person`: a missing, extra or
  wrongly-typed definition fails the build.
- **Renamed** `models/person.ts` → `models/person-view.ts` and its `Person` interface → `PersonView`
  (frees the name `Person`; avoids a case-only filename clash on macOS/Windows).
- `LOG_TYPES` in `person-actions.ts` now derives from `INTERACTION_TYPES`.
- No behaviour change: the repository still reads the v0.2 frontmatter keys. Wiring it to the registry is next.

## v0.2.0 — Phase 1 complete

### Architecture (Phase 1 from the spec)
- **Zero hard-coded vault paths.** Every folder is resolved through `FolderService`.
  Settings expose four independent fields: `peopleFolder`, `archiveFolder`,
  `interactionFolder`, `meetingFolder`. Code never references a literal path.
- **Clean module tree** — `core/`, `models/`, `repository/`, `views/`, `integrations/`.
- **Full TypeScript strict-mode compilation at zero errors** — including an
  offline-safe Obsidian ambient shim (`src/@types/`) so CI works without the
  Obsidian npm package.
- **`FolderService`** — single gatekeeper: `resolve`, `get`, `exists`, `ensure`,
  `listFiles`, `contains`, `validate`. No feature reads a folder path directly.
- **`PersonRepository`** replaces the old `PersonIndex` — injected with
  `FolderService`; all queries live here; invalidate/rebuild cache pattern preserved.
- **`PersonActions`** — all write operations in one place: `logTalk`, `quickLog`,
  `snooze`, `setPaused`, `createPerson`, `createWithTemplater`, `createWithQuickAdd`.
- **`IntegrationSettings`** — per-integration enable flags; `enableQuickAdd`,
  `enableTemplater`, `enableMetaBind`, `enableDataview`, `enableBases`.
- **Debug mode** — `debugMode: true` in settings enables index operation logging.
- **Settings migration** — `loadSettings` deep-merges saved data over defaults so
  new fields added in future versions don't break existing vaults.

### v0.2 features
- **One-tap mobile log (swipe action)**
  - Swipe right on any person row in Today/People to open `QuickLogSheet`.
  - `SwipeHandler` detects horizontal swipes (>60px, more horizontal than vertical)
    and calls the provided `open` callback with the target person.
  - Visual flash on the swiped row (`ph-swiped` CSS class).
  - `QuickLogSheet` is a bottom-sheet modal: drag handle, type chip strip (large
    touch targets), date, free-text note area, and a `▸ More` toggle for
    presence/energy/Carnegie/learned/next fields.
  - iOS zoom-prevention: date input uses `font-size: 16px`.
  - `📝` tap icon on every row (full opacity on mobile, hover-reveal on desktop).
  - Configurable: Settings → Mobile → "One-tap log (swipe action)".

- **Anniversary reminders**
  - New `anniversary` field on `Person` (parsed from `anniversary`,
    `friendiversary`, `wed_date`, `anniversary_date` frontmatter keys).
  - `AnniversaryInfo` type: `date`, `years`, `days`, `label`.
  - Label is inferred from the key name (`friendiversary` → "friendiversary",
    `wed_date` → "wedding anniversary") or from `anniversary_label` frontmatter.
  - `upcomingAnniversaries(days)` and `anniversariesInMonth(year, month)` queries.
  - `missingAnniversaries()` — flags people whose `type_person` implies a
    relational anniversary (girlfriend, partner, close-friend, family) but have
    none on file.
  - Today tab: "💍 Anniversary today" and "💍 Anniversaries · Nd" sections.
  - Birthdays tab: anniversary calendar (purple chips) alongside the birthday
    calendar; "Anniversaries · 60 days" list; "No anniversary on file" list.
  - Status bar includes `💍N` when anniversaries fall today.
  - Startup notice includes anniversary names.
  - New command: **Insert upcoming anniversaries** (editor callback).
  - New `people` code block view: `view: anniversaries`.

- **QuickAdd integration**
  - `integrations/quickadd.ts` — `runQuickAddMacro`, `isQuickAddAvailable`.
  - When `enableQuickAdd` is on, the "New person" button/command tries the named
    macro first, then Templater, then the built-in modal.
  - User-script export (`runFromQuickAdd`) lets you register People Hub as a
    QuickAdd user script: QuickAdd calls it, it delegates to `plugin.newPerson()`.
  - New command: **New person via QuickAdd** (bypasses Templater, goes straight
    to the macro).
  - Graceful degradation with clear `Notice` messages if QuickAdd is not installed
    or the macro name is wrong.

### Settings additions (v0.2)
| Key | Default | Description |
|---|---|---|
| `archiveFolder` | `20 - PEOPLE/_Archive` | Configurable archive folder |
| `interactionFolder` | `20 - PEOPLE/_Interactions` | Stand-alone interaction notes |
| `meetingFolder` | `20 - PEOPLE/_Meetings` | Stand-alone meeting notes |
| `anniversaryLookahead` | 14 | Days ahead for anniversary alerts |
| `mobileSwipeLog` | true | Enable swipe-to-log on mobile |
| `integrations.enableQuickAdd` | false | QuickAdd macro bridge |
| `integrations.enableTemplater` | false | Templater bridge |
| `integrations.enableMetaBind` | false | Meta Bind flag |
| `integrations.enableDataview` | false | Dataview flag |
| `integrations.enableBases` | false | Bases flag (future) |
| `quickAddMacroName` | "New Person" | Exact QuickAdd macro name |
| `debugMode` | false | Log index ops to console |

---

## v0.1.0 — Initial build
- Sidebar: Today / People / Birthdays / Carnegie tabs
- Carnegie scores C1–C9, aggregated dashboard, per-person modal
- Reach-out cadence derived from `type_person` or explicit `prm-tier`
- Birthday calendar (month view + upcoming list + missing list)
- Log talk modal: rotates talk1–talk5 in frontmatter
- Snooze / pause from ⋯ menu
- Status bar + startup notice
- `people` code block: `view: reachout|birthdays|carnegie`
- Commands: open hub, log talk, Carnegie for active note, insert birthdays/reach-out
