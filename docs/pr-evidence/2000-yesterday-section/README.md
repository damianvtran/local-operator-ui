# PR 2000 - Yesterday section, before / after

Fixture (identical for both builds): TZ America/New_York, frozen now = 2026-11-19 12:00 EST (Date shimmed over CDP, advances in real time).
Rows (sessions.list mtime): running 11:55 today; today 00:05; yesterday 23:50; yesterday 09:00; 3 days ago; 5 days ago; 8 days ago.

- before = origin/main b399830d8f: the three changed modules (chat-list-sections.ts, chat-sidebar-view.ts, components/chat-sidebar.tsx) are the `git show b399830d8f:<path>` bytes, served in place of the PR worktree's copies by a Vite `load` hook (BEFORE=1). Everything else is the PR tree.
- after = PR head 943d6f7203.
- Rig: Storybook 8.6 dev server (real ChatSidebar, stubbed window.api.desktop.request), private headless Chrome 157 over CDP, DPR 2, not packaged Electron.

Files: 01 before / 02 after chat list; 03 after with no yesterday row (heading absent); 04/05 View popover before/after (Sections list gains "Yesterday 2"). rig/ holds the exact config, story and capture script (as .txt).
