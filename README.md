# People Hub — Obsidian Plugin

Personal CRM built around your Carnegie system. Every piece of data lives in your Markdown notes. The plugin reads and writes frontmatter only — no hidden databases.

---

## Install

```
<vault>/.obsidian/plugins/people-hub/
├── main.js          ← compiled output (run npm build)
├── manifest.json
├── styles.css
```

```bash
cd people-hub
npm install
npm run build     # → main.js
```

Then enable in **Settings → Community plugins → People Hub**.

---

## File structure

```
src/
├── @types/
│   ├── obsidian.d.ts       # ambient shim — Obsidian module types
│   └── dom-obsidian.d.ts   # global DOM augmentations (createEl, createDiv …)
├── core/
│   ├── settings.ts         # PeopleHubSettings + PeopleSettingTab
│   ├── folder-service.ts   # FolderService — single gatekeeper for all paths
│   ├── dates.ts            # Date parsing + birthday/anniversary logic
│   └── socials.ts          # Social link normaliser
├── models/
│   └── person.ts           # Pure types: Person, CarnegieScores, AnniversaryInfo …
├── repository/
│   ├── person-repository.ts  # PersonRepository — index + all queries
│   └── person-actions.ts     # All write operations
├── views/
│   ├── sidebar-view.ts     # PeopleView — Today / People / Birthdays / Carnegie tabs
│   ├── quick-log-sheet.ts  # QuickLogSheet + SwipeHandler
│   ├── modals.ts           # LogModal, CarnegieModal, NewPersonModal, PersonPicker
│   └── ui.ts               # Row renderer, meta strings, Carnegie bar
└── integrations/
    └── quickadd.ts         # QuickAdd macro bridge + user-script export
```

### Architecture rules (Phase 1 spec)

1. **Markdown = source of truth.** The index is a cache; it is invalidated on every vault change.
2. **No hard-coded paths.** Every folder is accessed through `FolderService`. Settings expose four configurable folders.
3. **`FolderService` is the only path gatekeeper.** Nothing else reads `settings.peopleFolder` directly.
4. **`PersonRepository` owns all queries.** Views call it; they do not filter the raw list themselves.
5. **`PersonActions` owns all writes.** Every `processFrontMatter` / `vault.process` call for person files lives there.

---

## Frontmatter it reads

| Concept | Keys (in priority order) |
|---|---|
| Name | `name`, `display_name`, `full_name`, `title`, file name |
| Type | `type_person` |
| Tier | `prm-tier`, `circle`, `tier` — derived from `type_person` if absent |
| Status | `status` |
| Last contact | `last_contact`, `last_contacted` |
| Next contact | `next_contact`, `next_encounter`, `next_action_date` |
| Frequency | `frequency` |
| Birthday | `birthday`, `birthdate`, `birth_date`, `dob` |
| Anniversary | `anniversary`, `friendiversary`, `wed_date`, `anniversary_date` |
| Anniversary label | `anniversary_label`, `anniversary_type` |
| Health / Trust | `health_score`, `trust_score` |
| Carnegie | `c1_score` … `c9_score` (0–5) |
| Promises | `promises_made`, `promises_kept` |
| Socials | `ig`, `linkedin`, `youtube`, `x_twitter`, `phone`, or nested `socials:` |
| Talk log | `talk1_date/note/learned/next/where/presence/energy` … `talk5_*` |
| Snooze | `snoozed_until` (written by the ⋯ → Snooze menu) |

---

## Sidebar tabs

### Today
| Section | What it shows |
|---|---|
| 🎂 Birthday today | People whose birthday is today |
| 💍 Anniversary today | People whose anniversary is today |
| 🎂 Upcoming · Nd | Birthdays within the configured look-ahead |
| 💍 Upcoming · Nd | Anniversaries within the configured look-ahead |
| 📞 Reach out | Everyone overdue, sorted by most overdue then tier |
| ⚠️ Carnegie avg < 3 | People needing relationship work |
| 🤝 Promises < 80% | People with low promise-kept ratio |

**Swipe right** on any person in the "Reach out" section to open the quick-log sheet. Or tap the **📝** icon.

### People
Searchable list. Filter by tier or "Due now". Shows type, frequency, last-contact age, health score, Carnegie bar, social links. Swipe-to-log works here too.

### Birthdays
- Month calendar with chips (birthday = accent, anniversary = purple)
- Next 60 days — birthdays and anniversaries
- "No birthday / anniversary on file" lists

### Carnegie
- 3×3 grid: average score per principle across all active people
- People below avg 3 — needs work this week
- Full sorted table, worst first — tap **View** for the C1–C9 breakdown modal

---

## Quick-log sheet (mobile)

Opens from swipe-right or the 📝 icon. Optimised for one-handed use:

1. **Type chip strip** — scrollable row of log types (call, whatsapp, coffee, lunch, walk, home-1on1, video, message, email). Large tap targets.
2. **Date** — defaults to today.
3. **Note** — free-text area.
4. **▸ More** — collapses/expands: Where, Learned, Agreed next, Presence /5, Energy /5, Carnegie toggles (C2/C4/C7).
5. **Save** — logs the talk, rotates `talk1`…`talk5` in frontmatter, updates `last_contact`, appends a bullet under `## Talks Log`.

---

## QuickAdd integration

**Pattern A — Execute macro** (recommended):
1. Create a QuickAdd macro named e.g. `New Person` with your Templater template choice inside it.
2. In People Hub settings: enable **QuickAdd**, set **Macro name** to `New Person`.
3. The **+** button and **New person** command will now run your macro.

**Pattern B — User script**:
1. In QuickAdd → User scripts, point to `people-hub-qa-script.js` (copy from the build output).
2. The script calls `plugin.newPerson()` which falls through to the built-in modal.

If QuickAdd fails (plugin not found, wrong macro name), People Hub falls back to the built-in creator silently.

---

## Commands

| Command | Description |
|---|---|
| Open People Hub | Focus/open the sidebar |
| People Hub: Today | Jump to Today tab |
| People Hub: Birthday calendar | Jump to Birthdays tab |
| People Hub: Carnegie scores | Jump to Carnegie tab |
| People Hub: New person | QuickAdd → Templater → built-in modal |
| People Hub: New person via QuickAdd | Macro directly, then built-in |
| People Hub: Log talk | Full log modal (active note or picker) |
| People Hub: Quick-log (one-tap sheet) | Bottom sheet (active note or picker) |
| People Hub: Carnegie for active note | C1–C9 modal |
| People Hub: Insert reach-out list | Paste bullets into editor |
| People Hub: Insert upcoming birthdays | Paste bullets into editor |
| People Hub: Insert upcoming anniversaries | Paste bullets into editor |
| People Hub: Refresh index | Force re-scan |

---

## `people` code block

````
```people
view: reachout
```

```people
view: birthdays
days: 14
```

```people
view: anniversaries
days: 7
```

```people
view: carnegie
```
````

---

## Status bar

`🎂2 💍1 📞5 ⚠️C1` — birthdays today · anniversaries today · reach-out count · low Carnegie count. Click to open the Today tab.

---

## Phase roadmap

| Phase | Status | Summary |
|---|---|---|
| 0 | ✅ | Product contract, source-of-truth doc, schema |
| 1 | ✅ | Stable foundation: zero TS errors, FolderService, clean module tree, v0.2 features |
| 2 | — | Main window (full-page person list/cards, profile pane) |
| 3 | — | Promises roll-up, "gone quiet" trend, weekly Trigger Sweep note |
| 4 | — | People graph, groups (family/team/clients) |
| 5 | — | `.vcf` / Google Contacts / LinkedIn CSV import; `.ics` birthday export |
