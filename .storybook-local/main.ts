import { dirname, join, resolve } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string) {
	return dirname(require.resolve(join(value, "package.json")));
}
/** @type { import('@storybook/react-vite').StorybookConfig } */
const config: StorybookConfig = {
	stories: ["/Users/damian/local-operator-ui-worktrees/panels/src/**/*.mdx", "/Users/damian/local-operator-ui-worktrees/panels/src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
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
		reactDocgen: false,
		// Local-only workaround: react-docgen-typescript 2.2.2 reads the TypeScript 7
		// JS compiler API, which no longer exists, so the preview cannot build at this
		// head. Docgen only feeds docs tables; story renders are unaffected.,
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
