# ADR 0001: Tech Stack Selection

## Status
Accepted

## Context
The Text Companion App must be a lightning-fast, distraction-free, and typography-focused Single Page Application (SPA). We need a tooling and framework combination that supports robust reactive state management, excellent type safety, and minimal build overhead.

## Decision
We select **Vite + React + TypeScript** as our core frontend technology stack.

## Consequences
- **Vite** delivers near-instant development start times and highly optimized, zero-bloat production builds.
- **React** allows us to construct clean, modular components for managing task state, greeting states, and overlays reactively.
- **TypeScript** enforces reliable, type-safe data schemas (`DailyTask`, `TodoItem`, `Note`) on load, write, and storage actions.
