/**
 * The row context menu, as shipped - the story `docs/evidence/chat-sidebar-row-context-menu/`
 * is captured from. It draws Archive, Pin, Fork, Copy session ID and Rename
 * conversation on an ordinary row, and SEVEN items on a pinned one - the conditional
 * Move pair trails the unconditional run, and `chat-sidebar.tsx`'s items comment
 * carries the order rule; the readout lists whatever the product mounted, so no
 * frame states a count the app does not hold.
 *
 * THIS STORY DRIVES THE REAL THING, and the one simulation is named rather than
 * hidden. The menu is opened THROUGH THE REAL TRIGGER: a dispatched `contextmenu`
 * at the row's own box for the pointer states (which is exactly the event a
 * right-click delivers - the primitive anchors from `event.clientX/clientY`), and
 * a real `keydown` (`ContextMenu`) on the row's own button for the keyboard state.
 * Everything the events land on is the product's: the trigger is the box the
 * sidebar renders, the open state is `openMenuRowId` in `chat-sidebar.tsx`, the
 * hold classes are the sidebar's own conditional classes, the item set is drawn
 * from the row's real predicates, and each item presses the row's real control.
 * The events are SYNTHESISED because the capture rig can drive a left pointer and
 * Enter/Space but not a right-button press or these keys; a dispatch through the
 * element's own event system is the closest path to the real gesture the rig can
 * take, and the QA round can drive the real right-click over CDP.
 *
 * The readout beside the panel prints what each frame is read for, sampled from
 * the DOM (the panel's own box, the anchoring point, the row's ground, the pair's
 * display, the flyout's presence and where focus landed), so a frame cannot claim
 * a number the app does not hold.
 *
 * THE COPY STATE'S CLIPBOARD IS RECORDED, NOT WRITTEN (#893): the row's Copy item
 * goes through the real helper, whose `navigator.clipboard.writeText` is stubbed for
 * that one state so the act can be photographed without a clipboard permission the
 * headless rig does not have - see `pressCopy` and `clipboardRecord` below.
 *
 * THE TIMING IS PART OF THE MEASUREMENT. `delayMs` (default 250) opens the menu
 * after the story has settled but BEFORE the flyout's own 400ms dwell, so the
 * clean frames carry no flyout; the `flyout-dwelled` state opens at 1800ms
 * instead, after the flyout has drawn, and `flyout-alone` is its control - same
 * hover, same dwell, no menu. `menu-closed` is the before/after partner of
 * `pointer-open`: the same scene and the same settle, without the open.
 *
 * THE ARCHIVED-ROW STATE DRIVES THE SEARCH BLOCK'S OWN CONTROLS - the field's
 * `input` event, then a real press on `Include archived` - because that is the
 * only list an archived conversation is drawn in, and its menu is the one that
 * reads `Unarchive conversation`, the widest label this panel draws.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { usePanelPresentationStore } from "@shared/store/panel-presentation-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { DEFAULT_SIDEBAR_VIEW } from "../chat-sidebar-view";
import { ChatSidebar } from "./chat-sidebar";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = { op: string; q?: string; include_archived?: boolean };

/** One row in `sessions.list`'s own wire field names, as the backend sends it. */
type WireRow = {
	id: string;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	pinned?: boolean;
	binding: { agent: string | null; team: string | null };
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
	archived?: boolean;
};

const EPOCH = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708";

const row = (
	id: string,
	name: string,
	mtime: number,
	over: Partial<WireRow> = {},
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: false,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Idle" },
	status_revision: 0,
	status_epoch: EPOCH,
	...over,
});

/**
 * Three rows, one per pin state the menu's own predicate distinguishes - and the
 * rows are ordinary `sessions.list` answers rather than props: `pinned: true`
 * puts the row in the pinned section with its mark drawn at rest, which is the
 * row the menu is opened on; `pinned: undefined` is the row the menu withholds
 * the pin item on.
 */
const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

const roster = (): WireRow[] => {
	const now = NOW_SECONDS();
	return [
		row("s1", "Reconcile the supplier ledger", now - 60, { pinned: true }),
		row("s2", "Migrate the deploy script", now - 300, { pinned: false }),
		/*
		 * NO `pinned` FIELD AT ALL. `pinned` is always present on a row from a
		 * pins-capable backend, so this state is the one the app can only reach
		 * through the catalogue's own mapping - and it is exactly what the menu's
		 * pin predicate (`row.pinned !== undefined`) is written for: the pin ITEM
		 * is withheld, the archive item remains, and the row itself draws no pin
		 * control either.
		 */
		row("s3", "Quarterly revenue model", now - 900),
		/*
		 * THE ARCHIVED ROW. `archived: true` is what the daemon's own answer carries
		 * for a conversation the search block's `Include archived` may draw, and it
		 * is the value the menu's item copy reads (`Unarchive conversation`). The
		 * default lists never draw it - the panel fetches it, the lists do not - so
		 * this state has to widen the search before it can open the menu at all.
		 */
		row("s4", "Invoice reconciliation", now - 1200, {
			pinned: false,
			archived: true,
		}),
	];
};

/**
 * The bridge, with the two capabilities the row's acts hang off as parameters.
 *
 * `session_archive` absent is the capability-withheld frame; both absent is the
 * withdrawn panel whose trigger must not exist at all.
 */
const bridge = (features: { pins: boolean; archive: boolean }) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const rows = roster();
	const handler = async (request: BridgeRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						session_search: 1,
						profile_catalogue: 1,
						team_catalogue: 1,
						...(features.pins ? { session_pins: 1 } : {}),
						...(features.archive ? { session_archive: 1 } : {}),
					},
				});
			case "sessions.list":
				return ok({ sessions: rows, truncated: false });
			case "sessions.search": {
				/*
				 * The route's own default: archived conversations are ABSENT from an
				 * ordinary answer and present only in a widened one - which is why the
				 * archived-row state has to drive the checkbox before the menu can be
				 * opened on its row.
				 */
				const widened = request.include_archived === true;
				return ok({
					query: request.q ?? "",
					limit: 100,
					sessions: rows.filter(
						(entry) =>
							(widened || entry.archived !== true) &&
							entry.name
								.toLowerCase()
								.includes((request.q ?? "").toLocaleLowerCase()),
					),
				});
			}
			case "profiles.list":
				return ok({ profiles: [] });
			case "teams.list":
				return ok({ teams: [] });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler };
};

/* --------------------------------------------------------------- helpers */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The element `find` returns, polled until it exists.
 *
 * The states that drive the SEARCH controls wait on things a press produces -
 * the checkbox renders only once a query is in the field, the archived row only
 * once the widened request has answered - and a fixed sleep long enough for the
 * slowest of those would be paid by every other state.
 */
const waitFor = async <T extends Element>(
	find: () => T | null,
): Promise<T | null> => {
	for (let i = 0; i < 120; i++) {
		const found = find();
		if (found) return found;
		await sleep(100);
	}
	return null;
};

/**
 * Wait until the pointer is ON this element, then give up (and say so) rather
 * than hanging a run.
 *
 * WHY THE POINTER STATES WAIT FOR THEIR OWN HOVER, and it is a requirement rather
 * than tidiness. The menu is modal, so Radix puts `pointer-events: none` on the
 * body while it is open - which means the row cannot be hovered AT ALL once the
 * panel is up, however the pointer is parked (the design record states it, and it
 * is why the hold exists: the held ground is React state, not `:hover`). The
 * capture rig moves a REAL pointer onto the row and then requires the row to
 * match `:hover` before it will open the shutter. So a story that opened the menu
 * on a timer after the row appeared was racing that: whichever came first won,
 * and a scene where the timer won files a frame whose own gate can never be
 * satisfied - the rig reports "the pointer is on `[data-session-row="s2"]` but the
 * element does not match :hover", which is exactly what the fold onto
 * `origin/main` (a larger sidebar, a slower first paint) produced for the whole
 * set. Waiting for the hover removes the race: the menu cannot open before the
 * pointer is on the row.
 *
 * IT IS ALSO THE HONEST GESTURE. A right-click happens on a row the pointer is
 * already over; the pointer arrives first and the menu follows. The timer was
 * standing in for a person who had already done that.
 */
const waitForHover = async (element: Element): Promise<boolean> => {
	for (let i = 0; i < 200; i++) {
		if (element.matches(":hover")) return true;
		await sleep(50);
	}
	return false;
};

/**
 * A draft that holds a LISTED conversation's id and never carried a message - the
 * sidebar's own `unstarted` statement (`chat-sidebar.tsx`), which is the one
 * condition that withholds the menu's Fork item: the backend refuses to fork a
 * session with no transcript. It is the real store shape rather than a prop, so
 * the frame is the product's predicate answering and not the story asserting.
 */
const unstartedDraft = (sessionId: string) => ({
	"draft-unstarted": {
		key: "draft-unstarted",
		createRequestId: "create-unstarted",
		admissionRequestId: "admission-unstarted",
		sessionId,
	},
});

/*
 * WHERE THE RECORDING CLIPBOARD PUTS WHAT IT RECORDED (#893).
 *
 * The row menu's `Copy session ID` item calls `copySessionId`, which writes through
 * `navigator.clipboard.writeText` - and a headless capture has neither clipboard
 * permission nor document focus, so the real write is REFUSED and the frame would
 * show the FAILURE toast instead of the success the state is named for. The story
 * therefore installs a recording stub for the Copy state only (see the press below),
 * and this module-scope box is where the stub leaves the value for the readout: the
 * readout samples the DOM every animation frame, so the record has to be readable
 * from outside React's render.
 */
const clipboardRecord: { value: string | null } = { value: null };

const resetStores = (unstartedSessionId?: string) => {
	useUiPreferencesStore.setState({
		chatSidebarView: { ...DEFAULT_SIDEBAR_VIEW },
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "entities-first",
	});
	// Set on every state, `{}` included, so a state that names an unstarted row
	// cannot leak its draft into the next one in the same document.
	useCanonicalSessionsStore.setState({
		drafts: unstartedSessionId ? unstartedDraft(unstartedSessionId) : {},
	});
	// A request written by a previous state's Fork press would otherwise read as
	// this one's.
	usePanelPresentationStore.setState({ request: null });
	// And the recorded clipboard value, for the same reason: a value a previous
	// state's Copy press recorded would otherwise print as this one's.
	clipboardRecord.value = null;
};

/* ---------------------------------------------------------------- the rig */

type Spot = "pointer" | "keyboard";

const Panel: FC<{
	/** Which row box the gesture lands on, by wire id. */
	sessionId: string;
	/** Which of the two openers to drive. */
	spot: Spot;
	/**
	 * How long the row waits before its menu opens, in ms.
	 *
	 * Non-zero for exactly one state: the flyout needs a real pointer dwelling
	 * inside the row for `TOOLTIP_DELAY_MS` (400) before it draws, so a menu that
	 * opened on mount would always beat it. The dwelled frame therefore opens the
	 * menu LATE and lets the rig's hover go first.
	 */
	delayMs?: number;
	/**
	 * Skip the open entirely, and leave the pointer on the row.
	 *
	 * This is what makes `flyout-alone` a CONTROL - "the flyout is absent under an
	 * open menu" is worth nothing without proof that the flyout can be present in
	 * this scene at all, because a dead instrument returns a reading, not an error
	 * - and what `menu-closed` uses to photograph the row the menu-open frames are
	 * compared against.
	 */
	noMenu?: boolean;
	/**
	 * The query this state types into the search field before opening the menu.
	 *
	 * Set through the field's own `input` event and followed by a real press on
	 * `Include archived` (the id is `INCLUDE_ARCHIVED_ID` in `chat-sidebar.tsx`),
	 * because the row it photographs exists in no other list: the panel fetches
	 * archived conversations and the default lists do not draw them.
	 */
	search?: string;
	/**
	 * Press the menu's Fork item once it is open (#739), and let the readout print
	 * what the press asked for.
	 *
	 * There is no chat pane in this story, so no picker can open - and that is the
	 * point of the readout: the sidebar's half of the wiring is a REQUEST in the
	 * panel-presentation store plus a route change, and both are observable here
	 * on the real component. The pane's half (consuming it for the NAMED
	 * conversation, not its own) is `slash-dispatch.ts` and is asserted in
	 * `scripts/panel-presentation.test.mjs`; the story does not pretend to show it.
	 */
	pressFork?: boolean;
	/**
	 * Press the menu's Copy session ID item once it is open (#893), and let the
	 * readout print the string its recording clipboard captured.
	 *
	 * The write is stubbed rather than attempted (see `clipboardRecord`): this is
	 * the same class of substitution as the stubbed transport under the whole set,
	 * and it is the readout that keeps it honest - the frame shows what the act
	 * asked the clipboard to take. The real write path (and the refusal it can
	 * take) is `scripts/chat-session-copy-id.test.mjs`'s and QA's over CDP.
	 */
	pressCopy?: boolean;
	/**
	 * Press the menu's Rename conversation item once it is open (#920), and let
	 * the readout print what the press asked for.
	 *
	 * The same substitution as `pressFork`, one row down: there is no chat pane in
	 * this story, so no picker can open - and the sidebar's half is exactly what
	 * the readout can show: the request written to the panel-presentation store
	 * (the destination, the ROW it names, and the name it carries) plus the route
	 * change. The pane's half - seeding the dialog's field from that name rather
	 * than from its own title, and submitting `sessions.command` `rename` for the
	 * addressed session - is `slash-dispatch.ts` + `destination-pickers.tsx`,
	 * pinned in `scripts/panel-presentation.test.mjs`.
	 */
	pressRename?: boolean;
}> = ({
	sessionId,
	spot,
	delayMs = 250,
	noMenu = false,
	search,
	pressFork = false,
	pressCopy = false,
	pressRename = false,
}) => {
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			if (search !== undefined) {
				/*
				 * THE REAL CONTROLS, driven the way the user drives them. The field's
				 * value goes in through the native setter plus the `input` event
				 * React listens for (React tracks the value on the node, so a bare
				 * `.value =` write is discarded); `Include archived` is a Radix
				 * checkbox root, so its own click handler is the honest press.
				 */
				const field = await waitFor(() =>
					document.querySelector<HTMLInputElement>(
						'input[aria-label="Search chats and agents"]',
					),
				);
				if (!field || cancelled) return;
				Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set?.call(field, search);
				field.dispatchEvent(new Event("input", { bubbles: true }));
				const include = await waitFor(() =>
					document.querySelector<HTMLElement>("#chat-search-include-archived"),
				);
				if (!include || cancelled) return;
				include.click();
			}
			const box = await waitFor(() =>
				document.querySelector<HTMLElement>(
					`[data-session-row="${sessionId}"]`,
				),
			);
			if (!box || cancelled) return;
			/*
			 * The row has to be IN the frame for its ground and its pair to be
			 * readable, and the sidebar's own list scrolls: the story parks the
			 * target row in the middle of the list's box first, then measures.
			 */
			box.scrollIntoView({ block: "center" });
			await sleep(60);
			/*
			 * THE POINTER FIRST (see `waitForHover`). Only the states a real pointer
			 * drives wait: the keyboard state opens on a keypress with no pointer
			 * involved, and waiting there would stall the scene.
			 */
			if (spot === "pointer") await waitForHover(box);
			if (delayMs > 0) await sleep(delayMs);
			if (cancelled || noMenu) return;
			const rect = box.getBoundingClientRect();
			if (spot === "pointer") {
				/*
				 * THE POINTER'S POINT: the middle of the row at its own bottom
				 * edge, which is where a right-click on a title actually starts.
				 * `rect.bottom - 3` rather than the row's middle because the FRAME
				 * would otherwise be the panel covering the row it belongs to.
				 */
				const x = Math.round(rect.left + rect.width / 2);
				const y = Math.round(rect.top + rect.height - 3);
				window.dispatchEvent(
					new CustomEvent("row-menu-anchor", { detail: { x, y } }),
				);
				box.dispatchEvent(
					new MouseEvent("contextmenu", {
						bubbles: true,
						cancelable: true,
						clientX: x,
						clientY: y,
					}),
				);
				if (pressFork) {
					const item = await waitFor(
						() =>
							[
								...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
							].find((node) =>
								node.textContent?.includes("Fork conversation"),
							) ?? null,
					);
					if (!item || cancelled) return;
					await sleep(300);
					/*
					 * A real click, which is what Radix turns into the item's `onSelect`.
					 * Pressed after a beat so the open menu is on screen first and the
					 * readout's `items:` line can be compared with the after state.
					 */
					item.click();
				}
				if (pressCopy) {
					/*
					 * THE RECORDING CLIPBOARD (#893), installed BEFORE the press because
					 * `copySessionId` reads `navigator.clipboard.writeText` at call time. An own
					 * data property shadows the prototype's getter, so the stub works whether or
					 * not the browser exposes a clipboard at all, and it RESOLVES rather than
					 * rejecting so the helper takes its success path and raises its real toast.
					 */
					Object.defineProperty(navigator, "clipboard", {
						configurable: true,
						value: {
							writeText: (text: string) => {
								clipboardRecord.value = text;
								return Promise.resolve();
							},
						},
					});
					const item = await waitFor(
						() =>
							[
								...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
							].find((node) => node.textContent?.includes("Copy session ID")) ??
							null,
					);
					if (!item || cancelled) return;
					await sleep(300);
					/*
					 * A real click, which is what Radix turns into the item's `onSelect` - the
					 * same press `pressFork` makes, one row down (Copy is slot 4).
					 */
					item.click();
				}
				if (pressRename) {
					const item = await waitFor(
						() =>
							[
								...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
							].find((node) =>
								node.textContent?.includes("Rename conversation"),
							) ?? null,
					);
					if (!item || cancelled) return;
					await sleep(300);
					/*
					 * A real click, which is what Radix turns into the item's `onSelect` - the
					 * same press `pressFork` makes, one row further down (Rename is slot 5).
					 */
					item.click();
				}
				return;
			}
			/*
			 * THE KEYBOARD'S POINT is not chosen here at all: the story presses
			 * the key on the row's own button and the product synthesises the
			 * point from the box (`rect.left`, `rect.bottom - 1` - spec §3), which
			 * is what `keyboard-open` exists to photograph. The anchor line below
			 * states that prescribed point for the readout; the PANEL's own line
			 * is the observed placement.
			 */
			const button = box.querySelector<HTMLElement>("[data-chat-row]");
			window.dispatchEvent(
				new CustomEvent("row-menu-anchor", {
					detail: {
						x: Math.round(rect.left),
						y: Math.round(rect.top + rect.height - 1),
					},
				}),
			);
			button?.focus();
			button?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ContextMenu",
					bubbles: true,
					cancelable: true,
				}),
			);
		})();
		return () => {
			cancelled = true;
		};
	}, [
		sessionId,
		spot,
		delayMs,
		noMenu,
		search,
		pressFork,
		pressCopy,
		pressRename,
	]);

	return (
		<Readout
			sessionId={sessionId}
			showFork={pressFork}
			showCopy={pressCopy}
			showRename={pressRename}
		/>
	);
};

/**
 * The readout: the numbers the frame is read for, sampled from the DOM.
 *
 * `row-menu-anchor` carries the point the gesture was dispatched at (the pointer
 * path) or the point the product prescribes for the keyboard path, because the
 * anchor is a fact about the dispatch and leaves no trace in the DOM once the
 * primitive has positioned from it.
 */
const Readout: FC<{
	sessionId: string;
	showFork: boolean;
	showCopy: boolean;
	showRename: boolean;
}> = ({ sessionId, showFork, showCopy, showRename }) => {
	const [lines, setLines] = useState<string[]>([]);
	// The sampler runs outside React's render, so the route is a dependency of the
	// effect that owns it rather than something it can read each frame.
	const route = useLocation().pathname;
	const [anchor, setAnchor] = useState("none");

	useEffect(() => {
		const onAnchor = (event: Event) =>
			setAnchor(
				`${(event as CustomEvent<{ x: number; y: number }>).detail.x},${
					(event as CustomEvent<{ x: number; y: number }>).detail.y
				}`,
			);
		window.addEventListener("row-menu-anchor", onAnchor);
		/*
		 * SAMPLED EVERY FRAME, RENDERED ONLY ON CHANGE, and both halves are
		 * load-bearing. The panel is mounted a frame BEFORE the popper places it,
		 * so its first `getBoundingClientRect()` reports the pre-placement position
		 * (`2,0`, the side offset at the viewport corner); a sparse sampler can
		 * leave those numbers as the LAST rendered readout, which is a frame
		 * reading `at 2,0` over pixels that plainly show the settled panel. The
		 * per-frame cadence makes that window one frame wide instead of 200ms, and
		 * the change detection keeps it free: after the panel settles, nothing
		 * re-renders.
		 */
		const buildLines = (): string[] => {
			const menu = document.querySelector<HTMLElement>('[role="menu"]');
			const box = document.querySelector<HTMLElement>(
				`[data-session-row="${sessionId}"]`,
			);
			const pair = box?.querySelector<HTMLElement>(
				"[data-session-control-pair]",
			);
			const items = menu
				? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
						(node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "",
					)
				: [];
			const firstItem = menu?.querySelector<HTMLElement>('[role="menuitem"]');
			const active = document.activeElement;
			/*
			 * THE PRESS'S OBSERVABLE EFFECTS, in the states that press (#739's Fork,
			 * #920's Rename): the request the item wrote to the panel-presentation
			 * store - the destination and the conversation it NAMES (the row's, which is
			 * not the pane's; rename additionally carries the name the row draws) - the
			 * invoker (the row's own button) and the route (`/chat` is the palette's own
			 * rule, moved only when no pane is mounted). The store holds a request until
			 * a presenter consumes it, and this story has no pane, so it stays readable.
			 */
			const request = usePanelPresentationStore.getState().request;
			const requestLines = request
				? [
						`invoker: ${
							request.invoker
								? `${request.invoker.tagName.toLowerCase()}[${
										request.invoker.hasAttribute("data-chat-row")
											? "data-chat-row"
											: "?"
									}] in ${request.invoker.closest("[data-session-row]")?.getAttribute("data-session-row") ?? "?"}`
								: "none"
						}`,
						`route: ${route}`,
					]
				: ["invoker: none", `route: ${route}`];
			const addressed = request
				? `${request.destination} for ${request.sessionId ?? "(pane's own)"}`
				: "none";
			const fork = showFork
				? [`fork request: ${addressed}`, ...requestLines]
				: [];
			const rename = showRename
				? [
						`rename request: ${addressed}`,
						`name carried: ${request?.subjectName ?? "none"}`,
						...requestLines,
					]
				: [];
			/*
			 * THE COPY PRESS'S ONE OBSERVABLE EFFECT, only in the state that presses it:
			 * the string the item handed the clipboard - `none` until the press lands, so
			 * the line is the press rather than a decoration on every frame.
			 */
			const copy = showCopy
				? [`copied: ${clipboardRecord.value ?? "none"}`]
				: [];
			return [
				`anchor point: ${anchor}`,
				menu
					? `panel: ${Math.round(menu.getBoundingClientRect().width)}x${Math.round(
							menu.getBoundingClientRect().height,
						)} at ${Math.round(menu.getBoundingClientRect().left)},${Math.round(
							menu.getBoundingClientRect().top,
						)}`
					: "panel: none",
				`items: ${items.length}${items.length ? ` — ${items.join(" | ")}` : ""}`,
				box
					? `row ${sessionId}: ${Math.round(
							box.getBoundingClientRect().width,
						)}x${Math.round(
							box.getBoundingClientRect().height,
						)} at ${Math.round(box.getBoundingClientRect().left)},${Math.round(
							box.getBoundingClientRect().top,
						)} ground ${getComputedStyle(box).backgroundColor} data-state ${
							box.dataset.state ?? "none"
						}`
					: `row ${sessionId}: not drawn`,
				`pair: ${pair ? getComputedStyle(pair).display : "not mounted"} · flyout: ${
					document.querySelector('[role="tooltip"]') ? "present" : "absent"
				}`,
				/*
				 * THE PAIR'S OWN INTERNALS, because `pair: flex` is not the claim:
				 * the reveal is authored on the wrapper AND on each control inside
				 * it, so a wrapper that is `flex` can still hold nothing at all.
				 * Each entry is `<hook>:<display>:<left>w<width>`, and the hooks are
				 * the product's own (`data-session-archive`, `data-session-pin`).
				 */
				`pair children: ${
					pair
						? [...pair.children]
								.map((child) => {
									const hook = child.hasAttribute("data-session-archive")
										? "[archive]"
										: child.hasAttribute("data-session-pin")
											? "[pin]"
											: child.hasAttribute("data-session-pin-move")
												? `[${child.getAttribute("data-session-pin-move")}]`
												: "";
									const box = child.getBoundingClientRect();
									return `${child.tagName.toLowerCase()}${hook}:${
										getComputedStyle(child).display
									}:${Math.round(box.left)}w${Math.round(box.width)}`;
								})
								.join(" | ")
						: "not mounted"
				}`,
				`focus: ${
					active instanceof HTMLElement
						? `${active.getAttribute("role") ?? active.tagName.toLowerCase()}${
								/*
								 * No quote for the body: its `textContent` is the whole page, so the
								 * pointer frames used to read `focus: body “Name Description
								 * Default Control p…”` - the element's identity is the reading, not
								 * the storybook chrome's copy.
								 */
								active === document.body || !active.textContent?.trim()
									? ""
									: ` “${active.textContent.replace(/\s+/g, " ").trim().slice(0, 34)}”`
							}`
						: "none"
				}`,
				/*
				 * U-D4's minimum, read as its own line: on the keyboard path the
				 * FIRST item carries `data-highlighted` (the visible place the
				 * caret is); on the pointer path no item is highlighted and focus
				 * sits on the menu itself.
				 */
				`first item: ${
					firstItem
						? firstItem.hasAttribute("data-highlighted")
							? "data-highlighted"
							: "not highlighted"
						: "none"
				}`,
				...fork,
				...rename,
				...copy,
			];
		};
		/*
		 * A rAF chain rather than an interval, for the reason above: the readout
		 * has to be able to re-render on the very frame the panel is placed, not
		 * up to 200ms after it.
		 */
		let raf = 0;
		let lastStamped = "";
		const watch = () => {
			const next = buildLines();
			const stamp = next.join("\u0000");
			if (stamp !== lastStamped) {
				lastStamped = stamp;
				setLines(next);
			}
			raf = window.requestAnimationFrame(watch);
		};
		raf = window.requestAnimationFrame(watch);
		return () => {
			window.cancelAnimationFrame(raf);
			window.removeEventListener("row-menu-anchor", onAnchor);
		};
	}, [anchor, sessionId, showFork, showCopy, showRename, route]);

	return (
		<div
			data-readout-list=""
			className="overflow-hidden p-3 font-mono text-meta text-ink-dim"
		>
			{lines.map((line) => (
				<p key={line} data-readout="">
					{line}
				</p>
			))}
		</div>
	);
};

/* --------------------------------------------------------------- stories */

const Page: FC<{
	sessionId: string;
	spot: Spot;
	delayMs?: number;
	noMenu?: boolean;
	search?: string;
	pressFork?: boolean;
	pressCopy?: boolean;
	pressRename?: boolean;
}> = ({
	sessionId,
	spot,
	delayMs,
	noMenu,
	search,
	pressFork,
	pressCopy,
	pressRename,
}) => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		{/* The panel's own column: the app's 280px sidebar width, the width every
		    row-space decision in this change was measured at. */}
		<div
			className="shrink-0 border-r border-hairline"
			style={{ width: "280px" }}
		>
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		{/* The gap between the panel and the caption is the menu's own room. A
		    273px panel opening at the pointer would otherwise be read against the
		    caption's text, and neither would be legible. */}
		<div className="min-w-0 flex-1" />
		<div className="w-64 shrink-0 border-l border-hairline">
			<Panel
				sessionId={sessionId}
				spot={spot}
				delayMs={delayMs}
				noMenu={noMenu}
				search={search}
				pressFork={pressFork}
				pressCopy={pressCopy}
				pressRename={pressRename}
			/>
		</div>
	</div>
);

const meta = {
	title: "Chat sidebar/Row context menu",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/* The two row-capability shapes the matrix turns on. */
const BOTH = { pins: true, archive: true };
const ARCHIVE_OFF = { pins: true, archive: false };

const state = (
	name: string,
	args: {
		sessionId: string;
		spot: Spot;
		delayMs?: number;
		noMenu?: boolean;
		search?: string;
		/** The listed conversation a never-sent draft holds the id of (Fork withheld). */
		unstarted?: string;
		/** Press Fork once the menu is open and read the request it wrote. */
		pressFork?: boolean;
		/** Press Copy session ID once the menu is open and read the recorded value. */
		pressCopy?: boolean;
		/** Press Rename conversation once the menu is open and read the request it wrote (#920). */
		pressRename?: boolean;
		/**
		 * Hold any toast this state raises, in ms (#893).
		 *
		 * A toast self-closes after sonner's 4s, which is a frame that cannot be
		 * reproduced - the `credential-notice` set's own reason for the same parameter.
		 */
		toastDuration?: number;
		features: { pins: boolean; archive: boolean };
	},
): Story => ({
	name,
	// Only the states that raise a toast declare it, so the other frames keep
	// sonner's shipped duration rather than a rig-only value.
	...(args.toastDuration !== undefined
		? { parameters: { toastDuration: args.toastDuration } }
		: {}),
	render: () => {
		resetStores(args.unstarted);
		bridge(args.features);
		return (
			<Page
				sessionId={args.sessionId}
				spot={args.spot}
				delayMs={args.delayMs}
				noMenu={args.noMenu}
				search={args.search}
				pressFork={args.pressFork}
				pressCopy={args.pressCopy}
				pressRename={args.pressRename}
			/>
		);
	},
});

/** The menu at the pointer on a normal unpinned row, reveal and ground held. */
export const PointerOpen = state("Pointer open", {
	sessionId: "s2",
	spot: "pointer",
	features: BOTH,
});

/** The keyboard opener: anchored at the row's box edge, focus in the first item. */
export const KeyboardOpen = state("Keyboard open", {
	sessionId: "s2",
	spot: "keyboard",
	delayMs: 0,
	features: BOTH,
});

/** The menu on the pinned row: `Unpin conversation`, and the mark drawn at rest. */
export const PinnedRow = state("Pinned row", {
	sessionId: "s1",
	spot: "pointer",
	features: BOTH,
});

/** `pinned === undefined`: the pin row is withheld, not disabled. */
export const PinStateUnknown = state("Pin state unknown", {
	sessionId: "s3",
	spot: "pointer",
	features: BOTH,
});

/** `session_archive` absent: the archive row is withheld, not disabled. */
export const ArchiveWithheld = state("Archive capability withheld", {
	sessionId: "s2",
	spot: "pointer",
	features: ARCHIVE_OFF,
});

/**
 * The row is a never-sent draft's conversation: Fork is withheld - two rows, the
 * pair - because the backend has no transcript to copy, not disabled.
 */
export const ForkWithheld = state("Fork withheld, row never sent", {
	sessionId: "s2",
	spot: "pointer",
	unstarted: "s2",
	features: BOTH,
});

/**
 * Fork pressed on s2 - a conversation that is NOT the pane's (there is no pane
 * here at all). The readout is the sidebar's half of the contract: the request in
 * the panel-presentation store names `session.fork` FOR s2, the invoker is s2's
 * own row button, and the route has moved to `/chat` because nothing was mounted
 * to present it.
 */
export const ForkPressed = state("Fork pressed, request names the row", {
	sessionId: "s2",
	spot: "pointer",
	pressFork: true,
	features: BOTH,
});

/**
 * Copy pressed on s2 (#893) - the sixth row's own act, and the sidebar's half of
 * it.
 *
 * The story installs a RECORDING clipboard (see `clipboardRecord`), presses the
 * `Copy session ID` item through a real click, and the readout prints what was
 * recorded: `copied: s2`, where the value is the ROW's own conversation id. The
 * toast the helper raises is held with `toastDuration`, so it lands in the frame -
 * `.storybook/preview.tsx` mounts the app's own `ThemedToastContainer`, which is
 * the same container the app's toasts use.
 */
export const CopyPressed = state("Copy pressed, value recorded", {
	sessionId: "s2",
	spot: "pointer",
	pressCopy: true,
	toastDuration: 24 * 60 * 60 * 1000,
	features: BOTH,
});

/**
 * Rename pressed on s2 (#920) - the seventh row's act, and the only one whose
 * dialog shows a name: the readout is the sidebar's half of the contract, which
 * is what can be photographed here (there is no pane, so no picker opens).
 *
 * The request in the panel-presentation store names `session.rename` FOR s2 -
 * the row the user pointed at, not a pane's - and CARRIES the name that row
 * draws (`Migrate the deploy script`); the invoker is s2's own row button, and
 * the route has moved to `/chat` because nothing was mounted to present it.
 * The pane's half - the dialog's field opening on that name rather than on the
 * pane's title, and the `sessions.command` `rename` it submits for s2 - is the
 * shipped `RenamePicker` + `slash-dispatch` consume path, pinned in
 * `scripts/panel-presentation.test.mjs`.
 */
export const RenamePressed = state("Rename pressed, request names the row", {
	sessionId: "s2",
	spot: "pointer",
	pressRename: true,
	features: BOTH,
});

/** The dwelled flyout, then the menu: the flyout is absent under the open menu. */
export const FlyoutDwelled = state("Flyout dwelled before the menu opened", {
	sessionId: "s2",
	spot: "pointer",
	delayMs: 1800,
	features: BOTH,
});

/** The control for the frame above: same hover, same dwell, NO menu opened. */
export const FlyoutAlone = state("Flyout dwelled with no menu", {
	sessionId: "s2",
	spot: "pointer",
	noMenu: true,
	features: BOTH,
});

/** The before to `pointer-open`'s after: the same row under the pointer, no menu. */
export const MenuClosed = state("Row under the pointer, no menu", {
	sessionId: "s2",
	spot: "pointer",
	noMenu: true,
	features: BOTH,
});

/**
 * `Unarchive conversation` on the archived row, reached the way the feature
 * reaches it: a widened search (`Include archived`), then the menu at the row's
 * own box. This label is the widest this menu draws, so the frame closes the
 * width table's archived case as well as the copy variant.
 */
export const ArchivedRow = state("Archived row, unarchive at the pointer", {
	sessionId: "s4",
	spot: "pointer",
	features: BOTH,
	search: "Invoice",
});
