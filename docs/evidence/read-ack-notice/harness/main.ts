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
		 * ONE SONNER, and this is the only pin that survived being measured. Its store
		 * is a module-level singleton, so a build that resolves the package twice gives
		 * the component that RAISES a toast and the Toaster that paints it two different
		 * stores.
		 *
		 * TWO FURTHER PINS USED TO SIT HERE AND WERE REMOVED (design round 3, D14): the
		 * round that added them hoped they explained the lane painting nothing, and the
		 * next round measured what actually stops it - the copies outside the nav sit at
		 * `op=0` beside a `0x0` `<ol>`, a container with no box - and re-ran with the
		 * whole `optimizeDeps` block gone for the same numbers. One of the two pins was
		 * also dead, overwritten by the spread beneath it. What changed that round's
		 * reading was a rebuild of the vite dep cache, which is not a config fact and is
		 * not claimed anywhere in this set.
		 */
		config.resolve.dedupe = [...(config.resolve?.dedupe ?? []), "sonner"];
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
