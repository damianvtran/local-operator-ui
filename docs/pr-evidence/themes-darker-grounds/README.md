# Darker dark grounds — before/after frames

Storybook frames captured through the harness `browser` tool (one tab, 2560×1440
device pixels, downscaled to 1280×720 per side). Two Storybooks ran side by side,
each under `scripts/with-storybook.mjs` and reaped on exit:

- **before**: a detached worktree at `origin/main` `34b61d19316`, on port 6431;
- **after**: this branch, on port 6432.

Every frame is `?id=<story>&viewMode=story&args=theme:<id>`, and the same
stories were used on both sides.

| set | stories | themes |
|---|---|---|
| `chat-measure__*` | `Chat/Measure` → `Transcript` | localOperatorDark, radient, dracula, nord, catppuccinMocha, tokyoNight, localOperatorLight |
| `team-bridge-page__*` | `Team Bridge/Page` → `ChannelSelected` | the same seven |
| `library-tab__*` | `Library/Tab` → `InShell` | localOperatorDark, localOperatorLight |

**Why Library has two themes only.** `library.stories.tsx` declares its own
`theme` options as just the brand pair (`THEME_IDS`, line 42), so Storybook drops
any other `args=theme:` value. Measured: `--lo-canvas` on `html` stays at
localOperatorDark's value for `args=theme:nord` and `args=theme:dracula`. The
designer's before-frames show the same behaviour (`library-tab--in-shell__radient`
paints localOperatorDark). It predates this branch and is not touched here.

**Light control.** The light CSS blocks are byte-identical (18/18, see the PR
body). In the light frames, `chat-measure` is pixel-identical (0 differing
pixels). The `library-tab` and `team-bridge-page` light frames differ only where
the story itself is not deterministic:
- the Library image thumbnail had not decoded in the before frame;
- Team Bridge's composer kept a draft (`@Ai@Ai`) from an earlier interaction in
  the before tab;
- the clock-relative timestamps differ.

Measured: no ground, ink or accent colour differs between the two light frames.
