/*
 * WHETHER THE PANE'S STATUS STRIP IS ON SCREEN - the fact the sidebar's
 * stand-down actually needs (§F2).
 *
 * WHY THIS EXISTS (agent review round 2, R11). The sidebar's three connection
 * paragraphs stand down "while the strip speaks", and the first cut of that
 * gate read the strip's COPY CONDITION alone (`serverHealth?.online === false`).
 * The copy condition is not presence: the strip is mounted inside the
 * conversation pane and therefore on the CHAT routes only, while the sidebar is
 * mounted on every route. Keyed to the copy condition, `/settings` went silent
 * about a dead server with no second voice to take over - the fix for "two
 * voices on /chat" had produced "zero voices everywhere else", and nothing but
 * a driven route would have shown it.
 *
 * So the strip is the thing that knows it is mounted, and this module is how it
 * says so. The consumers' contract:
 *
 * - `ChatStatusStrip` publishes while it has a display (dismissed to the pill
 *   counts - the pill still states the state, §F2);
 * - the sidebar stands its paragraphs down only while the server is known to
 *   be unreachable AND this flag is set, so wherever the strip is not mounted
 *   the sidebar keeps speaking, and where it is mounted there is exactly one
 *   voice.
 *
 * A MODULE-LEVEL STORE rather than React context, for the same reason the
 * status vocabulary itself is a module (`chat-status.ts`): the publisher and
 * the consumer sit in different trees - `chat-content.tsx` renders the strip,
 * `chat-layout.tsx` renders the sidebar - and the one shell they share is
 * `app.tsx`, so threading a context through it would make every route between
 * them carry a prop that only one leaf reads. `useSyncExternalStore` is the
 * subscription primitive React ships for exactly this shape, and its server
 * snapshot is the honest default (nothing is on screen when nothing renders).
 *
 * NOT A SECOND SOURCE OF TRUTH ABOUT THE STATE. This module answers one
 * question - "is the strip drawn" - and never what it would say; the copy
 * decision stays in `chat-status.ts`, where both the strip and any future
 * reader of the state can reach it.
 */

import { useSyncExternalStore } from "react";

let stripPresent = false;
const listeners = new Set<() => void>();

/**
 * Published by the strip while it is drawn (its own effect), and cleared when
 * it unmounts. Boolean and edge-triggered: a re-render that changes nothing
 * about presence must not wake every subscriber.
 */
export function setChatStatusStripPresent(present: boolean): void {
	if (stripPresent === present) return;
	stripPresent = present;
	for (const listener of listeners) listener();
}

/** The raw reading, for callers that are not components. */
export function chatStatusStripPresent(): boolean {
	return stripPresent;
}

/** Subscribe a component to the presence flag. */
export function useChatStatusStripPresent(): boolean {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		chatStatusStripPresent,
		/*
		 * The server snapshot: a tree rendered where no effect can run (the
		 * app's own stories, a test renderer) has no strip on screen, which is
		 * the direction that KEEPS the sidebar speaking rather than muting it.
		 */
		() => false,
	);
}

/**
 * Whether the strip currently OWNS the connection voice: it is on screen AND
 * unreachability is the reason it has something to say.
 *
 * ONE PREDICATE FOR EVERY SURFACE THAT YIELDS TO THE STRIP (R11). Three places
 * state or defer a lost connection - the sidebar's two list-pane paragraphs and
 * its foot line, and the pane's own catalogue error - and each one keyed to
 * `serverHealth.online` alone would silence its route exactly as the sidebar's
 * first cut did. `serverOffline` is passed in rather than read here because the
 * two callers hold that reading already (`useServerHealth`'s `online === false`,
 * with `undefined` meaning "not known to be down", which must not mute anything).
 */
export function useStripSpeaksConnection(serverOffline: boolean): boolean {
	return useChatStatusStripPresent() && serverOffline;
}
