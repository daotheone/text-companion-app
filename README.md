# Text Companion App

Minimalist, typography-first productivity app built with Vite, React, and TypeScript. Data stays in browser `localStorage`; no accounts or backend.

## Product

Calendar is the main screen, with Monday-first month and week views. Each day shows completed-habit count, up to three todo titles plus overflow, and an indicator for a nonempty daily note. Clicking a day opens a 320px detail panel over the calendar: completed habits, todos, and read-only note. Titles can be edited inline; deleting an item removes that whole item, including a habit's history, immediately without confirmation.

A fixed 320px sidebar holds four initially expanded, collapsible sections:

- **Companion:** Random greeting with the first incomplete habit; `[Yes, done]` completes it and `[Skip for now]` cycles incomplete habits. Once habits are done, suggest the first incomplete todo. When both lists are complete, show “All caught up for today. Take a breather.”
- **Daily Habits:** Add, toggle, and delete recurring habits. Completing records today; undo removes only today's completion. Earlier history survives midnight.
- **To-Do:** Add, toggle, and delete one-off tasks. Completed items move below incomplete items and are struck through.
- **Notes:** Per-day editor with its own previous/next-date selector and keystroke autosave. “All notes” opens a scrollable date/preview dialog; selecting an entry jumps the note editor to that day.

`[+ add]` opens a title/type form. Date is editable for todos only: sidebar defaults to today, while adding from a selected day defaults to that day. Habits are undated daily definitions, not scheduled events. Todo's selected date is represented by a local timestamp in the existing `createdAt` field; calendar groups that timestamp by local date.

## Data contract

| Domain concept | Attributes | Persistence |
| --- | --- | --- |
| `DailyTask` | `id`, `title`, `isCompleted`, `lastCompletedDate`, `completionHistory: string[]` | JSON array at `text-companion-daily-tasks` |
| `TodoItem` | `id`, `title`, `isCompleted`, `createdAt: number` | JSON array at `text-companion-todo-items` |
| `DailyNote` | `date`, `content` | `Record<string, string>` mapping date to content at `text-companion-daily-notes` |
| `Note` | Legacy single scratchpad | Raw text at `text-companion-note`, migrated once |

All date keys use validated local `YYYY-MM-DD`, never UTC serialization. Month indices are zero-based; weeks start Monday. `completionHistory` contains unique local day strings. `isCompleted` reflects whether today is in history; `lastCompletedDate` is the latest history date or `null`. A midnight timer and initialization/focus/visibility/periodic checks refresh today's state, including after timezone changes. Stored history strings remain unchanged when timezone changes.

On load, validate stored shapes before changing them. Legacy habits missing history receive their valid `lastCompletedDate` as history; empty legacy dates normalize to `null`. Migrate raw legacy note into today's record entry. If both contents are nonempty, preserve existing content followed by a blank line and legacy content. Persist destination successfully before removing source; retry must not duplicate content, including after a crash between write and removal. Invalid data or storage failures retain original data and show a visible error with retry. Full storage/reset decision: [ADR 0002](docs/adr/0002-data-storage.md).

## Interface and accessibility

Warm off-white background, charcoal text, generous spacing. No icons, heavy shadows, rounded-card clutter, flashy motion, or complex menus. Sidebar scrolls as a whole; detail panel and all-notes list scroll internally. Note editor fills available sidebar space without trapping section scrolling.

Use labeled native controls, keyboard-operable day buttons and collapse headers, visible focus, and descriptive previous/next labels. Modal dialogs have an accessible name, initial focus, focus containment, Escape/Close dismissal, and focus restoration to the opener. Respect reduced-motion preferences for panel transitions.

Desktop-first scope. No drag-and-drop, custom recurrence, separate calendar events, day view, accounts, or server sync; existing daily habits still recur.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

`npm test` runs focused checks for local dates, habit undo/reset, schema validation, and retry-safe migration. `npm run build` typechecks and builds production artifacts. Browser checks use Playwright's Chromium:

```sh
npx playwright install chromium
# With npm run dev running at http://127.0.0.1:5173:
npm run test:browser
```

Set `APP_URL` to test a different running app URL.

## Implementation order

[Issue #1](https://github.com/daotheone/text-companion-app/issues/1) is the live map; native GitHub dependencies gate its tickets. Land local-date helpers and domain types before migration; then integrate history/reset and sidebar/notes before final calendar acceptance. Detail-panel display belongs to #10; edit/delete belongs only to #16. Keep acceptance items unchecked until implementation is verified.
