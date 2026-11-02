# Agent summary portrait - rendered evidence

Frames for the selected-agent summary portrait PR (branch fix/agent-summary-portrait, head e184c78).
Captured with the harness browser from one Storybook dev server on that branch's source
(features-agents-agent-avatar--summary-portrait-*), theme via &args=theme:<id>.

- after-*: the branch's agent-detail.tsx.
- before-*: the same stories with base 910ee246's agent-detail.tsx swapped in for the capture only, then restored.

Limits: Storybook, not the packaged app. Loading and decode-error states come from the story's stubbed image loader, not a live daemon.
