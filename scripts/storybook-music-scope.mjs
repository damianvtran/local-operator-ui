/** Opt-in bounded evidence scope. Defaults remain the full gallery. Narrowing
 * the index and skipping prop-doc AST extraction changes neither the imported
 * React components nor Tailwind styles; it is not a replacement UI or a claim
 * to validate generated prop documentation. */
/** @returns {{stories: string[], reactDocgen: false | "react-docgen"}} */
export function musicStoryScope(env = process.env) {
	const evidence = env.LOP_STORYBOOK_MUSIC_EVIDENCE === "1";
	return {
		stories: evidence
			? [
					"../src/renderer/src/features/chat/canonical/music.stories.tsx",
					"../src/renderer/src/features/chat/canonical/sound-player.stories.tsx",
				]
			: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
		reactDocgen: evidence ? false : "react-docgen",
	};
}
