# People Hub — Changelog

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
