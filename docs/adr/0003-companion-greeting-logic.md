# ADR 0003: Companion Greeting and Interaction Logic

## Status
Accepted

## Context
The primary user interaction centers around a conversation with the Companion prompt. The conversation should feel fluid, helpful, and natural, guiding the user progressively through their day.

## Decision
We implement a three-state evaluation engine for the Companion:

1. **State 1 (Incomplete Habit):** If there are incomplete daily habits, select the first one and display: `"[Randomized Greeting], did you [Daily Task] today?"`.
   - Interactions: Clicking `[Yes, done]` marks the habit as completed for today. Clicking `[Not yet]` (or `[Skip for now]`) dynamically cycles the companion to display the next incomplete habit in the queue.
2. **State 2 (Habits Completed, Todos Remain):** If all daily habits are done, but incomplete To-Dos remain, display: `"Daily tasks complete. Maybe you can check on [First Incomplete To-Do Item]?"`.
3. **State 3 (Everything Done):** If all habits and to-dos are done, display: `"All caught up for today. Take a breather."`.

The Greeting Pool is configured as: `["Hello", "Hi there", "Good to see you", "Welcome back"]` and randomized dynamically.

## Consequences
- Clean, focused prompts that gently guide user attention without overwhelming them.
- Straightforward text actions (`[Yes, done]` / `[Not yet]`) that drive state transitions instantly.
