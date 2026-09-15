# Reference images — composer suggestions and the tip row

Provenance for the images beside [`../../composer-suggestions.md`](../../composer-suggestions.md).
Each file is a real capture that was fetched, opened and checked before being
saved here. Where the source is a repository asset, the URL is the file's own
URL, not the page that links it.

| File | What it is | Source URL | Origin |
| --- | --- | --- | --- |
| `ref-codex-cli-splash.png` | The Codex CLI splash: a bordered model/directory header, a one-line `Tip:` sentence, and a single-row composer with a `›` prompt and no edge of its own. 1898x1190. | `https://raw.githubusercontent.com/openai/codex/main/.github/codex-cli-splash.png` | openai/codex, `README.md` |
| `ref-claude-code-composer.png` | Frame 413 of 414, extracted from the project's committed demo. The composer as a single `>` row inside one low-contrast edge, with a quiet status line beneath it. 1552x992. | `https://raw.githubusercontent.com/anthropics/claude-code/main/demo.gif` | anthropics/claude-code, `README.md` |
| `ref-gemini-cli-welcome.png` | The Gemini CLI welcome state: suggestions as a plain numbered list under `Tips for getting started:`, then a `>` composer with a dim placeholder and a dim status footer. 1089x582. | `https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/assets/gemini-screenshot.png` | google-gemini/gemini-cli, `docs/` |
| `ref-tui-welcome-tip-row.png` | This product's own TUI welcome view: the rotated tip line (`· /resume picks up a recent session where you left off`) as the last line of the splash block, directly above the input card. Copied unmodified from the product's committed capture; the 1024x384 size is this tooling's downscale of the 2824x1060 original. | `~/local-operator/static/tui-welcome.png` | local-operator (this machine) |

## What is not here

No reference was captured from `developers.openai.com`, `claude.com`,
`www.raycast.com`, `linear.app` or `www.warp.dev`. The `browser` tool raised
site-approval prompts for those origins and nobody was at a screen to approve
them, so they are blocked for this pass and no image from them is claimed
anywhere in the design document. `github.com` and `raw.githubusercontent.com`
were already approved, which is why every capture above comes from a project's
own repository.

No image here is a mock of the recommended direction. The direction is not
rendered; § 7 of the document says so and gives the geometry predictions instead.
