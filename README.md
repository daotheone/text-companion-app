# Text Companion App

Minimalist, typography-first productivity app built with Vite, React, and TypeScript. Email/password login uses Supabase Auth; habits, tasks, and notes persist privately per user in Supabase Postgres.

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
| `DailyTask` | `id`, `title`, `isCompleted`, `lastCompletedDate`, `completionHistory: string[]` | `companion_data.data.dailyTasks` JSON array |
| `TodoItem` | `id`, `title`, `isCompleted`, `createdAt: number` | `companion_data.data.todos` JSON array |
| `DailyNote` | `date`, `content` | `companion_data.data.notes` date/content object |
| `Note` | Legacy single scratchpad | Explicit browser import only |

All date keys use validated local `YYYY-MM-DD`, never UTC serialization. Month indices are zero-based; weeks start Monday. `completionHistory` contains unique local day strings. `isCompleted` reflects whether today is in history; `lastCompletedDate` is the latest history date or `null`. A midnight timer and initialization/focus/visibility/periodic checks refresh today's state, including after timezone changes. Stored history strings remain unchanged when timezone changes.

Supabase owns one versioned snapshot per user, protected by row-level security. Writes are serialized and transactionally compare the last loaded version; request IDs make retry after a lost acknowledgement safe. “Saved to Supabase” appears only after acknowledgement. Invalid data and network failures never fall back to an empty saved snapshot. Unsaved work remains in this tab; retry or export changes before reloading. Conflicting edits from another tab/device require export and reload, not silent overwrite. Snapshots are limited to 1 MiB; no realtime merge or durable offline queue.

A new account with no cloud row offers `[Import browser data]`. Confirm only for a browser containing your data. Import validates and migrates an in-memory copy of old `text-companion-*` keys, including legacy habit history and scratchpad text. Existing daily-note content is preserved before legacy text; original browser keys are never removed or changed. Import cannot replace an existing cloud row. Decisions: [ADR 0002](docs/adr/0002-data-storage.md) and [ADR 0004](docs/adr/0004-supabase.md).

## Interface and accessibility

A square theme icon beside the app name cycles System (default), Light (warm off-white), and Dark (soft warm charcoal), remembering this browser's choice across tabs independently of accounts and cloud data. Its tooltip and accessible label describe the current theme and next choice. No heavy shadows, rounded-card clutter, flashy motion, or complex menus. Sidebar scrolls as a whole; detail panel and all-notes list scroll internally. Note editor fills available sidebar space without trapping section scrolling.

Use labeled native controls, keyboard-operable day buttons and collapse headers, visible focus, and descriptive previous/next labels. Modal dialogs have an accessible name, initial focus, focus containment, Escape/Close dismissal, and focus restoration to the opener. Respect reduced-motion preferences for panel transitions.

Desktop-first scope. No drag-and-drop, custom recurrence, separate calendar events, or day view; existing daily habits still recur.

## Supabase setup

1. Create a Supabase project. Run [0001_companion.sql](supabase/migrations/0001_companion.sql) once in its SQL Editor, or apply it using the Supabase CLI. This creates the table, owner-only read policy, and validated write function; do not disable RLS or grant direct table writes.
2. Copy [`.env.example`](.env.example) to `.env.local`. Set `VITE_SUPABASE_URL` to the **project origin**, such as `https://<project-ref>.supabase.co`, not a Data API endpoint ending in `/rest/v1/` or an Auth endpoint. Set `VITE_SUPABASE_PUBLISHABLE_KEY` to its **publishable** key. Legacy `VITE_SUPABASE_ANON_KEY` also works. Never use `service_role` or secret keys: Vite embeds these values in public browser code.
3. In Supabase Authentication, enable Email/password. Set the Site URL and allowed redirect URLs to your app origins, including `http://localhost:5173` for local development and your production origin. With email confirmation enabled, signup asks users to confirm email before login.
4. Run `npm install` and `npm run dev`. Create an account, confirm email if required, then log in. Set the same public environment variables in your deployment build and rebuild after changing them.

Missing or invalid configuration displays setup instructions before any auth request. HTTPS project origins (including custom domains) are supported; HTTP is limited to `localhost`, `127.0.0.1`, and `[::1]` for local Supabase. An exact `/rest/v1` or `/rest/v1/` suffix is normalized to the origin; other paths, URL credentials, queries, and fragments are rejected. A public key's validity still requires Supabase to check it.

For Vercel, set `VITE_SUPABASE_URL` to `https://<project-ref>.supabase.co` and the matching public key in the environment used by the deployment, then **redeploy**: Vite embeds configuration at build time. Changing only a key cannot fix a bad URL. Before this fix, a Data API URL produced `/rest/v1/auth/v1/signup`; PostgREST returned `404 PGRST125: Invalid path specified in request URL`. The normalized request uses `/auth/v1/signup`. No database migration or RLS change is needed. After deployment, verify signup with an authorized test account in both email-confirmation modes as applicable; mocked tests and read-only health probes do not verify real account creation or email delivery.

Logout is blocked while saves are pending; failed saves offer retry and JSON export. Logout affects this browser session only. If another tab logs out or changes accounts, the previous workspace stays visible but read-only so you can export unsaved changes before continuing.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

`npm test` runs checks for Supabase configuration/request paths, local dates, habit undo/reset, schema validation, source-preserving import, serialized cloud saves, retry IDs, conflicts, and account disposal. `npm run build` typechecks and builds production artifacts. Browser checks use mocked Supabase HTTP routes (no real credentials) and Playwright's Chromium:

```sh
npx playwright install chromium
# Start Vite with mock public configuration in one terminal:
VITE_SUPABASE_URL=https://test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key npm run dev -- --host 127.0.0.1
# In another terminal:
npm run test:browser
```

Browser checks also cover theme startup before React, OS changes, overrides, tab sync, storage failures, rendered contrast, dialogs, and data preservation; `SCREENSHOT_DIR` saves light/dark evidence and `CONFIG_ONLY=1` checks an unconfigured shell. Set `APP_URL` to test a different running app URL. Browser checks cover immediate-session signup, confirmation-required signup, login, restored/refreshed sessions, and DailyTask/TodoItem/DailyNote isolation. To replay issue #17 specifically, start Vite with `VITE_SUPABASE_URL=https://test.supabase.co/rest/v1/` and the same mock public key, then run `APP_URL=http://127.0.0.1:5173 node tests/signup-path.test.mjs`. The mocked gateway returns the exact reported `PGRST125` error for a malformed signup path; no real account is created.

## Implementation order

[Issue #1](https://github.com/daotheone/text-companion-app/issues/1) is the live map; native GitHub dependencies gate its tickets. Land local-date helpers and domain types before migration; then integrate history/reset and sidebar/notes before final calendar acceptance. Detail-panel display belongs to #10; edit/delete belongs only to #16. Keep acceptance items unchecked until implementation is verified.
