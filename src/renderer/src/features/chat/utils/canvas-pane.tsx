/**
 * The pane a transcript's markdown is in, for the two components that need to
 * know: the anchor and the link toolbar.
 *
 * WHY A CONTEXT AND NOT A PROP. The anchor is `markdown-renderer.tsx`'s
 * `MarkdownAnchor`, which every markdown surface in the app renders through -
 * the canonical transcript's rows, the legacy message rows, the trace rows,
 * the canvas, Storybook - and `MarkdownRenderer` takes no pane identity today
 * and must not grow one: it is rendered with no pane at all in most of those
 * places, and a required prop would be a wiring change in every one of them.
 * A context provided where the identity EXISTS (CanonicalTranscript, which
 * already receives `conversationId`) reaches both consumers without touching
 * any caller, and its absence is not an error state: `useCanvasPane()` answers
 * `null`, and every consumer keeps the behaviour it had before this module
 * existed.
 *
 * WHAT IT CARRIES: the OPENER, not the id. `CanonicalTranscript`'s
 * `conversationId` already has a reader with its own contract - it is the key a
 * staged quote is filed under, handed to `LinkToolkit` as a prop and to the
 * composer below the pane - and publishing it here as well would be two sources
 * of one value, which is the defect this repository refuses in its own words
 * (`use-quote-press.ts`'s "a second copy would re-derive them"). So the value is
 * exactly what the canvas half of this feature needs and nothing else: a
 * function bound to this conversation. Both the anchor's click and the toolbar's
 * `Open in canvas` reach the pane through that one binding, and neither of them
 * knows an id.
 */

import type { FC, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { openPathInCanvas } from "./open-in-canvas";

export type CanvasPane = {
	/**
	 * Put a local path on screen in this pane's canvas.
	 *
	 * Answers `false` when the pane would not take it - a directory, a path the
	 * probe already knows is gone, a type with no viewer, a read that failed - and
	 * the caller's fallback is the OS hand-off it used before this existed.
	 */
	openInCanvas: (path: string) => Promise<boolean>;
};

const CanvasPaneContext = createContext<CanvasPane | null>(null);

/**
 * Provide the pane to everything rendered inside it.
 *
 * An absent `conversationId` provides `null` rather than skipping the provider,
 * so the tree's shape does not depend on which surface it is: a story, the run
 * panel's child reader and a session-less draft all get the same
 * "no pane in reach" answer, and the components inside them behave as they did
 * before this change.
 */
export const CanvasPaneProvider: FC<{
	conversationId?: string;
	children: ReactNode;
}> = ({ conversationId, children }) => {
	/*
	 * Memoised on the id, and that is load-bearing rather than tidy: a transcript
	 * re-renders per streaming delta, and a fresh context value on every frame
	 * would re-render every anchor in every row that repaints.
	 */
	const value = useMemo<CanvasPane | null>(
		() =>
			conversationId
				? {
						openInCanvas: (path: string) =>
							openPathInCanvas(conversationId, path),
					}
				: null,
		[conversationId],
	);
	return (
		<CanvasPaneContext.Provider value={value}>
			{children}
		</CanvasPaneContext.Provider>
	);
};

/** The pane this subtree renders in, or `null` where there is none. */
export const useCanvasPane = (): CanvasPane | null =>
	useContext(CanvasPaneContext);
