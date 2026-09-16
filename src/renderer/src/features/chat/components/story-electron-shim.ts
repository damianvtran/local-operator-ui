/*
 * The composer's `window.electron` stand-in, for stories that mount it.
 *
 * WHY IT IS A MODULE AND NOT A WRAPPER. The composer reaches the bridge from a
 * passive effect on mount (the platform it renders the send chord for, and the
 * native dialog behind attach), and React runs a CHILD's effects before its
 * parent's — so a mock installed by a frame component around `MessageInput`
 * arrives one commit too late and the story dies in
 * `commitHookEffectListMount` with "Cannot read properties of undefined
 * (reading 'ipcRenderer')" (measured). Storybook's preview mocks `window.api`
 * and not `window.electron`, and `window.electron` is a renderer global only
 * the app's preload writes, so there is no other owner to restore it for.
 *
 * WHY IT IS SHARED RATHER THAN COPIED. It was extracted from
 * `message-input.stories.tsx` when a second story (`canonical/quote.stories.tsx`)
 * needed the same stand-in; two copies of a harness shim drift, and the copy
 * that drifts is the one that fails a story for a reason that is not about the
 * story.
 *
 * The stand-in answers exactly the two channels the composer uses and nothing
 * else. It is imported for its side effect, which is the point: the install has
 * to have happened before any component in the importing story renders.
 */

window.electron = {
	...(window.electron ?? {}),
	ipcRenderer: {
		...(window.electron?.ipcRenderer ?? {}),
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
		send: () => {},
		invoke: async (channel: string) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
} as typeof window.electron;

export {};
