import type { StorybookConfig } from "@storybook/react-vite";
import { dirname, join } from "node:path";

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
		getAbsolutePath("@storybook/addon-onboarding"),
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
		reactDocgen: "react-docgen-typescript",
	},
	viteFinal: async (config) => {
		// Add JSX runtime configuration
		config.esbuild = {
			...config.esbuild,
			jsx: "automatic",
		};

		return config;
	},
};

export default config;
