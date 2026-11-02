# Round-1 remediation frames

Head 24b1531 of fix/agent-summary-portrait, same Storybook stories and harness browser as the parent directory.

- after-{no-image,loading,error}{,-narrow}-{dark,light}: the shared AgentMark plate (design D1).
  Within one width and theme the three states are byte-identical frames, which is the point of D1; each was
  captured only after its own play check proved that state from request/decoder evidence.
- before-populated-narrow-dark: recaptured for design D2 (the round-0 file was a Storybook loading spinner),
  base 910ee246's agent-detail.tsx swapped in for that capture only, then restored.
