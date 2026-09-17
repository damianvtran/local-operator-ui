import { useSyncExternalStore } from "react";
import type { BrowserChromeState } from "../hooks/use-browser-chrome";

/**
 * The browser projection, subscribed ONCE for the window.
 * Design: docs/design/sidebar-conversation-browser.md 1.5 (why), 3 R6-B (this
 * module), 6.2 (its test).
 *
 * WHY THIS EXISTS, and it is the change's most important structural decision.
 * `useBrowserProjection` used to own a `useState` pair, an initial read and TWO
 * IPC subscriptions PER CALL. That was correct while there were at most two
 * consumers — the surface and the chat header's badge. A mark on every
 * conversation row makes it wrong: the sidebar renders every row in one scroll
 * container with no virtualisation, so forty rows × one subscription each is
 * forty `/browser-state` reads per `browser-state-changed` event, each returning
 * the whole projection. Main builds that projection per read, so the cost lands
 * in the main process too.
 *
 * So the read is one module-level subscription, one snapshot, and React reads it
 * through `useSyncExternalStore`. `useBrowserProjection` becomes a selector over
 * this module and keeps its exact return shape, which is why the surface, the
 * header and the drawer need no changes at all.
 *
 * SUBSCRIBING IS RETAINING. The subscription to main is refcounted by React's own
 * subscribe/unsubscribe (which `useSyncExternalStore` calls once per mounted
 * consumer), so the first consumer starts it — including the one initial read —
 * and the last one stops it. This is why the module exports the store rather than
 * a hook: the property worth testing is "N consumers, one read per event", and a
 * test can pin it by driving the store directly, without a window.
 *
 * THE SNAPSHOT IS DROPPED WHEN THE LAST CONSUMER LEAVES, and that is a deliberate
 * choice about which semantics survive: it is exactly what every consumer did
 * before this module existed (its own `useState(null)`, filled by its own first
 * read), so a mount renders the empty projection and then the projection — no
 * flash of a previous reader's view of the world, and no stale tab list left in
 * module scope for a test to render. In the app the drain is rare in any case:
 * the chat header's badge is a consumer whenever a conversation is open, and the
 * sidebar's marks are consumers whenever the list is on screen.
 *
 * WHAT THE SNAPSHOT IS NOT: authority. It is what main last published (three
 * fields of it: the tab list, the pending requests and the approved grants).
 * Every intent still goes to main and every action re-reads.
 */

/**
 * What the preload exposes. Absent outside Electron (Storybook, the unit tests),
 * which is why every reader here asks for it rather than assuming it.
 */
type BrowserBridge = NonNullable<typeof window.api>["browser"];

/** The bridge, or null outside Electron. The one accessor: a second one is how
 * two readers end up disagreeing about whether the browser is available. */
export function browserBridge(): BrowserBridge | null {
	return window.api?.browser ?? null;
}

/** Whether the browser controls can work at all. A route rendered outside
 * Electron says so rather than throwing on the first click. */
export function browserBridgeAvailable(): boolean {
	return browserBridge() !== null;
}

/** The prefix Electron adds to an `ipcRenderer.invoke` rejection. Module scope
 * because a regex literal inside the function is rebuilt on every call and the
 * linter's rule is right about it. It lives beside the bridge because a rejected
 * invoke is the bridge's own error shape. */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*/;

/** IPC rejections arrive as `Error` with a prefix Electron adds, so the message
 * is unwrapped rather than shown raw. */
export function messageOf(caught: unknown): string {
	const raw = caught instanceof Error ? caught.message : String(caught);
	return raw.replace(IPC_ERROR_PREFIX, "").trim();
}

export interface BrowserProjectionSnapshot {
	/** The projection itself, or `null` before the first read lands. */
	state: BrowserChromeState | null;
	/**
	 * A state read failed: main could not answer, or answered something unusable.
	 *
	 * SEPARATE FROM AN ACTION'S REFUSAL, and that separation is the whole point of
	 * the two slots: a successful read used to clear whatever action error had just
	 * been recorded, so a refused navigation, a failed hand-over or a `tab_limit`
	 * showed the user a dead button instead of the refusal (review round 1, R6).
	 * This slot is written by reads and cleared by reads; the action slot lives in
	 * `useBrowserChrome` and reads cannot touch it.
	 */
	readError: string | null;
}

const NO_SNAPSHOT: BrowserProjectionSnapshot = { state: null, readError: null };

/**
 * THE SNAPSHOT'S IDENTITY IS THE PUBLICATION BOUNDARY, which is what
 * `useSyncExternalStore` compares to decide whether to re-render. So it is
 * replaced only when something it carries actually changes: a read that lands
 * while a newer one is in flight publishes nothing, and clearing an already-clear
 * read error publishes nothing.
 */
let snapshot: BrowserProjectionSnapshot = NO_SNAPSHOT;
const listeners = new Set<() => void>();
/** The one subscription's teardown, or null when nothing is subscribed. */
let unsubscribeFromBridge: (() => void) | null = null;
/** Whether this window has issued its initial read since the last consumer left. */
let readOnStart = false;
/**
 * THE READ GENERATION, and it is a correctness guard this module owes its shared
 * snapshot rather than a nicety: a read is asynchronous, and two can be in flight
 * (an event arriving while the previous read is still awaiting main). Publishing
 * in COMPLETION order rather than in START order lets an older projection overwrite
 * a newer one — the strip would then show a state main has already moved past, with
 * nothing to correct it until the next event.
 *
 * SO A RESULT IS PUBLISHED IF IT IS NEWER THAN THE LAST ONE PUBLISHED — the highest
 * generation that has been seen, not the highest that has been started. That
 * distinction is the whole fix, and getting it wrong is measured rather than
 * theoretical (QA, this branch): dropping every superseded read loses INTERMEDIATE
 * states, and intermediate states are load-bearing for a consumer here. The approval
 * memory is a TRANSITION DETECTOR — it reports an entry that was live and is not
 * (`reconcileResolved`) — so a request that was raised and withdrawn while a read
 * was in flight, with both reads coalesced into one publication, never appears to
 * have existed at all: the badge fell and the band explained nothing, which is
 * exactly the "why did the count change" feature §3.4 exists for. Every read that
 * lands in order therefore publishes; only a result older than the newest published
 * one is discarded, which is the case the guard is actually for.
 */
let readGeneration = 0;
let publishedGeneration = 0;

function publish(next: BrowserProjectionSnapshot): void {
	snapshot = next;
	for (const listener of listeners) listener();
}

/** The current snapshot. Synchronous and allocation-free, because
 * `useSyncExternalStore` calls it on every render. */
export function readBrowserProjection(): BrowserProjectionSnapshot {
	return snapshot;
}

export function clearBrowserProjectionReadError(): void {
	if (snapshot.readError === null) return;
	publish({ state: snapshot.state, readError: null });
}

/**
 * Read the projection once.
 *
 * Returns the state it read as well as publishing it, because a caller's own
 * consequence of a read — `useBrowserChrome`'s pending-URL note — needs the value
 * the read produced rather than the snapshot React is about to render. `null`
 * when the bridge is absent or the read failed, which are the two ways there is
 * no new state to act on.
 */
export async function refreshBrowserProjection(): Promise<BrowserChromeState | null> {
	const api = browserBridge();
	if (!api) return null;
	const generation = ++readGeneration;
	try {
		const next = (await api.state()) as BrowserChromeState | null;
		if (!next || !Array.isArray(next.tabs)) return null;
		if (generation > publishedGeneration) {
			publishedGeneration = generation;
			publish({ state: next, readError: null });
		}
		return next;
	} catch (caught) {
		if (generation === readGeneration) {
			publish({ state: snapshot.state, readError: messageOf(caught) });
		}
		return null;
	}
}

/**
 * Subscribe a consumer, starting the window's one subscription on the 0 → 1 edge
 * and stopping it on the 1 → 0 edge.
 *
 * Both events land on the same projection. Main emits the consent event for the
 * approval store's changes (which include the pending set) and the state event
 * for the registry's, and reading the projection twice is cheaper than two
 * projections that can disagree.
 */
export function subscribeBrowserProjection(listener: () => void): () => void {
	listeners.add(listener);
	start();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) stop();
	};
}

function start(): void {
	const api = browserBridge();
	if (!api) return;
	if (!unsubscribeFromBridge) {
		const offState = api.onStateChanged(() => void refreshBrowserProjection());
		const offConsent = api.onConsentChanged(
			() => void refreshBrowserProjection(),
		);
		unsubscribeFromBridge = () => {
			offState();
			offConsent();
		};
	}
	if (readOnStart) return;
	readOnStart = true;
	void refreshBrowserProjection();
}

function stop(): void {
	unsubscribeFromBridge?.();
	unsubscribeFromBridge = null;
	// The next consumer re-reads: a remount after an absence has no way to know
	// what changed while nothing was listening, and one read is its own answer. The
	// snapshot goes with the subscription (see the module docstring) so a mount can
	// never render a projection nobody is currently being told about.
	readOnStart = false;
	if (snapshot !== NO_SNAPSHOT) publish(NO_SNAPSHOT);
	// The generations go with it, but the reset is `readGeneration`, NOT zero (review
	// round 1, A6): zero re-opened the cross-subscription publish this guard exists to
	// close. A read still in flight when the last consumer left carries a generation
	// below `readGeneration`, and it must not publish into the NEXT subscription's
	// snapshot — the note above says a mount can never render a projection nobody is
	// currently being told about, and a straggler from the previous subscription is
	// exactly that. Seeding the floor at the current counter drops it while still
	// admitting every read the new subscription starts (whose generations are higher).
	publishedGeneration = readGeneration;
}

/** The React binding: one subscription, one snapshot, however many consumers. */
export function useBrowserProjectionStore(): BrowserProjectionSnapshot {
	return useSyncExternalStore(
		subscribeBrowserProjection,
		readBrowserProjection,
		// The server renderer (`renderToStaticMarkup`, which the unit tests use) has
		// no effects, so it can never have read: it renders the empty snapshot, which
		// is exactly what the pre-first-read client renders too.
		readBrowserProjection,
	);
}
