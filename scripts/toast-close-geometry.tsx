/**
 * Rendered-geometry harness: a toast's close button, in the state the operator
 * reported it in.
 *
 * See `toast-close-geometry.html` for why this page exists rather than a story
 * or a live-app capture. What it mounts is the SHIPPED pair and nothing else:
 *
 *   - `ThemedToastContainer`, the component `main.tsx` mounts, with the props
 *     it is mounted with. Its inline `TOAST_THEME` is where the close button's
 *     placement is declared, so a harness that re-typed those properties would
 *     be measuring its own copy of the bug rather than the app's;
 *   - the SHIPPED receipt copy, fired through the SHIPPED toast manager. The
 *     operator's toast is `Marked 7 chats as read.` from `markAllReadReceipt`,
 *     so the harness calls that function with a receipt instead of pasting the
 *     sentence: the words in the frame are the app's, and a copy change moves
 *     the frame rather than leaving it a picture of a string that no longer
 *     exists.
 *
 * `shape` picks the body, because the claim is about a corner of a box whose
 * height is not fixed:
 *
 *   - `one-line`    the operator's own toast: `Marked 7 chats as read.`
 *   - `multi-line`  the same receipt with the two remainder sentences under it,
 *                   which is a toast that wraps to several lines.
 *
 * The lifetime is held open (`Number.POSITIVE_INFINITY`, the prop the canvas
 * refusal story already uses for this) because a capture has to land and the
 * lifetime is not what is under test here — `scripts/toast-lifetime.test.mjs`
 * owns that, and a duration cannot move a box's position. Nothing else about
 * the mount differs from production: the container is not wrapped in the app's
 * providers, deliberately, because the toaster reads its colours from the
 * document's `data-theme` custom properties and its placement from its own
 * props, so a provider stack here would be scenery rather than fidelity.
 */

import { markAllReadReceipt } from "@renderer/features/chat/mark-all-read";
import type { MarkAllReadReceipt } from "@renderer/features/chat/mark-all-read";
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./toast-close-geometry.css";

const params = new URLSearchParams(window.location.search);
const THEME = (params.get("theme") ?? DEFAULT_THEME) as ThemeName;
const SHAPE = params.get("shape") ?? "one-line";

applyThemeToDocument(THEME);

/**
 * The two receipts, both read from the timeline the sidebar draws: what the
 * operator clicked, and the same click over a batch the backend answered only
 * in part — which is the receipt contract's own multi-sentence arm.
 */
const RECEIPTS: Record<string, MarkAllReadReceipt> = {
	"one-line": { attempted: 7, cleared: 7, superseded: 0, unknown: 0 },
	"multi-line": { attempted: 10, cleared: 7, superseded: 2, unknown: 1 },
};

const receipt = RECEIPTS[SHAPE];
if (!receipt) throw new Error(`unknown shape \`${SHAPE}\``);

const copy = markAllReadReceipt(receipt);
if (copy.tone !== "success")
	throw new Error(
		`the \`${SHAPE}\` receipt is the ${copy.tone} arm; the operator's toast is the success one`,
	);

/**
 * Fired once, from an effect rather than at module scope: the toaster
 * subscribes to sonner's store on mount, and firing before it is subscribed
 * relies on sonner's queue instead of on the path the app takes (the sidebar's
 * click handler runs long after mount).
 */
let fired = false;

const Harness = () => {
	useEffect(() => {
		if (fired) return;
		fired = true;
		showSuccessToast(copy.message);
	}, []);

	return <ThemedToastContainer duration={Number.POSITIVE_INFINITY} />;
};

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
