# PR #493, round 4 — the composer-foot debris and its fix

Two frames of the SAME scene in the same state (empty chat, provider connected,
`first-send-1380x900-empty`), shot on the built app against an isolated daemon
on 127.0.0.1:8080 (mock provider; the recipe is `docs/evidence/chat-connection-live/README.md`
in the PR, and `docs/agent-driver.md`).

- `composer-foot-before.png` — the defect, photographed by RE-INSERTING the two
  things the head merge `11f39c00f5` added to the composer's foot (the bare
  `=======` text child and the duplicated `What can I help you with today?`
  headline), rebuilt at the post-fold tip `ff866b638e`. The literal line paints
  to the left of the composer and the headline draws a second time inside the
  band, above the input box. `-band.png` crops the foot for close reading.
- `composer-foot-after.png` — the same scene on the tree that ships (the two
  lines removed, nothing else changed).

The scene's own checks pass 14/14 in BOTH states: the debris was invisible to
every assertion in the suite and only a frame shows it, which is why the pair is
here rather than a test change.

Falsification, the pair the fix is claimed on: re-insert -> frame shows both
symptoms (above); remove -> frame shows neither; `composer-tabs` 63/63 and the
`connection-drop` scene 24/24 on the same build.
