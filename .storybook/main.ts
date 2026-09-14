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
		 * `react-docgen`, not `react-docgen-typescript`, because the latter
		 * cannot run against the TypeScript 7 toolchain this repo moved to in
		 * #140: requiring it throws
		 * `TypeError: Cannot read properties of undefined (reading 'React')`
		 * inside its own parser and Storybook reports "Failed to build the
		 * preview", so no story renders and `scripts/capture-evidence.mjs` can
		 * produce no frame at all. Storybook's own `react-docgen` parses the
		 * source without loading the TypeScript compiler, which is the whole of
		 * what this generator is used for here (the props tables on docs pages),
		 * and it is the recommended default. Revisit only if a prop table needs
		 * something react-docgen's parser cannot express.
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
