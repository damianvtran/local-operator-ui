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
 * 3. **The click.** Whether a press on an anchor opens anything is a function of
 *    the target's kind and of whether the reader is dragging a highlight over it
 *    (`clickDecision`), which is the ONE place the anchor's two traps are decided
 *    — asserted directly, because neither can be read off a frame.
 *
 * ## Where a `%` is decoded, and why it is decoded here
 *
 * THE ANCHOR'S HREF ARRIVES PERCENT-ENCODED, and this module is the one place
 * that undoes it. The mdast keeps a link destination verbatim — for a detected
 * path it is already the DECODED path, because `link-grammar.ts` parses the
 * `file://` form through `new URL` — but react-markdown runs the destination
 * through `remark-rehype`'s `normalizeUri` on the way to hast, which encodes
 * every character a URI may not carry literally. So `/tmp/a b.txt` reaches this
 * module as `/tmp/a%20b.txt`, and the reader's own screenshot
 * `Screenshot 2026-09-17 at 10.14.02.png` reaches it as `%20`s.
 *
 * That encoding is invisible in a browser (the address bar re-encodes), but it is
 * not invisible to a filesystem: `shell.openPath` takes a PATH, so the encoded
 * string opened nothing, and Copy copied a string that named no file. QA measured
 * it end to end (`{"ok":false,…,"error":"Failed to open path"}`) on the story's
 * own `file://` fixture.
 *
 * So decoding belongs HERE and nowhere else: this is the boundary where a
 * rendered href becomes the thing the app acts on, and a second decode down the
 * line would break exactly the paths whose names contain a literal `%` (the
 * encoder wrote `%25`, so one decode — and only one — restores it).
 * `link-grammar.ts` decodes too, because a `file://` URL has its own `%`-escapes
 * to undo before this module ever sees it; a path that has been through both is
 * decoded once in each layer, never twice in one.
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
 * A percent-encoded href, undone once so the app acts on the path it names.
 *
 * FAIL-SAFE, never throwing: `decodeURIComponent` throws a `URIError` on a lone
 * `%` or a malformed escape, and `50% off/notes.txt` is a legal file name that
 * the encoder leaves alone (a `%` not followed by two hex digits is not an
 * escape). The literal is then the right answer, because the string the reader
 * wrote IS the path. Measured against the four shapes this has to survive:
 * `%20` (a space), `%25` (a literal `%`), `%C3%A9` (a non-ASCII name) and a
 * malformed `%2` (left verbatim).
 */
const decodeHrefPath = (href: string): string => {
	try {
		return decodeURIComponent(href);
	} catch {
		return href;
	}
};

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
		/*
		 * The plain-path branch is where a detected link arrives, so it is where the
		 * rendering layer's percent-encoding is undone — see the module header. One
		 * value, used by the anchor's href, Copy, Open, Open folder, the probe and the
		 * reveal.
		 */
		return { kind: "file", target: decodeHrefPath(href) };
	}
	return { kind: "other", target: href };
}

/**
 * What a press on a rendered anchor does, decided in ONE place.
 *
 * `markdown-renderer.tsx`'s anchor carries two traps whose removal no frame can
 * show and no other suite can catch (`scripts/chat-link-affordances.test.mjs`
 * mounts the anchor and asserts this answer instead of reading it off a still):
 *
 * 1. **`preventDefault()` on every file target** is mandatory rather than
 *    defensive. Nothing in this app guards same-window navigation - there is no
 *    `will-navigate` handler - so the default would replace the app's own window
 *    with a file the reader cannot navigate back from. It is also what makes the
 *    hand-written `[report](file:///tmp/a.pdf)` case work: with `file:` preserved
 *    by `MarkdownRenderer`'s own `urlTransform`, letting the default through would
 *    navigate the window.
 * 2. **The drag-select guard.** `mousedown` and `mouseup` inside one anchor fire
 *    `click`, so a drag that began inside a link and released inside it IS a click
 *    as far as the browser is concerned - and without this a drag over a file link
 *    would launch an application mid-gesture. `hold` is that state: the default is
 *    still cancelled, and nothing is launched.
 *
 * `browse` is "this app has nothing to add": a URL keeps the `target="_blank"`
 * path it already had into `setWindowOpenHandler` (and a highlight over a URL does
 * NOT stop that click, which is the behaviour it had before this change - stated
 * rather than silently tightened), and `other` is left entirely alone, which is
 * what "do not disrupt links markdown already captured" means in code. The old
 * `shouldOpenOnClick` predicate is folded in here rather than kept beside it: one
 * question, one answer.
 */
export type ClickOutcome =
	/** Cancel the default and open the local path. */
	| "open"
	/** Cancel the default and do nothing: the reader is selecting, not pressing. */
	| "hold"
	/** Leave the anchor's own behaviour to the browser. */
	| "browse";

export function clickDecision(input: {
	kind: LinkKind;
	/** Whether the reader's live highlight touches this anchor. */
	hasHighlight: boolean;
}): ClickOutcome {
	if (input.kind !== "file") return "browse";
	return input.hasHighlight ? "hold" : "open";
}

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

/**
 * The attribute carrying the target itself, as `classifyHref` resolved it.
 *
 * One name rather than a literal in every reader: the anchor writes it
 * (`markdown-renderer.tsx`) and three places read it - the toolbar's own subject
 * (`link-toolkit.tsx`), the anchor's click handler, and the story fixture that
 * finds a link by what it names.
 */
export const LINK_TARGET_PATH_ATTR = "data-lo-target";

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
	/**
	 * The same reason with the path SPELLED OUT, for the tooltip and the accessible
	 * name, which have the room `note` does not. Equal to `note` whenever nothing
	 * was shortened. See `missingNote`.
	 */
	noteTitle: string | null;
	/** The strip's own accessible name: what these actions are actions ON. */
	label: string;
};

const action = (id: LinkActionId, label: string): LinkAction => ({ id, label });

/** The last path segment, for a label that fits. */
const baseName = (target: string): string =>
	target.split("/").filter(Boolean).pop() ?? target;

/**
 * How much of a missing-file reason the strip can paint before it truncates.
 *
 * From the box rather than from taste: the note's slot is `max-w-56` (224px) at
 * `text-meta` (12px), which carries roughly 38 characters, and round 1 measured
 * the ellipsis eating `report-2026-09-17.pdf` - the only part of the sentence that
 * distinguishes one missing path from another - while the DIRECTORY sat there in
 * full. 40 rather than 38 because a sentence that fits with two pixels to spare
 * is not worth a second ellipsis; a basename longer than the slot still falls to
 * the CSS clamp, which is the backstop and not the rule.
 *
 * The reveal's own `title` and accessible name keep the whole sentence either
 * way, so nothing is lost - only shortened.
 */
const MISSING_NOTE_MAX_CHARS = 40;

/**
 * The missing-file reason, with the DIRECTORY ellipsised instead of the name.
 *
 * `No file at …/lo-link-missing/report-2026-09-17.pdf` when that fits, and
 * `No file at report-2026-09-17.pdf` when it does not: the basename is the whole
 * point of the sentence, so it is the LAST thing this gives up, never the first.
 * The full path is still on the anchor above the strip and in `title`.
 */
export function missingNote(target: string): { note: string; title: string } {
	const title = `No file at ${target}`;
	const base = baseName(target) || target;
	const parts = target.split("/").filter(Boolean);
	const directory = parts.length > 1 ? parts[parts.length - 2] : "";
	const withDirectory = directory ? `No file at …/${directory}/${base}` : title;
	return {
		note:
			withDirectory.length <= MISSING_NOTE_MAX_CHARS
				? withDirectory
				: `No file at ${base}`,
		title,
	};
}

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
			noteTitle: null,
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
		const reason = missingNote(target);
		return {
			actions: [...leading, action("copy", "Copy path")],
			note: reason.note,
			noteTitle: reason.title,
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
		noteTitle: null,
		label: `Actions for ${name}`,
	};
}
