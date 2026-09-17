/**
 * What a link in a transcript points at, and what may be done with it.
 *
 * Two rules with a right answer live here rather than in the components, for the
 * same reason `quote-model.ts` and `transcript-rows.ts` do: they are asserted
 * directly (`scripts/link-actions.test.mjs`) instead of being read off a frame.
 *
 * 1. **Classification.** A link's href is a URL, a local path, or something else
 *    entirely (a `mailto:`, an unknown scheme, a relative token markdown
 *    captured). Only the first two get the new affordances; everything else keeps
 *    exactly the behaviour it had, which is why "something else" is a case here
 *    rather than a default that quietly inherits the new one.
 * 2. **The matrix.** Which buttons a link's toolbar shows is a function of the
 *    probe's answer, and the three states are not variations on one: a file gets
 *    Open and Open folder, a DIRECTORY gets Open and no folder (a Finder reveal
 *    of a directory is a no-op on macOS), and a missing path gets neither — a
 *    press that would silently do nothing is the thing this matrix exists to
 *    prevent, so the missing case states the reason instead.
 *
 * Pure except for the probe cache, which is module-level on purpose: a row
 * re-renders per delta while a turn streams, so a per-row probe would be a stat
 * storm, and `probe-files` caps its batch at `MAX_PROBE_PATHS` anyway. The cache
 * is keyed by the SPELLING the transcript wrote - `~/x` and `/Users/you/x` are
 * two keys for one file, and that is the right granularity here: the toolbar
 * acts on the string the reader is looking at.
 *
 * Nothing here reads `window` or the DOM; the caller injects the probe function,
 * which is what lets the whole matrix be asserted without an Electron process.
 */

import { normalizeFileUrl } from "./link-grammar";

export type LinkKind = "url" | "file" | "other";

export type LinkTarget = {
	kind: LinkKind;
	/** The URL as written, or the local path (never a `file://` URL). */
	target: string;
};

/** An `http(s)` href. The only scheme this app opens in a browser. */
const HTTP_HREF = /^https?:\/\//i;

/** A `file://` href, which the app writes and a hand-written link may contain. */
const FILE_HREF = /^file:\/\//i;

/**
 * What an href names, from its shape alone.
 *
 * Deliberately shape-based rather than provenance-based: the linkifier's own
 * anchors and a hand-written `[report](/Users/you/report.xlsx)` are the same
 * kind of thing to a reader, and giving them different behaviour would be a
 * distinction nobody can see. What the SHAPE cannot answer - "does this exist" -
 * is the probe's job, not this function's.
 *
 * Returns `null` for a missing href; `other` for anything else, including the
 * relative token markdown happily captures (`notes.md`) and a scheme this app
 * has no business opening.
 */
export function classifyHref(
	href: string | null | undefined,
): LinkTarget | null {
	if (!href) return null;
	if (HTTP_HREF.test(href)) return { kind: "url", target: href };
	if (FILE_HREF.test(href)) {
		const path = normalizeFileUrl(href);
		/*
		 * A `file://` URL that does not parse as one local path is NOT
		 * downgraded to a plain path: `file://other-host/share` names another
		 * machine's share, and opening it would be a press that fails inside
		 * Finder. `other` keeps it exactly as inert as it was.
		 */
		return path
			? { kind: "file", target: path }
			: { kind: "other", target: href };
	}
	/*
	 * `~` and `/` are the two roots this app can resolve without guessing.
	 * Everything else - `notes.md`, `./x`, `ftp://…`, `mailto:…` - is `other`.
	 */
	if (href.startsWith("/") || href.startsWith("~/")) {
		return { kind: "file", target: href };
	}
	return { kind: "other", target: href };
}

/**
 * Whether a plain click on this kind of target is the app's to handle.
 *
 * Only a local file. A URL keeps the behaviour it already had (`target="_blank"`
 * into `setWindowOpenHandler` into `shell.openExternal`), and `other` is left
 * entirely alone - which is the whole of "do not disrupt links that are already
 * captured by markdown parsing".
 */
export const shouldOpenOnClick = (kind: LinkKind): boolean => kind === "file";

/** The probe's answer for one path, or `null` when nothing is known yet. */
export type ProbedTarget = { exists: boolean; isFile: boolean } | null;

/** `window.api.probeFiles`, narrowed to what this module needs. */
export type ProbeFunction = (
	paths: string[],
) => Promise<readonly { exists: boolean; isFile: boolean }[]>;

/*
 * The session's answers. A negative is cached too (the file may be created
 * later, and `use-mentioned-files` covers that case for the Files panel with a
 * growth trigger); here the recovery is the click that failed, which forgets the
 * entry and re-probes rather than leaving the reader with a stale "No file".
 */
const probeCache = new Map<string, ProbedTarget>();

/** What is known about a target, or `undefined` when it has not been asked. */
export const probeStateFor = (target: string): ProbedTarget | undefined =>
	probeCache.get(target);

/** Drop what was known, so the next reveal asks again. */
export const forgetProbe = (target: string): void => {
	probeCache.delete(target);
};

/**
 * Drop EVERYTHING that was known.
 *
 * For a surface that swaps the probe mid-session and must not inherit answers
 * from the one before it: the story that photographs the "No file at …" strip
 * installs a `probeFiles` stub that answers `exists: false`, and without this it
 * could inherit the optimistic or existing-file answer a previous story's reveal
 * cached for the same spelling. Not part of the app's own flow - the app's
 * recovery is `forgetProbe` on the click that failed.
 */
export const resetProbeCache = (): void => {
	probeCache.clear();
};

/**
 * Ask about one target, once per session, and cache the answer.
 *
 * `ask` is optional because the preload is absent outside Electron (Storybook,
 * browser development), and the absence is OPTIMISTIC rather than pessimistic:
 * with no way to stat, the toolbar offers the full matrix and a press that turns
 * out to be impossible reports itself, which is a better story than a strip that
 * disables Open for a file that is plainly right there on the reader's screen.
 *
 * A throwing probe is left uncached and unanswered for the same reason
 * `use-mentioned-files` leaves its tiles unmarked: a stat that failed says
 * nothing about whether the file exists.
 */
export async function probeTarget(
	target: string,
	ask: ProbeFunction | undefined,
): Promise<void> {
	if (!ask || probeCache.has(target)) return;
	try {
		const [answer] = await ask([target]);
		if (!answer) return;
		probeCache.set(target, { exists: answer.exists, isFile: answer.isFile });
	} catch (error) {
		console.warn("probe-files failed:", error);
	}
}

/**
 * The attribute every anchor this app owns carries, and what it names.
 *
 * The transcript's toolbar finds its subject by asking the EVENT's target what
 * it is inside (`closest(LINK_TARGET_SELECTOR)`), which is why the marker is on
 * the anchor rather than on a wrapper: a hover over the link's own text and a
 * hover over its padding are the same link, and one of them would miss a
 * wrapper's boundary.
 */
export const LINK_TARGET_ATTR = "data-lo-kind";

export const LINK_TARGET_SELECTOR = `[${LINK_TARGET_ATTR}]`;

/** The link an endpoint of the reader's highlight sits in, if any. */
const linkAncestorOf = (node: Node): Element | null => {
	const host =
		node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement;
	return host?.closest(LINK_TARGET_SELECTOR) ?? null;
};

/**
 * The link the reader's highlight lies WHOLLY inside, or `null` for every other
 * shape.
 *
 * One rule, and it is deliberately the suspicious direction: BOTH endpoints have
 * to sit in the SAME link, or the answer is no. A highlight that starts in one
 * link and ends in another, one that spans a link and the prose beside it, one
 * that ends on a toolbar, and a collapsed caret all answer `null` - so the caller
 * that uses this to choose WHICH control to raise falls back to the turn's own
 * Quote control, and never to a quote attributed to a link that only half the
 * highlight came from. A wrong "yes" here is a misattributed quote, which is the
 * class of defect `quote-model.ts` spends its comments preventing; a wrong "no"
 * costs one extra press.
 *
 * Read lazily (`window`, `Node`) so this module stays importable by a node test,
 * which is where its boundaries are asserted.
 */
export function selectionLink(): Element | null {
	const range = highlightRange();
	if (!range) return null;
	const start = linkAncestorOf(range.startContainer);
	const end = linkAncestorOf(range.endContainer);
	if (!start || start !== end) return null;
	return start;
}

/** The reader's live range, or `null` when there is no highlight to speak of. */
function highlightRange(): Range | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return null;
	}
	return selection.getRangeAt(0);
}

/**
 * Whether the reader has a highlight at all, of any shape.
 *
 * The distinction the toolbar's state machine needs: "no highlight, so the
 * pointer decides the subject" and "a highlight I cannot attribute to one link, so
 * nothing does" are the same answer from `selectionWhollyWithin` and must not be.
 */
export const hasHighlight = (): boolean => highlightRange() !== null;

/**
 * Whether the reader's highlight lies wholly inside this one link.
 *
 * This is the link toolbar's `quotable`: it is why the toolbar offers Quote when
 * the reader has highlighted part or all of a link, and why it does not when the
 * highlight merely passes through one. `false` for "no highlight", for a
 * highlight somewhere else, and for every spanning shape above.
 */
export const selectionWhollyWithin = (link: Element | null): boolean =>
	link !== null && selectionLink() === link;

/**
 * The link the reader's highlight lies wholly inside AND that lives in this turn,
 * or `null`.
 *
 * The turn test is not decoration: the toolbar is scoped to the turn that owns
 * the words, and a highlight that begins in one row and ends inside a link in the
 * next would otherwise be claimed by a toolbar in a row the reader did not start
 * in.
 */
export function selectionLinkIn(turn: HTMLElement | null): Element | null {
	const link = selectionLink();
	if (!link || !turn) return null;
	return turn.contains(link) ? link : null;
}

export type LinkActionId = "quote" | "copy" | "open" | "open-folder";
export type LinkAction = {
	id: LinkActionId;
	/** Sentence case, and the tooltip and the accessible name together. */
	label: string;
};

export type LinkToolbarModel = {
	/** In visual order. Quote is first when it is offered; see `linkToolbarModel`. */
	actions: LinkAction[];
	/**
	 * Why an action is missing, in one sentence, or `null` when nothing is.
	 *
	 * This is the half of the missing-file case that a disabled button cannot
	 * carry: the reader is told the path names nothing rather than left to
	 * conclude the app is broken.
	 */
	note: string | null;
	/** The strip's own accessible name: what these actions are actions ON. */
	label: string;
};

const action = (id: LinkActionId, label: string): LinkAction => ({ id, label });

/** The last path segment, for a label that fits. */
const baseName = (target: string): string =>
	target.split("/").filter(Boolean).pop() ?? target;

/**
 * The buttons a link's toolbar shows, or `null` when this target has none.
 *
 * QUOTE IS FIRST WHEN IT IS OFFERED, and that ordering is the operator's ask
 * ("if selecting a link in part or whole, show the quote within the hover
 * buttons"): a reader who has highlighted something has already chosen what they
 * are acting on, and the press that continues their gesture belongs at the
 * leading edge rather than behind two clipboard-shaped ones.
 *
 * `quotable` is the caller's answer to "is the reader's selection wholly inside
 * THIS link" - a DOM question, and the one thing this function cannot decide.
 * It is only ever consulted for a link that is the toolbar's subject, so a
 * `false` here does not mean "this link cannot be quoted"; it means the reader
 * has not highlighted this link.
 */
export function linkToolbarModel(input: {
	kind: LinkKind;
	target: string;
	probe: ProbedTarget;
	quotable: boolean;
}): LinkToolbarModel | null {
	const { kind, target, probe, quotable } = input;
	if (kind === "other") return null;
	const leading = quotable ? [action("quote", "Quote")] : [];
	const name = baseName(target) || target;

	if (kind === "url") {
		return {
			actions: [
				...leading,
				action("copy", "Copy link"),
				action("open", "Open in browser"),
			],
			note: null,
			label: `Actions for ${name}`,
		};
	}

	/*
	 * Unknown is treated as a file. The optimistic direction is stated in
	 * `probeTarget`: with no probe the app has no grounds to disable anything,
	 * and a wrong guess costs one failed press that reports itself.
	 */
	const isDirectory = probe?.exists === true && !probe.isFile;
	const missing = probe?.exists === false;
	if (missing) {
		return {
			actions: [...leading, action("copy", "Copy path")],
			note: `No file at ${target}`,
			label: `Actions for ${name}`,
		};
	}
	/*
	 * A directory keeps Open and loses Open folder: `shell.showItemInFolder` on a
	 * directory selects the directory's PARENT, so the reader would watch Finder
	 * reveal somewhere they did not ask for. Opening the directory is what they
	 * wanted.
	 */
	const fileActions = isDirectory
		? [action("open", "Open")]
		: [action("open", "Open"), action("open-folder", "Open folder")];
	return {
		actions: [...leading, action("copy", "Copy path"), ...fileActions],
		note: null,
		label: `Actions for ${name}`,
	};
}
