/**
 * The renderer half of S2's visual mirror: measure the URL field and the dock,
 * project what the in-flow list already shows, and route a validated row click
 * back into the existing `commit()`.
 *
 * WHAT STAYS IN THE PARENT (by design, not by omission): the input, DOM focus,
 * IME composition, undo, every key and the accessible combobox. This hook never
 * focuses, never moves selection into the child and never changes `activeIndex`
 * on hover. A commit from the child is accepted only when it names the SAME
 * projection the child was measured on and the candidate at that index still has
 * the key it projected — otherwise the click is dropped silently. A wrong
 * navigation is the failure this guards; a lost click is acceptable.
 *
 * WHY IT MEASURES EVERY FRAME: a position-only shift (a sidebar collapse moves
 * the toolbar sideways without resizing it) is invisible to ResizeObserver and
 * to the page's own rectangle reporter. Only while the list is open, the hook
 * compares a signature; identical frames send nothing.
 */

import { type RefObject, useEffect, useRef } from "react";
import { lastDeliveredContentRect } from "../hooks/use-browser-chrome";
import {
	type AddressOverlayPost,
	type AddressOverlayTheme,
	type AddressOverlayView,
	addressOverlayPort,
	nextAddressOverlaySeq,
} from "./address-overlay-port";

export interface AddressMirrorRow {
	text: string;
	title: string;
	/** The candidate's stable identity (its URL). Never sent: it exists so a
	 * click can be checked against the row the child actually painted. */
	key: string;
}

export interface AddressMirrorInput {
	enabled: boolean;
	tabId: number | null;
	visible: boolean;
	active: number;
	rows: AddressMirrorRow[];
	noticeKind: "error" | "hint" | "empty" | "no_match";
	noticeText: string;
	label: string;
	fieldRef: RefObject<HTMLInputElement | null>;
	listRef: RefObject<HTMLDivElement | null>;
	onCommit: (index: number) => void;
}

/** The dock's theme tokens, read through a scratch element because the app's
 * tokens are declared as `var(...)` chains: `getPropertyValue` on the root would
 * return the unresolved chain, not the rgb() the child can paint. */
const THEME_READS: Array<
	[
		keyof AddressOverlayTheme,
		string,
		"backgroundColor" | "color" | "borderTopColor" | "borderBottomColor",
	]
> = [
	["elevated", "--color-elevated", "backgroundColor"],
	["ink", "--color-ink", "color"],
	["inkMuted", "--color-ink-muted", "color"],
	["accent", "--color-accent", "backgroundColor"],
	["accentWash", "--color-accent-wash", "backgroundColor"],
	["rowHover", "--color-row-hover", "backgroundColor"],
	["hairline", "--color-hairline", "borderTopColor"],
	["control", "--color-control", "borderBottomColor"],
];

const RGBA = /rgba\(/;
const OPAQUE_COLOR = /^(#[0-9a-f]{6}|rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\))$/i;

let themeCache: { key: string; theme: AddressOverlayTheme | null } | null =
	null;

function themeKey(): string {
	const root = document.documentElement;
	const scheme =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	return `${root.className}|${root.dataset.theme ?? ""}|${scheme}`;
}

/**
 * Resolve the eight tokens to concrete `rgb(...)`/`#rrggbb` values. A token that
 * resolves to a colour with alpha, or to nothing, makes the WHOLE theme `null`:
 * the child must be opaque, and a half-themed surface is worse than the neutral
 * fallback (main records `theme:"fallback"`).
 */
function resolveTheme(): AddressOverlayTheme | null {
	const key = themeKey();
	if (themeCache !== null && themeCache.key === key) return themeCache.theme;
	const scratch = document.createElement("div");
	scratch.style.display = "none";
	document.body.append(scratch);
	const theme = {} as AddressOverlayTheme;
	let ok = true;
	try {
		for (const [name, variable, property] of THEME_READS) {
			scratch.style[property] = `var(${variable})`;
			const value = window.getComputedStyle(scratch)[property] ?? "";
			scratch.style[property] = "";
			if (
				typeof value !== "string" ||
				value === "" ||
				RGBA.test(value) ||
				!OPAQUE_COLOR.test(value)
			) {
				ok = false;
				break;
			}
			theme[name] = value;
		}
	} finally {
		scratch.remove();
	}
	const resolved = ok ? theme : null;
	themeCache = { key, theme: resolved };
	return resolved;
}

function roundRect(rect: DOMRect): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	return {
		x: Math.round(rect.left),
		y: Math.round(rect.top),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
}

function viewOf(input: AddressMirrorInput): AddressOverlayView {
	if (input.rows.length > 0) {
		return {
			kind: "rows",
			rows: input.rows.map((row) => ({ text: row.text, title: row.title })),
		};
	}
	return {
		kind: "notice",
		notice: input.noticeKind,
		text: input.noticeText,
	};
}

export function useAddressOverlayMirror(input: AddressMirrorInput): void {
	const latest = useRef(input);
	latest.current = input;

	useEffect(() => {
		if (!input.enabled) return;
		const port = addressOverlayPort();
		if (!port) return;

		let frame = 0;
		let wasVisible = false;
		let lastSignature = "";
		let projected: { seq: number; keys: string[] } | null = null;

		const unsubscribe = port.onEvent((event) => {
			if (!event || typeof event !== "object") return;
			const commit = event as {
				type?: unknown;
				seq?: unknown;
				index?: unknown;
			};
			if (commit.type !== "commit") return;
			if (!Number.isInteger(commit.seq) || !Number.isInteger(commit.index)) {
				return;
			}
			const seq = commit.seq as number;
			const index = commit.index as number;
			const current = latest.current;
			// Three independent freshness checks: the seq the child painted, the
			// list still being open, and the same candidate still occupying the row
			// the user pressed. Any mismatch is a dropped click.
			if (projected === null || seq !== projected.seq) return;
			if (!current.visible) return;
			if (index < 0 || index >= projected.keys.length) return;
			if (current.rows[index]?.key !== projected.keys[index]) return;
			current.onCommit(index);
		});

		const sendHide = (): void => {
			const current = latest.current;
			if (current.tabId === null) return;
			const hidden: AddressOverlayPost = {
				v: 1,
				seq: nextAddressOverlaySeq(),
				tabId: current.tabId,
				visible: false,
			} as AddressOverlayPost;
			void port.project(hidden).catch(() => {});
		};

		const tick = (): void => {
			frame = requestAnimationFrame(tick);
			const current = latest.current;
			if (!current.enabled) return;
			if (!current.visible || current.tabId === null) {
				if (wasVisible) {
					wasVisible = false;
					lastSignature = "";
					projected = null;
					sendHide();
				}
				return;
			}
			const field = current.fieldRef.current;
			const list = current.listRef.current;
			const pageRect = lastDeliveredContentRect();
			if (!field || !list || pageRect === null) return;
			const fieldRect = roundRect(field.getBoundingClientRect());
			const listTop = Math.round(list.getBoundingClientRect().top);
			const view = viewOf(current);
			const theme = resolveTheme();
			const dir: "ltr" | "rtl" =
				window.getComputedStyle(document.documentElement).direction === "rtl"
					? "rtl"
					: "ltr";
			const body = {
				v: 1 as const,
				tabId: current.tabId,
				visible: true,
				pageRect,
				field: fieldRect,
				listTop,
				active: current.active,
				view,
				label: current.label,
				dir,
				...(theme ? { theme } : {}),
			};
			const signature = JSON.stringify(body);
			if (signature === lastSignature) return;
			lastSignature = signature;
			wasVisible = true;
			const seq = nextAddressOverlaySeq();
			projected = {
				seq,
				keys: view.kind === "rows" ? current.rows.map((row) => row.key) : [],
			};
			const payload = { ...body, seq } as AddressOverlayPost;
			void port
				.project(payload)
				.then((result) => {
					// A refusal other than an out-of-order frame means what is on the
					// child no longer matches; let the next frame project again.
					const answer = result as { accepted?: unknown; reason?: unknown };
					if (
						answer &&
						answer.accepted === false &&
						answer.reason !== "stale_seq"
					) {
						lastSignature = "";
					}
				})
				.catch(() => {
					lastSignature = "";
				});
		};

		tick();
		return () => {
			cancelAnimationFrame(frame);
			unsubscribe();
			if (wasVisible) sendHide();
		};
	}, [input.enabled]);
}
