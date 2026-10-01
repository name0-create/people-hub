# People Hub — Changelog

## Unreleased — Phase 4: People index

The index is still a pure cache (never written, always rebuildable from the notes) but no longer
re-scans the vault when one note changes.

- **`models/PeopleIndexEntry.ts`** — the flat cached record: `path, id, name, display_name, photo, favorite,
  relationship_type, company, role, status, birthday, last_contacted, next_encounter, cadence, importance, tags`.
  Absent text → `""`, absent list → `[]`, absent date → `null`; wikilinks in `company` reduced to display text.
  Also `IndexChange` (`rebuild | upsert | remove | rename`).
- **`PeopleIndex`** keeps one record per note path holding both the entry and the `PersonView` the existing
  tabs use (`all()` is unchanged). New reads: `entries()`, `get()`, `getEntry()`, `findById()`, `has()`, `size`,
  `companies()`, `tags()`.
- **Initial scan** (`rebuild()`, run at layout-ready; also lazy on first read). Recognition: `type: person` (the
  configured value), or a `type/person` tag (list or string, `#` optional, nested `type/person/…` ok), or — for notes
  with no `type` at all — living in the people folder. A different `type:` value excludes the note unless it also
  carries the tag. Excluded folders are never indexed.
- **Incremental updates** — `upsert(file)`, `rename(file, oldPath)`, `remove(path)`, `removeUnder(folder)`; each
  touches one person. `watch()` wires them to Obsidian: metadata `changed` (covers created + modified, since
  frontmatter isn't readable at vault `create`/`modify` time), vault `rename`, vault `delete`. A note whose
  frontmatter didn't change (body-only edit, or the watcher repeating a repository write) is skipped silently.
  A moved/renamed folder triggers a rebuild; a deleted folder removes everyone under it.
- **`onChange(cb)`** notifies listeners with what changed. `main.ts` coalesces bursts (150 ms) into one redraw of
  the status bar and open views, replacing the old "invalidate everything + redraw" on every edit.
- **`PersonRepository`** now updates only the note it wrote (`create/update/rename/archive/restore/delete`) instead
  of invalidating the whole index.
- **Full rebuilds** remain for: settings changes, the *Refresh index* command, and the calendar day changing
  (countdowns/due dates are relative to today; the hourly tick redraws and the index re-scans itself).
- **Tests**: `tests/index.test.js` (19) — recognition, entry shape, incremental add/edit/rename/move/delete, folder
  rename/delete, no re-scan, no duplicate notifications, repository integration. The fake Obsidian now fires vault
  events like the real one.

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
