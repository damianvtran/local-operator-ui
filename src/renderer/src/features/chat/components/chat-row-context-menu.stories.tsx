/**
 * PROPOSAL — the row context menu's composition. NOT SHIPPED BEHAVIOUR.
 *
 * Nothing in this file is the implementation, and nothing it renders exists in
 * the app: `chat-sidebar.tsx` has no context menu at all at this head. What
 * this file is for is the DESIGN ROUND of `#694` - the pixels the spec at
 * `docs/design/row-context-menu.md` is arguing about, so that the composition,
 * the copy, the chord hints, the panel's own width and the anchoring point can
 * be judged from frames instead of from a source diff.
 *
 * Three things it therefore does NOT do, each stated where it bites:
 *
 *   - **The trigger is a probe, not the row box.** The real change wraps the
 *     row's box (`[data-session-row]`) in the primitive's trigger; here an
 *     invisible zero-hit-area span stands in and a real `contextmenu` event is
 *     dispatched at the coordinates the spec names. The primitive anchors from
 *     `event.clientX/clientY` (`@radix-ui/react-context-menu@2.3.7`,
 *     `dist/index.mjs:63-70`), so the panel lands exactly where the row-box
 *     trigger would put it - which is the whole point of the probe.
 *   - **The reveal-under-an-open-menu hold is SIMULATED** in the `hold` frames.
 *     `data-state="open"` is stamped on the row's box and the two utility
 *     classes the spec prescribes are applied to the box and to the pair; the
 *     story does not edit `chat-sidebar.tsx`. Those frames are therefore
 *     pictures of the SPEC, not of a built implementation, and the frames
 *     without `hold` are the honest control: what the primitive alone does when
 *     its modal layer takes `pointer-events` off the page.
 *   - **The item set is passed in as props**, because the predicates
 *     (`row.pinned !== undefined`, `archiveEnabled`) are wired in the
 *     implementation, not here. The frames show the COMPOSITION for each
 *     predicate outcome, one per state.
 *
 * The readout beside the panel prints what the frame is read for, sampled from
 * the DOM - the panel's own box, the anchoring point, the row's ground, the
 * pair's display and where focus is - so a frame cannot claim a number the app
 * does not hold.
 */

import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@shared/components/ui/context-menu";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { Archive, ArchiveRestore, Pin, PinOff } from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { DEFAULT_SIDEBAR_VIEW } from "../chat-sidebar-view";
import { ChatSidebar } from "./chat-sidebar";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = { op: string; q?: string };

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
	active: true,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Recent" },
	status_revision: 1,
	status_epoch: EPOCH,
	...over,
});

/**
 * Three conversations, one of them pinned.
 *
 * The pinning is what makes the `Unpin conversation` frame a state of the REAL
 * panel rather than a prop summary: `pinned: true` puts the row in the pinned
 * section with its mark drawn at rest, which is the row the menu is opened on.
 */
const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

const roster = (): WireRow[] => {
	const now = NOW_SECONDS();
	return [
		row("s1", "Reconcile the supplier ledger", now - 60, { pinned: true }),
		row("s2", "Migrate the deploy script", now - 300, { pinned: false }),
		/*
		 * NO `pinned` FIELD AT ALL, which is the one state a catalogue row cannot
		 * reach: `pinned` is always present on a row from a pins-capable backend,
		 * and the field is missing only on a row the app SYNTHESISED from a search
		 * hit whose backend does not describe the pin state. The frame this row
		 * carries is therefore the composition for that predicate outcome, and the
		 * row itself draws no pin control at all - which is the product's own
		 * half of the same rule.
		 */
		row("s3", "Quarterly revenue model", now - 900),
	];
};

/**
 * The bridge, with the two capabilities the row's acts hang off as parameters.
 *
 * `session_archive` absent is the capability-withheld frame; both absent is the
 * withdrawn panel the spec requires to stay byte-identical.
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
			case "sessions.search":
				return ok({
					query: request.q ?? "",
					limit: 100,
					sessions: rows.filter((entry) =>
						entry.name
							.toLowerCase()
							.includes((request.q ?? "").toLocaleLowerCase()),
					),
				});
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

/* ------------------------------------------------------------- the menu */

/**
 * The chord, in the spelling `KeyboardShortcut` renders as one chord.
 *
 * The spec proposes this as a `+`-joined SIBLING of `chatRowActCap`
 * (`chat-regions.ts:246-249`), which returns `⌘⇧P` / `Ctrl+Shift+P` - a string
 * the shared component splits on `+` and therefore renders, fed as-is, as ONE
 * cap three glyphs wide (U7). `⌘+⇧+P` under `joined` is the app's own two-key
 * idiom generalised: the `+` is the separator, `joined` is what stops the
 * separator being printed, and the caps then sit at the `gap-0` ink distance
 * the sidebar's own rows were measured at (6px and 7px,
 * `docs/evidence/chat-sidebar-current-row/README.md`).
 */
const chord = (key: "P" | "A", isMac: boolean): string =>
	isMac ? `⌘+⇧+${key}` : `Ctrl+Shift+${key}`;

const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * The proposed panel, as a composition over the primitive.
 *
 * Every row is a labelled act with the chord it answers to at the trailing
 * edge: the mirror (archive, pin) plus the slot reserved for `#693` - which is
 * EMPTY in this change, so nothing here draws a third row. Withheld states are
 * absent rows, never disabled ones: `archiveEnabled` false drops the archive
 * row, an unknown pin state (`pinned === undefined`) drops the pin row, and
 * neither drops the whole menu (the trigger is then not attached at all).
 */
const RowContextMenu: FC<{
	archived: boolean;
	pinned: boolean | undefined;
	archiveEnabled: boolean;
	children: ReactNode;
}> = ({ archived, pinned, archiveEnabled, children }) => (
	<ContextMenu>
		<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
		<ContextMenuContent className="min-w-56" data-proposal-menu="">
			{archiveEnabled && (
				<ContextMenuItem
					data-proposal-item="archive"
					onSelect={() => undefined}
				>
					{archived ? (
						<ArchiveRestore aria-hidden="true" />
					) : (
						<Archive aria-hidden="true" />
					)}
					<span>
						{archived ? "Unarchive conversation" : "Archive conversation"}
					</span>
					<span className="ml-auto pl-6">
						<KeyboardShortcut shortcut={chord("A", IS_MAC)} joined />
					</span>
				</ContextMenuItem>
			)}
			{pinned !== undefined && (
				<ContextMenuItem data-proposal-item="pin" onSelect={() => undefined}>
					{pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
					<span>{pinned ? "Unpin conversation" : "Pin conversation"}</span>
					<span className="ml-auto pl-6">
						<KeyboardShortcut shortcut={chord("P", IS_MAC)} joined />
					</span>
				</ContextMenuItem>
			)}
		</ContextMenuContent>
	</ContextMenu>
);

/* ------------------------------------------------- the simulation, named */

/**
 * The two utility classes the spec prescribes for the row under its own open
 * menu, written here as literals so that the Tailwind build compiles them.
 *
 * The story applies them to the real row box and the real pair div, with the
 * `data-state` the primitive's trigger would stamp. This is the SIMULATION the
 * header of this file declares - the frames that use it are pictures of the
 * spec, and `hold: false` frames are the control that shows what the primitive
 * alone leaves behind.
 */
const HOLD_BOX = "data-[state=open]:bg-row-hover";
const HOLD_PAIR = "group-data-[state=open]:flex";

/**
 * Every element in the row that reveals itself through `group-hover:flex` gets
 * the open-state spelling of the same rule.
 *
 * THE REVEAL IS AUTHORED TWICE and that is not obvious from the outside: the
 * pair wrapper is `hidden group-hover:flex ...`, AND each control's own glyph
 * carries the same pair of variants. Forcing only the wrapper therefore gives a
 * `flex` box with nothing in it - which is exactly what the first pass of this
 * story photographed, a revealed pair with no glyphs, against a readout that
 * said `pair: flex` and looked right. The selector is the class string Tailwind
 * compiles from, so it finds the elements the product reveals and no others.
 */
const holdRevealed = (box: HTMLElement, on: boolean) => {
	for (const node of box.querySelectorAll<HTMLElement>(
		'[class*="group-hover:flex"]',
	)) {
		if (on) node.classList.add(...HOLD_PAIR.split(" "));
		else node.classList.remove(...HOLD_PAIR.split(" "));
	}
};

const applyHold = (sessionId: string, on: boolean) => {
	const box = document.querySelector<HTMLElement>(
		`[data-session-row="${sessionId}"]`,
	);
	if (!box) return;
	if (on) {
		box.dataset.state = "open";
		box.classList.add(...HOLD_BOX.split(" "));
	} else {
		delete box.dataset.state;
		box.classList.remove(...HOLD_BOX.split(" "));
	}
	holdRevealed(box, on);
};

/* --------------------------------------------------------------- helpers */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resetStores = () => {
	useUiPreferencesStore.setState({
		chatSidebarView: { ...DEFAULT_SIDEBAR_VIEW },
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "entities-first",
	});
};

/* ---------------------------------------------------------------- the rig */

type Spot = "pointer" | "keyboard";

const Panel: FC<{
	/** Which row box the gesture lands on, by wire id. */
	sessionId: string;
	/** Where inside the row the anchor sits. */
	spot: Spot;
	/** Stamp the spec's hold rule on the row once the menu is open. */
	hold: boolean;
	/**
	 * How long the row waits before its menu opens, in ms.
	 *
	 * Non-zero for exactly one state: the flyout needs a real pointer dwelling
	 * inside the row for `TOOLTIP_DELAY_MS` (400) before it draws, so a menu that
	 * opened on mount would always beat it. The dwelled frame therefore opens the
	 * menu LATE and lets the rig's hover go first.
	 */
	delayMs?: number;
	/** The row's own state, passed in: the predicates are the implementation's. */
	menu: {
		archived: boolean;
		pinned: boolean | undefined;
		archiveEnabled: boolean;
	};
	/**
	 * Skip the open entirely, and leave the pointer on the row.
	 *
	 * This is the `flyout-dwelled` frame's CONTROL, and it exists because
	 * "the flyout is absent under an open menu" is worth nothing without proof
	 * that the flyout can be present in this scene at all: a dead instrument
	 * returns a reading, not an error. Same story, same hover, same dwell, no
	 * menu - if the control frame shows no flyout either, the dwelled frame's
	 * absence is the rig's, not the menu's.
	 */
	noMenu?: boolean;
}> = ({ sessionId, spot, hold, delayMs = 250, noMenu = false, menu }) => {
	const trigger = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			let box: HTMLElement | null = null;
			for (let i = 0; i < 120 && !box; i++) {
				box = document.querySelector<HTMLElement>(
					`[data-session-row="${sessionId}"]`,
				);
				if (!box) await sleep(100);
			}
			if (!box || cancelled) return;
			/*
			 * The row has to be IN the frame for its ground and its pair to be
			 * readable, and the sidebar's own list scrolls: the probe parks the
			 * target row in the middle of the list's box first, then measures.
			 */
			box.scrollIntoView({ block: "center" });
			await sleep(60);
			if (delayMs > 0) await sleep(delayMs);
			if (cancelled) return;
			if (noMenu) return;
			const rect = box.getBoundingClientRect();
			/*
			 * THE TWO ANCHORS THE SPEC NAMES. The pointer path opens where the
			 * pointer is - the middle of the row, which is where a user's pointer
			 * actually rests when they right-click a title. The keyboard path opens
			 * at the row's own left edge, and the coordinates are SYNTHESISED from
			 * the box rather than taken from the ambient event, because a keyboard
			 * `contextmenu` carries no usable point (open question 2).
			 */
			const x =
				spot === "pointer"
					? Math.round(rect.left + rect.width / 2)
					: Math.round(rect.left + 2);
			/*
			 * `rect.bottom - 3` rather than the row's middle, and the reason is the
			 * FRAME rather than the interaction: a 273px panel opening from a point
			 * inside a 255px row covers that row whole, so the row's own held reveal
			 * - the thing this state exists to show - would be under the panel. A
			 * right-click in the row's lower-left corner is an ordinary gesture and
			 * puts the panel just below the row it belongs to. The keyboard
			 * synthesis lands on the same line for the same reason.
			 */
			const y = Math.round(rect.top + rect.height - 3);
			window.dispatchEvent(
				new CustomEvent("proposal-anchor", { detail: { x, y } }),
			);
			trigger.current?.dispatchEvent(
				new MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					clientX: x,
					clientY: y,
				}),
			);
			if (hold) {
				/*
				 * Re-stamped twice, because a row's class list is React's to write:
				 * any re-render between the open and the shutter would replace the
				 * classes this simulation adds, and the frame would quietly
				 * photograph the unheld state under the held state's name.
				 */
				applyHold(sessionId, true);
				await sleep(120);
				if (hold) applyHold(sessionId, true);
				await sleep(300);
				if (hold) applyHold(sessionId, true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [sessionId, spot, hold, delayMs, noMenu]);

	useEffect(() => () => applyHold(sessionId, false), [sessionId]);

	return (
		<>
			{/*
			 * The probe. Zero hit area and `pointer-events-none`, so the rig's real
			 * pointer reaches the ROW underneath it and photographs the row's own
			 * hover ground - which is the state the menu is judged against.
			 */}
			<RowContextMenu {...menu}>
				<span
					ref={trigger}
					data-proposal-trigger=""
					className="pointer-events-none fixed size-0"
				/>
			</RowContextMenu>
			<Readout sessionId={sessionId} />
		</>
	);
};

/**
 * The readout: the numbers the frame is read for, sampled from the DOM.
 *
 * `proposal-anchor` carries the point the gesture was dispatched at, because
 * the anchor is a fact about the DISPATCH and leaves no trace in the DOM once
 * the primitive has positioned from it.
 */
const Readout: FC<{ sessionId: string }> = ({ sessionId }) => {
	const [lines, setLines] = useState<string[]>([]);
	const [anchor, setAnchor] = useState("none");

	useEffect(() => {
		const onAnchor = (event: Event) =>
			setAnchor(
				`${(event as CustomEvent<{ x: number; y: number }>).detail.x},${
					(event as CustomEvent<{ x: number; y: number }>).detail.y
				}`,
			);
		window.addEventListener("proposal-anchor", onAnchor);
		const sample = () => {
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
			const active = document.activeElement;
			setLines([
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
								active.textContent?.trim()
									? ` “${active.textContent.replace(/\s+/g, " ").trim().slice(0, 34)}”`
									: ""
							}`
						: "none"
				}`,
			]);
		};
		sample();
		const timer = window.setInterval(sample, 200);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("proposal-anchor", onAnchor);
		};
	}, [anchor, sessionId]);

	return (
		<div className="overflow-hidden p-3 font-mono text-meta text-ink-dim">
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
	hold: boolean;
	delayMs?: number;
	noMenu?: boolean;
	menu: {
		archived: boolean;
		pinned: boolean | undefined;
		archiveEnabled: boolean;
	};
}> = ({ sessionId, spot, hold, delayMs, noMenu, menu }) => (
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
				hold={hold}
				delayMs={delayMs}
				noMenu={noMenu}
				menu={menu}
			/>
		</div>
	</div>
);

const meta = {
	title: "Chat sidebar/Row context menu (proposal)",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/* The two row-capability shapes the spec's matrix turns on. */
const BOTH = { pins: true, archive: true };
const ARCHIVE_OFF = { pins: true, archive: false };

/* The state of the row the menu is opened on. */
const NORMAL = { archived: false, pinned: false, archiveEnabled: true };
const PINNED_ROW = { archived: false, pinned: true, archiveEnabled: true };
const UNKNOWN_PIN = {
	archived: false,
	pinned: undefined,
	archiveEnabled: true,
};

const state = (
	name: string,
	args: {
		sessionId: string;
		spot: Spot;
		hold: boolean;
		delayMs?: number;
		noMenu?: boolean;
		features: { pins: boolean; archive: boolean };
		menu: {
			archived: boolean;
			pinned: boolean | undefined;
			archiveEnabled: boolean;
		};
	},
): Story => ({
	name,
	render: () => {
		resetStores();
		bridge(args.features);
		return (
			<Page
				sessionId={args.sessionId}
				spot={args.spot}
				hold={args.hold}
				delayMs={args.delayMs}
				noMenu={args.noMenu}
				menu={args.menu}
			/>
		);
	},
});

/** The menu at the pointer, on a normal unpinned row, with the spec's hold rule. */
export const PointerOpen = state("Pointer open", {
	sessionId: "s2",
	spot: "pointer",
	hold: true,
	features: BOTH,
	menu: NORMAL,
});

/** The control for the frame above: what the primitive ALONE leaves behind. */
export const PointerOpenUnheld = state("Pointer open, hold rule not applied", {
	sessionId: "s2",
	spot: "pointer",
	hold: false,
	features: BOTH,
	menu: NORMAL,
});

/** The same menu on the pinned row: `Unpin conversation`, and the mark at rest. */
export const PinnedRow = state("Pinned row", {
	sessionId: "s1",
	spot: "pointer",
	hold: true,
	features: BOTH,
	menu: PINNED_ROW,
});

/** The keyboard opener's anchoring: the row's left edge, focus in the first item. */
export const KeyboardOpen = state("Keyboard open", {
	sessionId: "s2",
	spot: "keyboard",
	hold: true,
	delayMs: 0,
	features: BOTH,
	menu: NORMAL,
});

/** `session_archive` absent: the archive row is withheld, not disabled. */
export const ArchiveWithheld = state("Archive capability withheld", {
	sessionId: "s2",
	spot: "pointer",
	hold: true,
	features: ARCHIVE_OFF,
	menu: { archived: false, pinned: false, archiveEnabled: false },
});

/** An unknown pin state: the pin row is withheld and one row remains. */
export const PinStateUnknown = state("Pin state unknown", {
	sessionId: "s3",
	spot: "pointer",
	hold: true,
	features: BOTH,
	menu: UNKNOWN_PIN,
});

/** The dwelled flyout beside an open menu: the collision U5 names. */
/** The control for the frame below: same hover, same dwell, NO menu opened. */
export const FlyoutAlone = state("Flyout dwelled with no menu", {
	sessionId: "s2",
	spot: "pointer",
	hold: false,
	noMenu: true,
	features: BOTH,
	menu: NORMAL,
});

export const FlyoutDwelled = state("Flyout dwelled before the menu opened", {
	sessionId: "s2",
	spot: "pointer",
	hold: true,
	delayMs: 1800,
	features: BOTH,
	menu: NORMAL,
});
