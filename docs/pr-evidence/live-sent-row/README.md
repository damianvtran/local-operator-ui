# Live sent-message file card — before and after

Two runs of the same dev-driver scene (`--scene attach`) against one isolated
daemon (installed runtime 0.89.0, scratch HOME/config, OpenRouter model), same
2-page PDF fixture, same prompt flow. Only the app build differs.

- `before-live-sent-without-card.png` — app built at `73f881b533^`: the new
  message ("Which page holds the vault code?") is on screen with no file card;
  the assistant answered from the document. The card above it is a history
  replay of an earlier message, which is why it has one.
- `after-live-sent-with-card.png` — app built at `73f881b533`: the same new
  message shows the `fixture.pdf` card (name, `PDF · 914 B`, path) **while the
  turn is still the last thing on screen**, with no conversation switch.

Both frames were taken by the driver's own `attach-sent` capture, 1380×900,
after the turn settled.
