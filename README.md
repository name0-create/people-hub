# People Hub (Obsidian plugin)

A personal-CRM layer over your existing `40 - PEOPLE/People` notes. **The vault is the database**: the plugin only reads/writes frontmatter and Markdown. No hidden JSON store.

## Install (dev)
1. Copy this folder to `<vault>/.obsidian/plugins/people-hub/`
2. `npm install && npm run build` (produces `main.js`)
3. Enable **People Hub** in Settings → Community plugins.

## Architecture
```
Markdown notes (type: person)  ← single source of truth
        │  metadataCache (frontmatter)
        ▼
  PersonIndex (index.ts)   alias-tolerant parser → Person objects, cached, invalidated on change
        │
   ┌────┴─────────────┬──────────────┬─────────────┐
   ▼                  ▼              ▼             ▼
 Sidebar view      Commands      ```people```    Status bar
 (view.ts)         (main.ts)     code block      + startup notice
   Today / People / Birthdays / Meetings
        │ write-back
        ▼
 actions.ts: logInteraction, snooze, pause, createPerson (processFrontMatter + vault.process)
```
| Module | Role |
|---|---|
| `dates.ts` | Date + birthday parsing (`YYYY-MM-DD`, `--MM-DD`, `DD/MM/YYYY`), Feb-29 safe |
| `socials.ts` | Turns `instagram:`, `linkedin:`, `socials:` (list/map/URLs), `phone` → clickable links |
| `index.ts` | Reads frontmatter with aliases; computes due dates, birthdays, queries |
| `actions.ts` | All writes. Log entry appends under a heading and updates `last_contacted`, `times_met`, `next_encounter` |
| `view.ts` / `ui.ts` | Sidebar tabs, month calendar, row renderer |
| `modals.ts` | New person, Log interaction, person picker |

## Frontmatter it reads (aliases in order)
| Concept | Keys |
|---|---|
| name | `display_name`, `full-name`, `full_name`, `name`, `title`, file name |
| circle | `prm-tier`, `circle`, `tier` (inner/close/extended/professional) |
| paused | `prm-paused`, or `status: archived/inactive/lost/deceased/done` |
| cadence override | `frequency` / `cadence` (`14`, `2w`, `monthly`…) else tier default 7/14/30/60 d |
| last contact | `last_contacted` |
| next meeting | `next_encounter`, `next_encounter_place`, `next_encounter_purpose` |
| birthday | `birthdate`, `birthday`, `birth_date`, `dob` |
| socials | `instagram`, `linkedin`, `x_twitter`, `youtube`, `github`, `whatsapp`, … or `socials:` |
| snooze | `snoozed_until` (written by the ⋯ menu) |

**Reach-out logic:** due = `last_contacted + cadence` (or `snoozed_until`). Someone needs reach-out when active, due ≤ today, and no future `next_encounter` is already booked.

## Embedding in daily notes
````
```people
view: birthdays   # or reachout | meetings
days: 14
```
````

## Problems found in your current templates (worth fixing)
1. **`prm-paused: true` by default**: everyone would be paused. Set `false`.
2. **Tabs in `socials:`** are invalid YAML, so Obsidian drops the whole property. Use flat keys (`instagram:`) as the plugin's creator does.
3. **`name: "{{title}}"`** is never resolved (that's Core Templates syntax, not Templater). The plugin ignores unresolved placeholders; better to delete the line.
4. **Meta Bind fields bind to keys that don't exist in frontmatter**: `full_name` vs `full-name`, `first_encounter` vs `first_encounter_date`, `circle` vs `prm-tier`, `birthday` vs `birthdate`, `job_title` vs `role`, plus `whatsapp`/`city`/`map_link` missing. Result: birthdays typed into the body never reach the properties the plugin reads. Rename the `INPUT[...]` bindings to the frontmatter names.
5. **Six "What matters to them" fields all bind to `Interests`**: give each its own key (`current_focus`, `goals`, `cares_about`, `excited_about`, `struggling_with`).
6. **`Person Meetings Linked`** has an unclosed code fence and stray Tasks-query lines at the bottom.
7. **Interaction Log** uses numbered Meta Bind rows (`log_date1`, `log_date2`): doesn't scale. The plugin's *Log interaction* command appends bullets under `## 🕘 Contact History` instead.
8. Templater `placeEntity` may also create/move the note, so using it with the plugin's "Use Templater" toggle may double up. Prefer the built-in creator + a body template.

## v0.2 features

**Main page** — ribbon icon / *Open People Hub* opens a full-page **People** grid (search, sort, company + tag filters) with a **Calendar** tab. The sidebar is still available via *People Hub: Open sidebar*.

**Full-page calendar** — month grid with 🎂 birthdays and 📅 next meetings. Click a birthday to open the note, a meeting to edit it. *Export .ics* button in the toolbar.

**Edit-in-place next meeting** — every person card (main page) and the Today tab's *Meetings* section show a clickable meeting line. Click → date / time / topic → Save. Stored as:

```yaml
next_meeting: 2026-10-03T14:30   # or just 2026-10-03
next_meeting_note: Coffee at Java
```

**Birthday → daily note** — writes a block between `<!-- people-hub:birthdays -->` markers (safe to re-run; only that block is ever touched). Command: *Inject birthdays into this daily note*. Enable *Auto-inject* in settings to do it whenever today's daily note opens. Uses Obsidian's Daily Notes folder/format unless overridden.

**.ics export** — *Export birthdays & meetings (.ics)* writes `People Hub/people.ics` (configurable). Birthdays are yearly all-day recurring events (Feb 29 handled); meetings are timed 1-hour events. Import the file into Google/Apple/Outlook, or subscribe to it if you sync the vault somewhere reachable.

**Import contacts** — *Import contacts (.vcf / Google CSV)* (or the **Import** button on the People page). Reads vCard 2.1/3/4 (iPhone, Android, Google, Outlook) and Google Contacts / Google Workspace CSV. Detects duplicates by name / email / phone, previews, then creates one note per contact in your People folder. Imported people get `last_contact: today` and `frequency: quarterly`, so they don't flood your reach-out list.

## v0.3 — inspired by [obsidian-personal-crm](https://github.com/xuvi7/obsidian-personal-crm)

**Last contact from your notes** — a `[[Person]]` link in a dated note (daily note, or any note with a `date` frontmatter field) counts as an interaction, so `last_contact` no longer needs manual entry. Ignored: links in unchecked/cancelled to-dos (`- [ ]`), block quotes, embeds (`![[…]]`), code, and the person's own note. A completed `- [x]` counts. Effective last contact = most recent of the note mention and `last_contact`. A `next_contact` on or before the last contact is treated as used up. Only Obsidian's metadata cache is read, never the disk. Settings → *Last contact from your notes* shows how many people it found.

**Reach-out queue** — command *Who should I reach out to?* (also a button on the Today tab and the People page). Walks through everyone overdue, most overdue first, one at a time: overdue days, last contact (and which note it came from), recent mentions, wants/interests/last talk, and an excerpt of their note (Meta Bind fields and empty template lines are filtered out). Actions: **Log talk** (L), **Contacted today** (T), **Snooze** 7d (S) / 1d / 3d / 30d, **Open note** (O), **Pause** (P), **Skip** (Space / →), **Back** (←).

## Roadmap
- **v0.1 (this)**: index, sidebar (Today/People/Birthdays/Meetings), month calendar, log/snooze/pause, new person, code block, status bar, startup notice
- **v0.2**: birthday → daily-note injection; `.ics` export; full-page calendar tab; edit-in-place next meeting; import from `.vcf`/Google Contacts CSV
- **v0.3**: promises/open-loops roll-up across all people; "gone quiet" trend; relationship graph (à la people-graph); groups/families; photo avatars
- **v0.4**: mobile polish, push-style reminders via Reminder/Tasks integration, per-person cadence editor in sidebar

## Caveat
Written without access to the Obsidian typings or a live vault (sandbox has no network), so run `npm run build` first and expect to fix a few type nits.
