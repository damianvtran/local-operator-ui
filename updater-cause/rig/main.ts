/*
 * SCOPED Storybook config for the updater-proof capture - NON-SHIPPING, and placed at
 * the worktree ROOT on purpose (see the placement note at the end).
 *
 * WHY THIS EXISTS. `.storybook/main.ts` derives `stories` from `musicStoryScope`, whose
 * only axis is the music gallery, so no env var can point the full config at one updater
 * story; loading the whole gallery is what attempt 1 did (6017, killed at 2 GiB, exit -9).
 *
 * WHY IT LOOKS LIKE THIS. The repository already ships this exact convention: `.gitignore`
 * (:72-79) documents a variant config dir at the worktree root, run as `-c .storybook-local`,
 * with `reactDocgen: false` and absolute story globs, and `.storybook-local/` is ignored
 * (:79). Reusing the documented convention is the narrow fix; inventing a new directory
 * shape would be a parallel pattern.
 *
 * WHY THE PLACEMENT IS THE BUG FIX, not cosmetic. Tailwind v4 is a Vite plugin added by
 * the real `viteFinal` (`.storybook/main.ts:89`, with the comment at :85-88 naming this
 * exact failure mode) and the entry CSS is a bare `@import "tailwindcss"`
 * (`src/renderer/src/styles/index.css:1`) with NO `@source` or `@config` directive
 * anywhere in a `.css` file under `src/` (verified: zero matches at cea4ee9b). So utility generation
 * depends entirely on Tailwind's AUTOMATIC content detection, whose scan base follows the
 * Storybook/Vite root. A config dir inside `dist/` puts that base inside a gitignored
 * (`dist/` :11), build-output tree - and Tailwind skips ignored paths by design - which
 * yields zero candidates: preflight/theme CSS still loads (it is imported) while every
 * utility class silently reads as absent. At the worktree root the base is the project
 * tree that the product's own Storybook scans.
 *
 * WHAT IT CHANGES, and nothing else: `stories` (one file) and `typescript.reactDocgen:
 * false`. `framework`, `addons` and the real `viteFinal` - Tailwind plugin, theme CSS,
 * `@renderer`/`@shared`/`@features`/`@hooks`/`@api`/`@store`/`@resources` aliases - are
 * inherited by spreading the actual config, because `viteFinal` closes over the
 * repository's own `resolve()` roots. No CSS, no style mask, no hardcoded utilities.
 *
 * VERIFIED AT cea4ee9b: `.storybook/main.ts` blob d1f9b70ceb03a7ddeaf7612de46623e3341fa385
 * (`stories` :51, `typescript.reactDocgen` :64-77, `viteFinal` :78-109, `export default
 * config;` :112 - default export only). `.storybook/preview.tsx` blob
 * e04f9b174254a8c74ddf5735140b798f34597082 (`export default preview;` :694 - default only).
 */
import type { StorybookConfig } from "@storybook/react-vite";

import actual from "../.storybook/main";

const config: StorybookConfig = {
	...actual,
	/*
	 * Relative to THIS config directory, which is the worktree root, so one level up is
	 * the root and then the real path of the story the capture is about. The documented
	 * variant spells these absolute; relative resolves to the same file and survives being
	 * transported between worktrees.
	 */
	stories: [
		"../src/renderer/src/shared/components/common/update-notification.stories.tsx",
	],
	typescript: {
		...actual.typescript,
		reactDocgen: false,
	},
};

export default config;
