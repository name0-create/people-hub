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

## Roadmap
- **v0.1 (this)**: index, sidebar (Today/People/Birthdays/Meetings), month calendar, log/snooze/pause, new person, code block, status bar, startup notice
- **v0.2**: birthday → daily-note injection; `.ics` export; full-page calendar tab; edit-in-place next meeting; import from `.vcf`/Google Contacts CSV
- **v0.3**: promises/open-loops roll-up across all people; "gone quiet" trend; relationship graph (à la people-graph); groups/families; photo avatars
- **v0.4**: mobile polish, push-style reminders via Reminder/Tasks integration, per-person cadence editor in sidebar

## Caveat
Written without access to the Obsidian typings or a live vault (sandbox has no network), so run `npm run build` first and expect to fix a few type nits.
