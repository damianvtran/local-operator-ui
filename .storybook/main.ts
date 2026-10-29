import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import {
	getProjectRoot,
	resolvePathInStorybookCache,
} from "storybook/internal/common";
import { pruneStorybookCacheFromEnv } from "../scripts/storybook-cache-prune.mjs";

/*
 * Bound Storybook's on-disk cache. Storybook 8.6 never evicts it and keys it per
 * config dir, so every worktree that ran Storybook left a directory behind (85 of them,
 * 6 GiB by `du`, in six days). It runs HERE, at config load, rather than in a
 * package.json script because this file is read by every entry point - `pnpm
 * storybook`, a bare `storybook dev` in a worktree, `storybook build` - and the by-hand
 * invocations are the ones that leak. Synchronous and fail-open by construction (see
 * scripts/storybook-cache-prune.mjs): a prune problem must never stop Storybook.
 * `STORYBOOK_CACHE_PRUNE=off` disables it; AGENTS.md has the policy numbers.
 *
 * The root and the current run's key are derived the way @storybook/core derives
 * them (`resolvePathInStorybookCache`; sha256 of the salt + config dir relative to the
 * project root), so the entry this run is about to use is never a candidate.
 */
try {
	pruneStorybookCacheFromEnv({
		// Both `""` are load-bearing: the second suppresses the `"default"` cache-key
		// default, so this is the bare cache root rather than `<root>/default`.
		root: resolvePathInStorybookCache("", ""),
		protectKey: createHash("sha256")
			.update("storybook-telemetry-salt")
			.update(relative(getProjectRoot(), __dirname))
			.digest("hex"),
	});
} catch {
	// Fail open: never let cache housekeeping block the gallery.
}

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string) {
	return dirname(require.resolve(join(value, "package.json")));
}
/** @type { import('@storybook/react-vite').StorybookConfig } */
const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		getAbsolutePath("@storybook/addon-essentials"),
		getAbsolutePath("@chromatic-com/storybook"),
		getAbsolutePath("@storybook/addon-interactions"),
	],
	framework: {
		name: getAbsolutePath("@storybook/react-vite"),
		options: {},
	},
	docs: {
		autodocs: "tag",
	},
	typescript: {
		/*
		 * `react-docgen-typescript` cannot run on TypeScript 7: it reads a
		 * compiler-internal namespace the 7.0 move removed, and `storybook build`
		 * dies with `Cannot read properties of undefined (reading 'React')` before
		 * a single story renders (#140 moved the desktop toolchain to Electron 44
		 * / TypeScript 7). That takes the whole evidence pipeline with it, because
		 * `scripts/capture-evidence.mjs` drives Storybook. The built-in
		 * `react-docgen` extracts props from the JSX rather than from the type
		 * checker, which costs only the types-driven prop tables on the docs pages:
		 * no story renders differently, and every committed frame is a story.
		 */
		reactDocgen: "react-docgen",
	},
	viteFinal: async (config) => {
		// Add JSX runtime configuration
		config.esbuild = {
			...config.esbuild,
			jsx: "automatic",
		};

		// Tailwind v4 is a Vite plugin, not a PostCSS step. Without it here,
		// `@import "tailwindcss"` in styles/index.css resolves to nothing and
		// every role utility silently reads as absent — the stories render as
		// unstyled HTML rather than failing, which is the confusing failure.
		config.plugins = [...(config.plugins ?? []), tailwindcss()];

		// Add path aliases to match electron.vite.config.js and tsconfig.app.json
		config.resolve = {
			...config.resolve,
			alias: {
				...config.resolve?.alias,
				"@renderer": resolve("src/renderer/src"),
				"@components": resolve("src/renderer/src/components"),
				"@features": resolve("src/renderer/src/features"),
				"@shared": resolve("src/renderer/src/shared"),
				"@assets": resolve("src/renderer/src/assets"),
				"@hooks": resolve("src/renderer/src/hooks"),
				"@api": resolve("src/renderer/src/api"),
				"@store": resolve("src/renderer/src/store"),
				"@resources": resolve("resources"),
			},
		};

		return config;
	},
};

export default config;
