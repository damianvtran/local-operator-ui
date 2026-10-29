import { cn } from "@shared/lib/utils";
import type { CSSProperties, FC, MouseEvent as ReactMouseEvent } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, {
	type Components,
	type UrlTransform,
	defaultUrlTransform,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import { type CanvasPane, useCanvasPane } from "../utils/canvas-pane";
import {
	LINK_TARGET_ATTR,
	LINK_TARGET_PATH_ATTR,
	type LinkKind,
	claimFirstScan,
	classifyHref,
	clickDecision,
	evidenceFor,
	probeTargets,
	subscribeProbes,
} from "../utils/link-actions";
import { ambiguousTargetsIn } from "../utils/link-grammar";
import { openLocalTarget, selectionTouches } from "../utils/link-open";
import {
	type BlockScanner,
	createBlockScanner,
	scanMarkdownBlocks,
	trimmedEndLength,
} from "../utils/markdown-blocks";
import { closeOpenMarkdown, openFenceOf } from "../utils/markdown-remend";
import { opensInCanvas } from "../utils/open-in-canvas";
import { remarkLinkifyTargets } from "../utils/remark-linkify-targets";
import { remarkSoftBreaks } from "../utils/remark-soft-breaks";
import { citationAwareAnchor } from "./credential-citation";
import { remarkCredentialCitations } from "./credential-citation-remark";
import { MarkdownImage } from "./markdown-image";
// NOT `remark-math`: its single-dollar tokenizer has no adjacency rules, so
// once math is on for a message a price's `$` and a later `$` pair up and the
// text between them is typeset (operator report, 2026-09-27).
// `markdown-math-guarded.ts` carries the guarded tokenizer, its provenance
// from `micromark-extension-math@3.1.0`, and the pandoc rules it implements.
import remarkGuardedMath from "./markdown-math-guarded";
import { MarkdownTable } from "./markdown-table";
import "./markdown.css";
import { MAX_PROBE_PATHS } from "../../../../../shared/desktop-contract";
import { containsRenderableMath } from "./markdown-math";
import { MermaidDiagram } from "./mermaid-diagram";
import { SEPARATOR_CLASS, SEPARATOR_RUN } from "./slash-token";

// katex.min.css is unconditional dead weight for the vast majority of messages,
// which contain no math. Vite turns this dynamic import into a chunk that
// injects the stylesheet, so it is fetched the first time a message actually
// needs it. Module-level state keeps that to one fetch per session and lets
// later renderers start in the loaded state instead of flashing.
let katexStylesLoaded = false;
let katexStylesPromise: Promise<unknown> | null = null;

const loadKatexStyles = (): Promise<unknown> => {
	if (!katexStylesPromise) {
		katexStylesPromise = import("katex/dist/katex.min.css").then((mod) => {
			katexStylesLoaded = true;
			return mod;
		});
	}
	return katexStylesPromise;
};

/**
 * The two knobs callers actually turn. `paragraphSpacing`, `headingScale` and
 * `codeSize` were also accepted and never once passed, so they are gone rather
 * than left as options nobody can be sure are honoured.
 */
export type MarkdownStyleProps = {
	fontSize?: string;
	lineHeight?: number | string;
};

type MarkdownRendererProps = {
	content: string;
	styleProps?: MarkdownStyleProps;
	className?: string;
	/**
	 * Whether a path the text merely CONTAINS becomes a link. On by default.
	 *
	 * A completed document is the case the linkifier was written for: the agent
	 * wrote a path, and it is dead text until something renders it as a link.
	 * The caller that turns it off is the canonical transcript's streaming row
	 * (`AssistantRow`), for the reason `isQuotable` refuses a streaming record: a
	 * row still receiving deltas is a prefix the next token falsifies, so a path
	 * that is half-written - `/Users/x/Workspace/opoint-renewal-2026-09-1` - would
	 * be linkified into a target that does not exist and then silently re-link as
	 * the rest of it arrived. The link appears when the row settles, which is
	 * also when the row's own Quote control appears.
	 */
	linkify?: boolean;
	/**
	 * Render the app's own credential citations as chips, in place.
	 *
	 * OPT-IN, and the asymmetry is deliberate. A citation is text the app itself
	 * wrote for a value the reader can no longer see (`credentialCitation`), so
	 * chipping it tells the reader something true about their own message. Agent
	 * output is a different matter: a citation the MODEL writes is prose about a
	 * credential, and a renderer that made it a chip would be dressing a sentence up
	 * as the app's own receipt - and would do it on the streaming path, where the
	 * text is deliberately half-parsed. So the transform travels with the caller's
	 * opt-in and nothing else turns it on (`canonical-transcript.tsx`,
	 * `message-content.tsx`), and every agent-facing render - reasoning, questions,
	 * streaming - leaves it off and renders exactly what it rendered before. It
	 * composes with `linkify`: a citation-bearing user turn is also a turn whose
	 * paths may be linkified, which is why the hook below takes both.
	 *
	 * THE READER'S OWN SINGLE NEWLINES RIDE IT TOO (report, 2026-09-25): a message
	 * sent from the composer reads back with its lines kept rather than every soft
	 * break collapsed to a space. That transform hangs off this opt-in rather than
	 * a second flag - the four citation pipelines below carry it and say why.
	 */
	credentialCitations?: boolean;
	/**
	 * The identity of the message this text belongs to - the transcript's
	 * `record.id` - so the link evidence can tell a NEW message from a remount of
	 * an old one when their text is byte-identical (round 3, review R3-3b): a
	 * report repeating the pre-tool message word for word is still the event that
	 * says its cached negatives may have moved. Optional: a surface without one
	 * keys on the text alone (see `claimFirstScan`).
	 */
	documentId?: string;
};

const LANGUAGE_REGEX = /language-(\w+)/;
const WHITESPACE_RUN = SEPARATOR_RUN;
/*
 * A list or an indented-code block is only ended by a blank line when the NEXT
 * line does not continue it, and that is normally unknowable until the line is
 * complete (`markdown-blocks.ts`). Some partial lines already decide it: a
 * continuation has to start with a space/tab (a hung paragraph, indented code) or
 * a list marker/digit (`-`, `*`, `+`, `1.`), so a first character outside that
 * set ends the block however the line goes on.
 */
const PARTIAL_LINE_ENDS_BLOCK = new RegExp(`^[^${SEPARATOR_CLASS}\\d*+-]`);
const NEWLINE_REGEX = /\n$/;

/**
 * The anchor every markdown link renders as, wherever markdown is rendered.
 *
 * Three kinds, decided from the href's shape by `classifyHref`, and the third is
 * the one that matters most: an href this app has no business opening keeps
 * exactly the behaviour it had before this change. That is what "do not disrupt
 * links that are already captured by markdown parsing" means in code.
 *
 * `data-lo-kind` is what the transcript's hover toolbar looks for
 * (`event.target.closest("[data-lo-kind]")`), and `data-lo-target` is the
 * target it acts on - the PATH, never a `file://` URL, and never a
 * percent-encoded one, because the toolbar's Copy and Open act on a filesystem
 * path (`link-actions.ts`'s module header says which layer decodes).
 *
 * `href` and `data-lo-target` are the SAME string for a target this app opens,
 * which is the property round 1 (review N1) found broken: the anchor used to
 * carry the encoded href from the renderer beside a decoded target, so what the
 * reader saw underlined and what Copy produced were two spellings of one path.
 * For a detected `file://` URL the two are still different STRINGS by design -
 * the visible text is the URL the agent wrote, and the target is the path it
 * names - and `link-toolkit.tsx` says so where the toolbar's label is built.
 *
 * `draggable={false}` removes the browser's own LINK DRAG from the anchor, and
 * nothing more than that. It is load-bearing in the sense that matters: an `<a>`
 * carrying an href is draggable in Chromium, so a mousedown-then-drag on a link
 * started the browser's own drag instead of a text selection. What it does NOT do
 * is make the link's own text selectable - Chromium starts no selection from a
 * mousedown on an `<a href>` either way, which round 2 measured in a windowed
 * build with focus emulated and re-measured on the story surface (UX round 2,
 * U4): a drag, a double-click, a triple-click and a click+Shift+click that all
 * begin and end inside one link produce `getSelection() === ""`, no
 * `selectstart`, and no `dragstart`, while the same instrument selects in the
 * prose beside it and selects THROUGH the link from the prose. An earlier version
 * of this comment claimed the same gesture "now selects" and cited
 * `docs/evidence/chat-canonical-links/selection-link-and-prose/` as the frame of
 * a real drag - both untrue, and the set's own README says so: that frame and the
 * `selection-in-link*` pair are built through the DOM's `Selection` API by the
 * story, because no pointer gesture reaches them. The consequence is a design
 * fact rather than a defect to fix here - the link toolbar therefore offers Quote
 * on hover as well (`link-toolkit.tsx`), so the affordance does not depend on a
 * selection the browser will not make.
 *
 * WHERE A PRESS GOES. A local path this app has a VIEWER for, inside a pane that
 * has a canvas, opens THERE - the operator's ask - and every other press keeps
 * the OS hand-off exactly as it was. The pane arrives through a context
 * (`canvas-pane.tsx`) rather than a prop, because this anchor is rendered by every
 * markdown surface in the app and only one of them has a pane at all; with no
 * provider the context answers `null` and the click is the click of before.
 */
const MarkdownAnchor: FC<{ href?: string; children?: React.ReactNode }> = ({
	href,
	children,
}) => {
	const target = classifyHref(href);
	const pane = useCanvasPane();
	if (!target || target.kind === "other") {
		return (
			<a href={href} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		);
	}
	return (
		<a
			/*
			 * The decoded target, both as the destination and as the string the
			 * toolbar acts on (see the docstring above).
			 */
			href={target.target}
			data-lo-kind={target.kind}
			data-lo-target={target.target}
			draggable={false}
			/*
			 * A URL keeps `target="_blank"`: it leaves the app through
			 * `setWindowOpenHandler` into `shell.openExternal`, which is the path that
			 * already exists and already works. Only a local path gets the click
			 * handler, because only a local path is this app's to open.
			 */
			target={target.kind === "url" ? "_blank" : undefined}
			rel={target.kind === "url" ? "noopener noreferrer" : undefined}
			onClick={
				target.kind === "file"
					? (event) => handleFileAnchorClick(event, pane)
					: undefined
			}
		>
			{children}
		</a>
	);
};

/**
 * The one href shape this renderer keeps alive, asked of the classifier itself.
 *
 * THE PRESERVATION AND THE CLASSIFICATION ARE ONE RULE, and that is the point. A
 * second spelling of "what a `file:` link is" is a second place for it to be
 * wrong, and it was: `/^file:/i` kept `file:/tmp/a.pdf` and even
 * `file:javascript:alert(1)` alive while `classifyHref`'s `FILE_HREF`
 * (`/^file:\/\//i`) called them `other`, so the anchor carried a live `href` with
 * `target="_blank"`, no `data-lo-*` attributes and no click handler - and left
 * through `setWindowOpenHandler` → `shell.openExternal` as a string the app had
 * never looked at, with no toolbar, no probe, no missing-file sentence and no
 * `preventDefault` guarantee. Those shapes were blanked before this transform
 * existed (round 2, code review MINOR 2).
 *
 * Asking the classifier covers the same shapes FROM THE OTHER SIDE as well: a
 * `file://` URL whose host is not this machine (`file://other-host/share`) is
 * classified `other` by `normalizeFileUrl`'s own rule, so it stays blanked and
 * inert exactly as it is on `main` - preserving it here would hand the OS another
 * string the app declines to reason about. The invariant the suites bind is
 * therefore one sentence: an href survives this transform only if
 * `classifyHref` makes it a target this app acts on.
 */
const isClassifiedFile = (url: string) => classifyHref(url)?.kind === "file";

/** The two attribute names the anchor writes, read back by its own handler. */
const LINK_TARGET_PATH = LINK_TARGET_PATH_ATTR;

/**
 * A plain click on a detected file link.
 *
 * The decision is `clickDecision`'s (`link-actions.ts`) and this function only
 * performs it, which is what makes both traps assertable without a browser: the
 * mandatory `preventDefault` for a file target, and the drag-select refusal. The
 * live selection is the input because the browser owns it - whatever ended the
 * gesture, the state that matters is whether text is still lit.
 *
 * THE FALLBACK IS PART OF THE RULE, not an error path. A pane refuses a press it
 * cannot honour - a directory, a type with no viewer, a read that failed, a path
 * the probe already knows is gone (`open-in-canvas.ts` says which) - and that
 * refusal means "do what this app did before", which is the OS attempt and its
 * own `Could not open …` toast. Without the fallback the pane's honest refusal
 * would be a press that did nothing at all, which is the failure the whole matrix
 * exists to remove.
 */
const handleFileAnchorClick = (
	event: ReactMouseEvent<HTMLAnchorElement>,
	pane: CanvasPane | null,
) => {
	const anchor = event.currentTarget;
	const kind = (anchor.getAttribute(LINK_TARGET_ATTR) ?? "file") as LinkKind;
	const target = anchor.getAttribute(LINK_TARGET_PATH);
	const outcome = clickDecision({
		kind,
		hasHighlight: selectionTouches(anchor),
		canOpenInCanvas: opensInCanvas(pane, target),
	});
	if (outcome === "browse") return;
	event.preventDefault();
	if (outcome === "hold" || !target) return;
	if (outcome === "canvas" && pane) {
		void pane.openInCanvas(target).then((opened) => {
			if (!opened) void openLocalTarget(target);
		});
		return;
	}
	void openLocalTarget(target);
};

/**
 * `file:` is preserved IN THE ONE FORM `classifyHref` CLASSIFIES, and everything
 * else is the library's own answer. `defaultUrlTransform`'s safe list is
 * `https?|ircs?|mailto|xmpp`, so a HAND-WRITTEN `[report](file:///tmp/a.pdf)`
 * renders as `<a href="">` - an inert anchor with no target attributes and
 * therefore no toolbar, which made `classifyHref`'s `file://` branch unreachable
 * in the app (round 1, review M1). The operator asked for the affordances on
 * markdown-captured links too, so the branch is made real instead of deleted:
 * `file://` survives, and `javascript:`, `data:`, `vbscript:`, `ftp:`, `blob:`,
 * `about:blank` and every other unlisted scheme - including the `file:`-prefixed
 * shapes `classifyHref` does not classify - still blank out exactly as the
 * library intends (asserted in `scripts/chat-link-affordances.test.mjs`).
 *
 * Only `href` is transformed. An `<img src="file://…">` in a transcript is not a
 * link and nothing here needs it to load - leaving images to the library keeps
 * this change's reach to the surface it is about.
 *
 * Exported so the scheme matrix can be asserted directly, on the function rather
 * than on the handful of shapes a markdown destination can carry: `[x](…)` cannot
 * express a leading space or a control character, and the two shapes round 2's
 * code review found preserved-but-unclassified (`file:/tmp/a.pdf`,
 * `file:javascript:alert(1)`) are exactly the ones a markdown-authoring corpus
 * would not have produced anyway. `scripts/chat-link-affordances.test.mjs` binds
 * the invariant that matters: EVERY href this returns unchanged is a shape
 * `classifyHref` calls a file, so nothing reaches `shell.openExternal`
 * unclassified.
 */
export const LINK_URL_TRANSFORM: UrlTransform = (url, key) => {
	if (key === "href" && isClassifiedFile(url)) return url;
	return defaultUrlTransform(url);
};

/**
 * Hoisted, and that matters more than it looks - though not for the reason this
 * comment used to give.
 *
 * MEASURED, react-markdown 10.1.0, in jsdom, for the evidence change below:
 * `Markdown(options)` builds a fresh processor and calls `runSync` on EVERY
 * render, so a per-render literal here would not miss a memo - there is no memo
 * to miss, and the document is re-processed per render whatever the identity is.
 * What actually bounds that work is this repo's own `memo()` on the two
 * components that hold a `<ReactMarkdown>` (`MarkdownRenderer`, and
 * `ParsedBlock` below).
 *
 * So why hoist? Because it costs nothing, because a module-scope array is the
 * shape a future react-markdown restoring an internal memo would read, and
 * because a per-render literal here would allocate on the streaming path for no
 * reason at all.
 *
 * The `a` entry is the anchor every link in the app renders as
 * (`MarkdownAnchor`), because the alternative - a second anchor implementation
 * for the transcript's rows - is the "second implementation of one thing" § 9
 * refuses, and because the links that need the new behaviour are exactly the
 * ones markdown produces.
 *
 * The `table` entry is the scroll wrapper the table-width fix needs
 * (`markdown-table.tsx` carries the report): every table, in every markdown
 * render, sits in a box that overflows safely instead of squeezing or pushing
 * the page, and the entry lives on THIS map so the citations map below inherits
 * it through its spread and no third map can be forgotten.
 */
const MARKDOWN_COMPONENTS: Components = {
	a: MarkdownAnchor,
	table: MarkdownTable,
	/*
	 * `img` joins the map for the operator's ask of 2026-10-11 — hovering an
	 * image offers its actions — because a markdown image is the one picture the
	 * chat's own components never see: without this entry an
	 * `![shot](/tmp/a.png)` is a bare `<img>` with no way to open, copy or
	 * reveal it. The component owns its admission (`markdown-image.tsx`): a
	 * relative `src` renders exactly as before, and the actions a target gets
	 * are the per-kind set `image-actions.ts` declares, with the canvas entry
	 * riding the same pane provider the anchor uses.
	 */
	img: MarkdownImage,
	code: ({ node: _node, className, children, ...rest }) => {
		const language = LANGUAGE_REGEX.exec(className ?? "")?.[1];

		if (language === "mermaid") {
			return (
				<MermaidDiagram chart={String(children).replace(NEWLINE_REGEX, "")} />
			);
		}

		return (
			<code dir="ltr" className={className} {...rest}>
				{children}
			</code>
		);
	},
};

/**
 * The same map with the citation override, for the one caller that opts in.
 *
 * Hoisted for the same reason the map above is - and, MEASURED on react-markdown
 * 10.1.0, that reason is not a memo the library keeps: `Markdown(options)` builds
 * a fresh processor per render, so an object rebuilt per render re-processes the
 * whole document either way (see `MARKDOWN_COMPONENTS`). Module scope is kept
 * because it costs nothing, because it is what an upgrade restoring an internal
 * memo would read, and because it gives `citationAwareAnchor` one object identity
 * to be built into rather than one per frame.
 */
const MARKDOWN_COMPONENTS_WITH_CITATIONS: Components = {
	...MARKDOWN_COMPONENTS,
	// The factory is called HERE, once at module scope, so the override keeps one
	// object identity for the renderer's whole life rather than a fresh map per
	// frame - and the anchor it delegates to is the renderer's own, which is the
	// only link implementation in the app.
	a: citationAwareAnchor(MarkdownAnchor),
};

const GFM_ONLY = [remarkGfm];
const GFM_AND_MATH = [remarkGfm, remarkGuardedMath];
/*
 * Every combination of the three things this pipeline can add, hoisted for the
 * reason `MARKDOWN_COMPONENTS`'s comment records - and, MEASURED on
 * react-markdown 10.1.0, that reason is NOT an internal memo: `Markdown(options)`
 * builds a fresh processor and calls `runSync` on EVERY render, so a fresh array
 * here would miss nothing and the document is re-processed per render whatever
 * the identity is. The identity is kept because it costs nothing, because a
 * module-scope array is the shape a future react-markdown restoring an internal
 * memo would read, and because a builder function returning a fresh array for
 * the same arguments would be the thing that defeats such a memo rather than the
 * thing that benefits from it. What bounds the re-parse today is this repo's own
 * `memo()` on the components that own a `<ReactMarkdown>`, plus the state bump
 * `useLinkEvidence` uses as its re-parse trigger.
 *
 * Eight constants rather than a builder, and `REMARK_PIPELINES` below is only a
 * selector over them.
 */
const GFM_LINKIFY = [remarkGfm, remarkLinkifyTargets];
const GFM_MATH_LINKIFY = [remarkGfm, remarkGuardedMath, remarkLinkifyTargets];
/*
 * THE FOUR CITATION-BEARING PIPELINES ARE ALSO THE FOUR USER-TURN PIPELINES,
 * and `remarkSoftBreaks` rides them (operator report, 2026-09-25). The report:
 * a message sent with `Prod:` / `Email:` / `Password:` each on its own line
 * reads back as ONE line, because a soft break - a single newline inside a
 * paragraph - is not a node: it is a `\n` inside a `text` node's value, and
 * HTML collapses it to a space unless a transform turns it into a `break`
 * node first. `utils/remark-soft-breaks.ts` carries the mechanism.
 *
 * WHY HERE RATHER THAN A SECOND FLAG. `credentialCitations` is, in the app as
 * it stands, the user-turn opt-in: exactly two callers turn it on
 * (`canonical-transcript.tsx`, `message-item/message-content.tsx`) and both
 * render the reader's OWN turn, while every agent-facing render leaves it off.
 * The reader's own lines are owed to the same decision as the chips - what the
 * composer showed must survive the send - so a `keepLineBreaks` prop would be
 * a second flag that coincides with this one at every call site. The coupling
 * is stated here rather than encoded twice; a future caller turning this
 * opt-in on for something that is NOT the reader's own words reopens this
 * comment, not a wiring accident.
 *
 * `remarkSoftBreaks` SITS LAST on purpose: the linkifier and the citation
 * transform each see exactly the tree they saw before this change, and the
 * soft-break walk rewrites only the `text` nodes they leave behind. The four
 * pipelines that do NOT carry citations (agent output, streaming blocks,
 * reasoning) are untouched: an agent's answer is a markdown DOCUMENT and keeps
 * CommonMark's soft-break collapse.
 */
const GFM_AND_CITATIONS = [
	remarkGfm,
	remarkCredentialCitations,
	remarkSoftBreaks,
];
const GFM_MATH_AND_CITATIONS = [
	remarkGfm,
	remarkGuardedMath,
	remarkCredentialCitations,
	remarkSoftBreaks,
];
const GFM_LINKIFY_AND_CITATIONS = [
	remarkGfm,
	remarkLinkifyTargets,
	remarkCredentialCitations,
	remarkSoftBreaks,
];
const GFM_MATH_LINKIFY_AND_CITATIONS = [
	remarkGfm,
	remarkGuardedMath,
	remarkLinkifyTargets,
	remarkCredentialCitations,
	remarkSoftBreaks,
];
/*
 * The selector, keyed by the three decisions in their own order (math, linkify,
 * citations). A key rather than three nested ternaries: eight branches nested
 * three deep is a shape no reviewer can check against the eight constants above,
 * and every value here is one of those constants rather than a literal.
 */
const REMARK_PIPELINES: Record<string, typeof GFM_MATH_LINKIFY_AND_CITATIONS> =
	{
		"000": GFM_ONLY,
		"001": GFM_AND_CITATIONS,
		"010": GFM_LINKIFY,
		"011": GFM_LINKIFY_AND_CITATIONS,
		"100": GFM_AND_MATH,
		"101": GFM_MATH_AND_CITATIONS,
		"110": GFM_MATH_LINKIFY,
		"111": GFM_MATH_LINKIFY_AND_CITATIONS,
	};
const NO_REHYPE: [] = [];
const KATEX_ONLY = [rehypeKatex];

/**
 * Whether the content is worth paying for the math pipeline.
 *
 * THE DECISION LIVES IN `markdown-math.ts` NOW (code review round 1, R1-1), and
 * it is no longer only about cost: the citation transform is a remark plugin and
 * the math plugin is a micromark SYNTAX extension, so enabling math can split a
 * citation at parse time - before any plugin sees a tree. The citation pass
 * therefore has to be able to veto the math pass, and that rule is a pure
 * function of the content, asserted in `scripts/credential-capture.test.mjs` over
 * the real plugin list. Read that module's header for the defect and the rule.
 */

const useStyleVariables = (
	styleProps: MarkdownStyleProps | undefined,
): CSSProperties | undefined =>
	useMemo(() => {
		if (!styleProps?.fontSize && !styleProps?.lineHeight) return undefined;
		return {
			"--md-font-size": styleProps.fontSize,
			"--md-line-height": styleProps.lineHeight,
		} as CSSProperties;
	}, [styleProps?.fontSize, styleProps?.lineHeight]);

/**
 * The math plugins wait for the stylesheet: rendering KaTeX markup before its
 * CSS arrives shows visibly broken layout, whereas holding the plugins back for
 * that one frame just leaves the raw "$x$" source on screen.
 *
 * `linkify` and `citations` are the second and third things this hook decides,
 * and they are parameters rather than props of their own because every answer
 * has to come out as ONE array identity. Measured (see `MARKDOWN_COMPONENTS`):
 * react-markdown 10.1.0 re-runs the pipeline per render whatever that identity
 * is, so it buys nothing today - it is kept as the contract a memo inside a
 * future react-markdown would read, and because keying `REMARK_PIPELINES` and
 * returning one of its constants is a better shape than nested ternaries over
 * eight combinations, or than mutating a shared array to switch pipelines.
 *
 * The name says MATH because that was its only subject when it was written, and
 * it is kept rather than renamed: the file that carries it was rewritten on `main`
 * for the linkifier in the same window this branch added the citation pass, and a
 * rename here would be a third spelling of the same function for no behaviour.
 * `REMARK_PIPELINES` above is what holds the answer; every branch of it is a
 * hoisted array, which is what such a memo would read.
 */
const useMathPipeline = (
	content: string,
	linkify: boolean,
	citations: boolean,
) => {
	const hasLatex = useMemo(() => containsRenderableMath(content), [content]);
	/*
	 * WHAT IS REMEMBERED IS THE STYLESHEET, NOT THE DECISION (code review round 2,
	 * R2-4). This used to be one `mathEnabled` state initialised once and only ever
	 * set `true`, i.e. a latch in front of the citation veto: an instance whose
	 * content went math-document -> citation-document would have kept math on and
	 * re-opened R1-1's defect. The reviewer could not reach it (the citation opt-in
	 * only ever renders a user turn, whose text is fixed, and `ParsedBlock` passes
	 * `citations = false`), which is why this is a NIT and not a live path - but a
	 * latch in front of the guard is the shape that silently re-opens it, so the
	 * decision is re-derived from the content on every render and only the loader's
	 * own completion is state.
	 */
	const [katexReady, setKatexReady] = useState(katexStylesLoaded);
	const mathEnabled = hasLatex && katexReady;

	useEffect(() => {
		if (!hasLatex || katexReady) return;
		let cancelled = false;
		loadKatexStyles().then(() => {
			if (!cancelled) setKatexReady(true);
		});
		return () => {
			cancelled = true;
		};
	}, [hasLatex, katexReady]);

	return {
		// Keyed by the three decisions in their own order - math, linkify, citations
		// - so the answer is one of the eight hoisted arrays and never a fresh one.
		remarkPlugins:
			REMARK_PIPELINES[
				`${mathEnabled ? 1 : 0}${linkify ? 1 : 0}${citations ? 1 : 0}`
			],
		rehypePlugins: mathEnabled ? KATEX_ONLY : NO_REHYPE,
	};
};

/**
 * The evidence loop for one rendered document.
 *
 * WHAT IT IS FOR. A slash command and a directory are the same shape to a
 * scanner - `/new`, `/tmp`, `/v2/things` - so the grammar admits such a token
 * only when the disk vouches for it (`TargetPolicy.evidence`), and something has
 * to ask. This hook is that something, and it lives HERE because this file holds
 * the two components that own a `<ReactMarkdown>`: the transcript's row list is
 * `memo()`'d and its identity contract is explicit
 * (`use-mentioned-files.ts:8-14`), so a prop threaded down every row to carry
 * this would be a new input to the hottest list in the app, and a store write
 * would be a second source of truth for what a row renders.
 *
 * THE RE-PARSE TRIGGER IS THE STATE BUMP, and the measured reason it works is
 * that react-markdown 10.1.0 does NOT memoise its pipeline: `Markdown(options)`
 * calls `createProcessor` and `runSync` on every render (measured in jsdom for
 * this change - the remark plugin ran once on mount and once per re-render, with
 * the plugin array's identity held constant). So the re-render this hook
 * provokes is the whole mechanism, and nothing has to be threaded through a prop
 * or an array identity. The hoisted arrays above are kept because they cost
 * nothing and are the shape that survives a future upgrade restoring an internal
 * memo - not because they gate this today.
 *
 * ONE ASK PER DISTINCT SPELLING PER DOCUMENT. The pre-scan is deduped,
 * `probeTargets` dedupes again against the cache and against the asks already in
 * flight (two rows carrying `/tmp` paint in the same frame and would otherwise
 * both ask), and the answers land in the same cache the link toolbar reads. A
 * streaming row (`linkify` false) does no scanning and asks nothing at all - a
 * per-delta stat storm is the one shape this could go wrong in.
 *
 * A NEW MESSAGE RE-ASKS THE MISSING ONES (round 2, review R2-1): an agent that
 * lists its deliverables BEFORE the tool writes them caches a negative per name,
 * and the report that lists them after would otherwise read that negative
 * forever. `claimFirstScan` marks the first scan of each document, so the new
 * report re-probes the spellings it names that are cached as missing, and the
 * landing answer re-renders the earlier rows through `subscribeProbes` too. A
 * remount of the SAME document is not a new message and re-asks nothing.
 *
 * A FRESH PATH CREATED AFTER THE MESSAGE PAINTED, AND NEVER NAMED AGAIN, STAYS
 * PLAIN. The Files panel owns a growth-triggered retry (`use-mentioned-files`);
 * the linkifier retries only on a new message, so an extensionless file that
 * appears later with no later message naming it is not re-scanned. That is the
 * accepted false negative of plain-until-known, recorded on the pull request
 * rather than discovered by a reader.
 */
const useLinkEvidence = (
	content: string,
	linkify: boolean,
	documentId?: string,
): void => {
	const [, setTick] = useState(0); // the state is the re-render, not a value
	useEffect(() => {
		if (!linkify) return; // a streaming row is parsed but not linkified
		const suspects = ambiguousTargetsIn(content);
		if (suspects.length === 0) return;
		let live = true;
		const armed = new Set(suspects);
		const stop = subscribeProbes((landed) => {
			if (live && landed.some((target) => armed.has(target)))
				setTick((count) => count + 1);
		});
		void probeTargets(
			suspects,
			window.api?.probeFiles,
			MAX_PROBE_PATHS,
			claimFirstScan(
				documentId === undefined ? content : `${documentId}\u0000${content}`,
			),
		).then(() => {
			/*
			 * An answer that landed before this effect subscribed - another row, or
			 * the toolbar, asked first - is caught here rather than by the
			 * subscription: the ask above returns immediately when every spelling is
			 * already cached, and nothing would notify a listener that arrived after
			 * the fact.
			 */
			if (live && suspects.some((target) => evidenceFor(target) !== "unknown"))
				setTick((count) => count + 1);
		});
		return () => {
			live = false;
			stop();
		};
	}, [content, linkify, documentId]);
};

/**
 * Renders a complete markdown document.
 *
 * Bare URLs are linked by remark-gfm's autolink literals. There used to be a
 * `convertUrlsToMarkdownLinks` pre-pass here as well; it declared the same
 * regex twice and returned the input unchanged whenever the first one matched,
 * which is whenever the text contains a URL — so it did nothing, ever, and what
 * it was meant to do was already being done by the plugin. What was NOT being
 * done is the other half: a bare PATH is not a URL, remark-gfm does not know
 * about paths, and `remarkLinkifyTargets` is what renders one as a link. It is a
 * plugin over the mdast rather than a text pre-pass precisely because the dead
 * pre-pass above is the recorded evidence that a text rewrite cannot tell a path
 * in a code fence or inside an existing link's label from one in prose.
 *
 * @param content - The markdown source
 * @param styleProps - Optional font size and line height overrides
 * @param linkify - Whether bare paths become links (default true)
 */
export const MarkdownRenderer: FC<MarkdownRendererProps> = memo(
	({
		content,
		styleProps,
		className,
		linkify = true,
		credentialCitations = false,
		documentId,
	}) => {
		const trimmed = useMemo(() => content.trim(), [content]);
		const { remarkPlugins, rehypePlugins } = useMathPipeline(
			trimmed,
			linkify,
			credentialCitations,
		);
		const style = useStyleVariables(styleProps);
		/*
		 * The pre-scan runs on the SAME string the parse does, so the suspects and the
		 * tokens the plugin will meet cannot drift on a leading newline.
		 */
		useLinkEvidence(trimmed, linkify, documentId);

		return (
			<div className={cn("lo-markdown", className)} style={style}>
				<ReactMarkdown
					remarkPlugins={remarkPlugins}
					rehypePlugins={rehypePlugins}
					urlTransform={LINK_URL_TRANSFORM}
					components={
						credentialCitations
							? MARKDOWN_COMPONENTS_WITH_CITATIONS
							: MARKDOWN_COMPONENTS
					}
				>
					{trimmed}
				</ReactMarkdown>
			</div>
		);
	},
);

MarkdownRenderer.displayName = "MarkdownRenderer";

/**
 * Render counts of the streaming path, read by
 * `scripts/streaming-live-markdown.test.mjs` and nothing else.
 *
 * WHY IT IS IN THE PRODUCT CODE. "Only the tail re-renders while it grows" is
 * the property the block split exists for, and a DOM-mutation observer cannot
 * show it (a wasted re-render that produces the same DOM mutates nothing). A
 * counter bumped where a block's markdown is actually (re)built is the only
 * direct witness, and an integer increment per block render is below anything a
 * frame can feel. `settled` counts renders of a CLOSED block, `tail` renders of
 * the block still being written.
 */
export const streamingRenderStats = { settled: 0, tail: 0 };

/**
 * The open block's component map: the shipped map with the anchor made inert.
 *
 * A half-written link target is not a target: `https://example.com/pl` would
 * autolink to a URL that does not exist, and a complete `[label](url)` is still
 * inside a paragraph that may yet grow. The label/URL text paints in place and
 * the anchor appears when the block closes - the guarantee the old plain-text tail
 * gave (`a block still being written has no anchor`), kept now that the tail is
 * parsed. A fragment, not a `<span>`, so the DOM differs from the closed form by
 * the anchor element alone.
 */
const OPEN_BLOCK_COMPONENTS: Components = {
	...MARKDOWN_COMPONENTS,
	a: ({ children }) => <>{children}</>,
};

/**
 * One block of a streaming message - closed, or still being written.
 *
 * THE SAME COMPONENT, AT THE SAME KEY, FOR BOTH. A closed block's source is
 * frozen, so `memo` (compared on `source` and `closed`) parses it on the frame it
 * closes and never again - the whole point of the block split. The block still
 * being written used to be painted as literal text, which is what put raw
 * backticks and asterisks on screen for the second or two before its paragraph
 * closed and then re-typeset them (operator report: `` `InfoList` `` read as
 * literal backticks, then jumped to a code span). It is now parsed too, through
 * `closeOpenMarkdown`, which appends the closers the writer has not typed yet so
 * the parse sees a well-formed block. And because it is the same component at the
 * same key (`blocks.length` is the open block's index, and becomes its closed
 * index when it closes) the hand-over from "open" to "closed" is a prop change on
 * a mounted element: the DOM the reader is looking at is the DOM that settles,
 * with no remount, no re-layout and no flash.
 *
 * COST. The open block is re-parsed per frame; closed blocks never. The cost
 * grows with the size of the OPEN BLOCK, not of the message - and one block can
 * be message-sized (a 300-item list, a 13 KB paragraph, a 200-row table), where
 * measured per-flush cost passes the 16.7 ms frame (QA Q5: p50 10.6 ms for a
 * 22 KB list). The scanner splits a list per item only when blank lines do, so
 * that case is a known limit of this design, not a bound. The one block whose
 * size is unbounded in practice and that IS cheap is an open code fence, which
 * is why it is NOT parsed per frame: its body is painted directly into the exact
 * `<pre><code class="language-x">` a parse would produce (`OpenFenceBody`), so a
 * growing fence costs one text-node update per frame. Nested fences are the
 * exception and take the parsed path (see `fence` below).
 *
 * LINKIFY follows `closed`: a closed block's source can never change again, so a
 * path inside it is a finished path; the open block is never scanned
 * (`/Users/x/opoint-renewal-2026-09-1` must not become a link to a path that does
 * not exist). That is the one deliberate difference between the two states.
 *
 * The plugin set is derived from the block's own source by the same hook the
 * completed render uses, so a block holding LaTeX reaches its final layout as
 * soon as the KaTeX stylesheet resolves and completion is a no-op for it.
 * `citations` is OFF: nothing on this path is a user turn, so a chip here could
 * only dress up text the MODEL wrote.
 */
const ParsedBlock = memo(
	({ source, closed }: { source: string; closed: boolean }) => {
		if (closed) streamingRenderStats.settled += 1;
		else streamingRenderStats.tail += 1;
		const display = useMemo(
			() => (closed ? source : closeOpenMarkdown(source)),
			[closed, source],
		);
		/*
		 * A fence nested in a list item or quote is NOT painted directly: its `<pre>`
		 * belongs inside that item, and a sibling `<pre>` would move into it on close
		 * (review R1-m1). It takes the parsed path, with only its closer appended.
		 */
		const fence = useMemo(() => {
			if (closed) return null;
			const open = openFenceOf(source);
			return open !== null && !open.nested ? open : null;
		}, [closed, source]);
		const { remarkPlugins, rehypePlugins } = useMathPipeline(
			display,
			closed,
			false,
		);
		useLinkEvidence(source, closed);
		if (fence !== null) {
			// The paragraph in front of the fence is still markdown the parse owns.
			const before = closeOpenMarkdown(fence.before);
			return (
				<>
					{before.trim() !== "" && (
						<ReactMarkdown
							remarkPlugins={remarkPlugins}
							rehypePlugins={rehypePlugins}
							urlTransform={LINK_URL_TRANSFORM}
							components={closed ? MARKDOWN_COMPONENTS : OPEN_BLOCK_COMPONENTS}
						>
							{before}
						</ReactMarkdown>
					)}
					<OpenFenceBody info={fence.info} body={fence.body} />
				</>
			);
		}
		return (
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				rehypePlugins={rehypePlugins}
				urlTransform={LINK_URL_TRANSFORM}
				components={closed ? MARKDOWN_COMPONENTS : OPEN_BLOCK_COMPONENTS}
			>
				{display}
			</ReactMarkdown>
		);
	},
);

ParsedBlock.displayName = "ParsedBlock";

/**
 * The body of a code fence that has not closed yet, in the DOM a parse yields.
 *
 * `<pre><code class="language-ts">body\n</code></pre>` is what react-markdown
 * produces for the closed fence, so the hand-over to it moves no pixel. The
 * trailing newline is the parse's own (a code node's value ends with one) and
 * renders as nothing inside `pre`. A `mermaid` fence is painted here too, as
 * plain code: the parse routes a CLOSED one to the diagram, and a half-written
 * diagram is an error card, so it stays source until it closes.
 */
const OpenFenceBody = ({ info, body }: { info: string; body: string }) => {
	const language = info.split(WHITESPACE_RUN)[0];
	return (
		<pre>
			<code className={language ? `language-${language}` : undefined}>
				{body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`}
			</code>
		</pre>
	);
};

type StreamingMarkdownProps = {
	content: string;
	styleProps?: MarkdownStyleProps;
	className?: string;
};

/**
 * Renders markdown as it streams in.
 *
 * Two halves, and the split is what bounds the cost:
 *
 * - Everything up to the last closed block boundary is parsed markdown, one
 *   memoised `ParsedBlock` per block. Each is parsed on the frame it closes.
 * - The block still being written is parsed too, optimistically closed
 *   (`closeOpenMarkdown`), as the SAME component at the SAME key its closed form
 *   will have - so inline code, emphasis, lists and headings are formatted the
 *   moment they are written, and the block settles in place.
 *
 * Per-frame work is therefore proportional to ONE block (the open one), never to
 * the message: the property the naive full-document re-parse lacks.
 *
 * WHAT WAS GIVEN UP, and why it is acceptable: the old open block was painted as
 * one `<span>` per arrival so each frame's text could fade in
 * (`lo-stream-chunk`). A parsed block is a React tree whose text nodes update in
 * place; there is no per-arrival element to animate, and wrapping the arrivals
 * would re-introduce a second DOM structure for live text, which is exactly the
 * live-vs-committed divergence this component now removes.
 */
export const StreamingMarkdown: FC<StreamingMarkdownProps> = ({
	content,
	styleProps,
	className,
}) => {
	const scannerRef = useRef<BlockScanner | null>(null);
	if (scannerRef.current === null) {
		scannerRef.current = createBlockScanner();
	}
	const scanner = scannerRef.current;

	// Scanning during render is safe here because it is a pure function of
	// `content` into state that is itself derived from `content`: a re-render
	// with the same string re-derives the same blocks and the same tail. Doing
	// it in an effect would paint one frame of stale text per chunk.
	scanMarkdownBlocks(scanner, content);

	const { blockStart } = scanner;
	const tailEnd = blockStart + trimmedEndLength(content.slice(blockStart));
	/*
	 * A PENDING BLANK RUN FOLLOWED BY AN INCOMPLETE NEXT LINE is two paragraphs,
	 * though the scanner correctly waits for the complete line before closing the
	 * first (`markdown-blocks.ts`: it has to see whether the next line continues a
	 * list). For a block that is neither a list, indented code nor a fence a blank
	 * line always ends it, so the first paragraph is final NOW: it is handed to a
	 * closed `ParsedBlock` at the index the scanner will give it a frame later (the
	 * source string is the scanner's own, so the memo holds and nothing re-renders),
	 * and the second paragraph is the open block. Without this the whole span was
	 * one open block that split in two when the line completed, remounting the
	 * paragraph the reader was looking at.
	 */
	let pendingClosed: string | null = null;
	let openStart = blockStart;
	if (
		(scanner.kind === "other" ||
			((scanner.kind === "list" || scanner.kind === "indented-code") &&
				PARTIAL_LINE_ENDS_BLOCK.test(content.slice(scanner.cursor)))) &&
		scanner.fence === null &&
		scanner.blankRunStart >= blockStart &&
		scanner.cursor < tailEnd &&
		content.slice(scanner.cursor, tailEnd).trim().length > 0
	) {
		pendingClosed = content.slice(blockStart, scanner.blankRunStart);
		openStart = scanner.cursor;
	}
	const tail = content.slice(openStart, tailEnd);
	const blocks: { key: number; source: string; closed: boolean }[] =
		scanner.blocks.map((source, key) => ({ key, source, closed: true }));
	if (pendingClosed !== null)
		blocks.push({
			key: scanner.blocks.length,
			source: pendingClosed,
			closed: true,
		});
	if (tail !== "")
		blocks.push({ key: blocks.length, source: tail, closed: false });
	const style = useStyleVariables(styleProps);

	return (
		<div className={cn("lo-markdown", className)} style={style}>
			{/*
			 * ONE keyed list, closed blocks then the pending paragraph then the open
			 * block. They used to be three sibling slots, and React identifies a child
			 * by slot AND key: a block moving from the open slot to the pending slot
			 * to the array was a remount each time (every block was rendered twice,
			 * measured by `streamingRenderStats`), which is a DOM replacement under
			 * the reader. Blocks are append-only, so the index is a stable identity:
			 * block n is the same block for the life of the message, and the open
			 * block's key is the index it will hold once closed.
			 */}
			{blocks.map((block) => (
				<ParsedBlock
					key={block.key}
					source={block.source}
					closed={block.closed}
				/>
			))}
		</div>
	);
};

StreamingMarkdown.displayName = "StreamingMarkdown";
