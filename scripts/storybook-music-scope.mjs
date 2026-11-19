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
					// Evidence carrier only: reuse real stories and locale decorators,
					// while retaining the music/SFX states required by the manifest.
					"../src/renderer/src/features/agents/components/agents-teams.stories.tsx",
					"../src/renderer/src/features/chat/components/run-details/run-details.stories.tsx",
					"../src/renderer/src/features/chat/canonical/turn-collapse.stories.tsx",
					"../src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
					"../src/renderer/src/features/chat/components/chat-header-identity.stories.tsx",
				]
			: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
		reactDocgen: evidence ? false : "react-docgen",
	};
}
