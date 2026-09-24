/*
 * SCRATCH Storybook config for the design review of PR #484 (read receipt).
 *
 * Not part of the tree: this lives in a throwaway worktree created by the
 * reviewing agent, and is deleted with the worktree. It mirrors `.storybook/main.ts`
 * exactly except for the `stories` glob, which points at this directory so the
 * reviewer's staging story can render the shipped component against store state
 * without adding a story to the repository.
 */
import { dirname, join, resolve } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

function getAbsolutePath(value: string) {
	return dirname(require.resolve(join(value, "package.json")));
}
/** @type { import('@storybook/react-vite').StorybookConfig } */
const config: StorybookConfig = {
	stories: ["./*.stories.@(tsx)"],
	addons: [
		getAbsolutePath("@storybook/addon-essentials"),
		getAbsolutePath("@storybook/addon-interactions"),
	],
	framework: {
		name: getAbsolutePath("@storybook/react-vite"),
		options: {},
	},
	typescript: {
		reactDocgen: "react-docgen",
	},
	viteFinal: async (config) => {
		config.esbuild = {
			...config.esbuild,
			jsx: "automatic",
		};
		config.plugins = [...(config.plugins ?? []), tailwindcss()];
		/*
		 * ONE SONNER. Its store is a module-level singleton, so a build that resolves
		 * the package twice gives the component that RAISES a toast and the Toaster
		 * that paints it two different stores - the panel's request reaches the lane
		 * and nothing appears, which is exactly what the live probe on the story
		 * reported (`toaster=0`, one warning call, the composed sentence).
		 */
		config.resolve.dedupe = [...(config.resolve?.dedupe ?? []), "sonner"];
		/*
		 * AND SONNER IS NOT PRE-BUNDLED EITHER. `dedupe` alone left the profile
		 * build serving one copy from the dep cache and the source tree's modules
		 * another: the panel's request landed in a store whose only subscriber is the
		 * story's own import, while the Toaster rendered from the other store - and
		 * sonner renders NOTHING when its own list is empty
		 * (`if (!toasts.length) return null`), which is why the page showed no
		 * `[data-sonner-toaster]` at all.
		 */
		config.optimizeDeps = {
			...config.optimizeDeps,
			exclude: [...(config.optimizeDeps?.exclude ?? []), "sonner"],
		};
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
