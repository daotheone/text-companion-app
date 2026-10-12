# ADR 0002: Data Storage and Midnight Reset

## Status
Accepted; amended for the calendar feature. This decision supersedes the earlier underscore-key list and single-note/reset contract.

## Context
Daily habits need persistent per-day completion history, and notes now belong to individual dates. Existing deployments store arrays and a raw-text scratchpad in browser `localStorage`. Migration must preserve that data without a backend or login.

## Decision

Use browser **`localStorage`** with deployed hyphenated keys:

- `text-companion-daily-tasks`: JSON `DailyTask[]`, including `completionHistory: string[]`.
- `text-companion-todo-items`: JSON `TodoItem[]`; `createdAt` remains a Unix timestamp. The add form encodes its selected todo date as a local timestamp; calendar groups timestamps by local day.
- `text-companion-daily-notes`: JSON `Record<string, string>` mapping date to note content. `DailyNote` remains the domain concept `{ date, content }`, not the storage-array shape.
- `text-companion-note`: legacy raw scratchpad text, removed only after successful migration.
- `text-companion-note-migration`: temporary durable journal `{ date, source, content }` for retrying legacy-note migration across interruption or a day boundary.

### Local days and completion

Use validated local `YYYY-MM-DD` everywhere: migration's today, note selection, history, todo grouping, and calendar helpers. Never derive date keys with UTC serialization. Month indices are zero-based and all calendar weeks begin Monday.

Completing a habit adds today once. Undo removes today only, preserving earlier history. `isCompleted` is derived from today's presence in history; `lastCompletedDate` is the latest history date or `null`. Habits are undated daily definitions, not scheduled events.

Refresh on initialization, at the next local midnight, on focus or visible-tab return, and on a periodic local-day/timezone check while open. Recompute and reschedule after date/timezone changes. Reset only today's completion state; retain history and never reinterpret stored day strings as UTC instants.

### Safe migration and writes

Validate all existing stored collections before changing them. Missing history is backfilled from a valid `lastCompletedDate`; empty legacy dates become `null`. Invalid data stays untouched and blocks automatic overwrite until the user can retry after repair.

Migrate raw scratchpad text into today's note record. Preserve existing content; if both contents are nonempty, concatenate existing content, a blank line, then legacy content. Persist the journal before changing the destination, and persist the destination successfully before removing the legacy key. Journal/recovery must make retries idempotent, including interruption between destination write and legacy deletion and reopening on a later day. Remove the journal after migration completes.

Any storage failure retains recoverable source data, keeps unsaved editor content available, and displays an error with retry. A failed write must never be presented as saved. Browser quota, corruption, and disabled storage are explicit failure paths, not reasons to replace user data with defaults.

## Consequences

- No backend dependencies or account logins; data remains local to this browser.
- Calendar, Companion, and notes share one local-day contract, including midnight and timezone changes.
- Local storage lacks transactions. A small migration journal and failure/retry checks are required to avoid duplicated or lost legacy notes.
- Existing UTC-derived history dates cannot be reliably reconstructed into historical local dates; preserve recorded strings rather than guess.
