# Design Document: Text Companion App

## 1. Product Overview

**Name:** Text Companion (Placeholder)
**Concept:** A minimalist, distraction-free productivity app that uses a conversational text interface to guide the user through daily habits, one-off tasks, and quick thoughts.
**Design Philosophy:** Typography-focused. No icons, no flashy animations, no complex menus. Just plain text that feels like a quiet, organized assistant.

---

## 2. Core Features & Logic

### A. The Companion (Daily Planner & Dynamic Greeting)
This is the main screen of the app. It reads the state of the user's tasks and displays a single, focused text prompt.

*   **Greeting Pool:** An array of randomized text strings (e.g., "Hello", "Hi there", "Good to see you", "Welcome back").
*   **Logic Flow:**
    1.  **Check Daily Habits:** The app checks the list of recurring daily tasks (e.g., "drink water", "read 10 pages").
    2.  **State 1 (Incomplete Habit):** If a daily habit is unchecked, display: `"[Greeting], did you [Daily Task] today?"` (e.g., *"Hello, did you drink water today?"*). The user can click a "Yes" or "Not yet" text button.
    3.  **State 2 (Habits Done, Todos Remain):** If all daily tasks are done, but the To-Do list has items, display: `"Daily tasks complete. Maybe you can check on [To-Do Item]?"`
    4.  **State 3 (Everything Done):** If both lists are empty/completed, display: `"All caught up for today. Take a breather."`

### B. To-Do List
A standard task tracker for non-recurring items.
*   **Actions:** Add new item, Mark as complete, Delete item.
*   **Display:** A simple vertical text list. Completed items are moved to the bottom and struck through.

### C. Floating Notes
A frictionless scratchpad for transient thoughts.
*   **Access:** Always accessible via a subtle "Notes" text button pinned to the corner of the screen.
*   **Behavior:** Clicking it expands a text area overlay (modal or slide-out). It auto-saves on every keystroke.
*   **Data:** Just one single continuous text block (no complex folders or multiple files needed for V1).

---

## 3. Data Architecture (Local Storage)

To keep this simple and fast, all data should be saved directly to the device (e.g., browser `localStorage` or local device storage), avoiding the need for a database or user logins.

### Data Models

| Entity | Attributes | Description |
| :--- | :--- | :--- |
| **DailyTask** | `id`, `title`, `isCompleted`, `lastCompletedDate` | Recurring habits. Resets at midnight based on `lastCompletedDate`. |
| **TodoItem** | `id`, `title`, `isCompleted`, `createdAt` | One-off tasks. |
| **Note** | `content`, `lastEdited` | A single string of text for the floating scratchpad. |

---

## 4. User Interface (UI) Layout

Because this is a "text-only" app, spacing and typography are your primary design tools.

**Main Screen Structure:**
1.  **Top Right:** A small `[Notes]` text button.
2.  **Center Screen (The Companion):** Large, prominent text displaying the current dynamic prompt. Below it, small text links to interact (e.g., `[Yes, done]` / `[Skip for now]`).
3.  **Bottom Half (The Lists):**
    *   Two side-by-side or stacked text columns: **Daily Habits** and **To-Do List**.
    *   Input field at the bottom of the To-Do list: `> type a new task and press enter...`

**Floating Notes State:**
*   When `[Notes]` is clicked, a semi-transparent overlay covers the screen with a large, borderless `<textarea>`. A `[Close]` text button sits at the top right.

---

## 5. Implementation Phases

*   **Phase 1: State & Storage:** Set up the basic data structures and ensure they save/load from local storage correctly.
*   **Phase 2: The Logic Engine:** Write the if/else logic for the Companion Greeting. Ensure it accurately reads the arrays from Phase 1 to pick the right sentence.
*   **Phase 3: UI & Typography:** Build the minimalist front-end, hook up the text buttons to the data state, and implement the floating note overlay.
