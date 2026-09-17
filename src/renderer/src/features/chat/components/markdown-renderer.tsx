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
import remarkMath from "remark-math";
import {
	LINK_TARGET_ATTR,
	LINK_TARGET_PATH_ATTR,
	type LinkKind,
	classifyHref,
	clickDecision,
} from "../utils/link-actions";
import { openLocalTarget, selectionTouches } from "../utils/link-open";
import {
	type BlockScanner,
	createBlockScanner,
	scanMarkdownBlocks,
	trimmedEndLength,
} from "../utils/markdown-blocks";
import { remarkLinkifyTargets } from "../utils/remark-linkify-targets";
import "./markdown.css";
import { MermaidDiagram } from "./mermaid-diagram";

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
};

const LANGUAGE_REGEX = /language-(\w+)/;
const NEWLINE_REGEX = /\n$/;
const INLINE_MATH_REGEX = /\$(?!\d)(.+?)\$/;
const DISPLAY_MATH_REGEX = /\$\$([\s\S]+?)\$\$/;
const MATH_ENVIRONMENT_REGEX = /\\begin\{([^}]+)\}([\s\S]+?)\\end\{\1\}/;
const MATH_COMMAND_REGEX = /\\[a-zA-Z]+(\{[^}]*\})?/;

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
 */
const MarkdownAnchor: FC<{ href?: string; children?: React.ReactNode }> = ({
	href,
	children,
}) => {
	const target = classifyHref(href);
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
			onClick={target.kind === "file" ? handleFileAnchorClick : undefined}
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
 */
const handleFileAnchorClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
	const anchor = event.currentTarget;
	const kind = (anchor.getAttribute(LINK_TARGET_ATTR) ?? "file") as LinkKind;
	const outcome = clickDecision({
		kind,
		hasHighlight: selectionTouches(anchor),
	});
	if (outcome === "browse") return;
	event.preventDefault();
	if (outcome === "hold") return;
	const target = anchor.getAttribute(LINK_TARGET_PATH);
	if (!target) return;
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
 * Hoisted, and that matters more than it looks.
 *
 * react-markdown memoises its pipeline against the props it is given. Rebuilding
 * this literal inside the component body handed it a new object on every render,
 * so the memo missed every time and the whole document was re-processed — the
 * exact cost the streaming path is built to avoid.
 *
 * The `a` entry is the anchor every link in the app renders as
 * (`MarkdownAnchor`), because the alternative — a second anchor implementation
 * for the transcript's rows — is the "second implementation of one thing" § 9
 * refuses, and because the links that need the new behaviour are exactly the
 * ones markdown produces.
 */
const MARKDOWN_COMPONENTS: Components = {
	a: MarkdownAnchor,
	code: ({ node: _node, className, children, ...rest }) => {
		const language = LANGUAGE_REGEX.exec(className ?? "")?.[1];

		if (language === "mermaid") {
			return (
				<MermaidDiagram chart={String(children).replace(NEWLINE_REGEX, "")} />
			);
		}

		return (
			<code className={className} {...rest}>
				{children}
			</code>
		);
	},
};

const GFM_ONLY = [remarkGfm];
const GFM_AND_MATH = [remarkGfm, remarkMath];
/*
 * The same two pipelines with the linkifier on the end, hoisted for the same
 * reason the two above are: `MARKDOWN_COMPONENTS`'s comment records what a
 * per-render plugin array cost, and building `[...GFM_ONLY, remarkLinkifyTargets]`
 * inside the component would be that bug again with a different literal.
 *
 * Four constants rather than a builder function on purpose. react-markdown
 * memoises against the ARRAY IDENTITY, so a function that returned a fresh array
 * for the same arguments would miss the memo on every render - which is the
 * whole reason these are module-scope in the first place.
 */
const GFM_LINKIFY = [remarkGfm, remarkLinkifyTargets];
const GFM_MATH_LINKIFY = [remarkGfm, remarkMath, remarkLinkifyTargets];
const NO_REHYPE: [] = [];
const KATEX_ONLY = [rehypeKatex];

/**
 * Whether the content is worth paying for the math pipeline.
 *
 * Cheap rejections first: bare `$` is far more often a price than an inline
 * formula, so a lone dollar sign only counts when it is not followed by a
 * digit, and a backslash command only counts alongside one of the four
 * constructs that are unambiguously mathematical.
 */
const containsLatex = (content: string): boolean => {
	if (INLINE_MATH_REGEX.test(content)) return true;
	if (DISPLAY_MATH_REGEX.test(content)) return true;
	if (MATH_ENVIRONMENT_REGEX.test(content)) return true;
	return (
		MATH_COMMAND_REGEX.test(content) &&
		(content.includes("\\frac") ||
			content.includes("\\sum") ||
			content.includes("\\int") ||
			content.includes("\\sqrt"))
	);
};

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
 * `linkify` is the second thing this hook decides, and it is a parameter rather
 * than a prop of its own because both answers have to come out as ONE array
 * identity: react-markdown memoises its pipeline against the arrays it is handed,
 * so a caller that picked the arrays itself could hand it a fresh pair on every
 * render.
 */
const useMathPipeline = (content: string, linkify: boolean) => {
	const hasLatex = useMemo(() => containsLatex(content), [content]);
	const [mathEnabled, setMathEnabled] = useState(
		() => hasLatex && katexStylesLoaded,
	);

	useEffect(() => {
		if (!hasLatex || mathEnabled) return;
		let cancelled = false;
		loadKatexStyles().then(() => {
			if (!cancelled) setMathEnabled(true);
		});
		return () => {
			cancelled = true;
		};
	}, [hasLatex, mathEnabled]);

	return {
		remarkPlugins: mathEnabled
			? linkify
				? GFM_MATH_LINKIFY
				: GFM_AND_MATH
			: linkify
				? GFM_LINKIFY
				: GFM_ONLY,
		rehypePlugins: mathEnabled ? KATEX_ONLY : NO_REHYPE,
	};
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
	({ content, styleProps, className, linkify = true }) => {
		const trimmed = useMemo(() => content.trim(), [content]);
		const { remarkPlugins, rehypePlugins } = useMathPipeline(trimmed, linkify);
		const style = useStyleVariables(styleProps);

		return (
			<div className={cn("lo-markdown", className)} style={style}>
				<ReactMarkdown
					remarkPlugins={remarkPlugins}
					rehypePlugins={rehypePlugins}
					urlTransform={LINK_URL_TRANSFORM}
					components={MARKDOWN_COMPONENTS}
				>
					{trimmed}
				</ReactMarkdown>
			</div>
		);
	},
);

MarkdownRenderer.displayName = "MarkdownRenderer";

/**
 * One closed block.
 *
 * Memoised on its source, which by construction never changes once the block
 * has closed — so a block is parsed on the frame it closes and is untouched for
 * the rest of the message. This is the whole point of the block split.
 *
 * The plugin set is derived from the block's own source by the same hook the
 * completed render uses. Hardcoding GFM-only here meant a closed block holding
 * LaTeX showed its raw "$x$" source for the rest of the stream and then
 * re-rendered through KaTeX the moment the message completed and
 * `MarkdownRenderer` took over — the equation visibly jumped. Deriving it means
 * the block reaches its final layout as soon as the KaTeX stylesheet resolves,
 * and completion is a no-op for it.
 *
 * Detection is per block rather than per document on purpose: the block's
 * source is frozen, so its decision is made once and can never flip, whereas a
 * document-level scan would have to re-run on the whole message every frame and
 * would re-render every earlier block the first time math appeared anywhere.
 * The two only disagree where `containsLatex` deliberately reads a
 * digit-leading "$1.00$" as currency for the block but the completed
 * document-level render enables math because of a formula elsewhere.
 */
const StableBlock = memo(({ source }: { source: string }) => {
	/*
	 * `linkify` is on here even though this is a streaming view, and the
	 * difference from `AssistantRow`'s `streaming` row is what a block IS: a
	 * block reaches this component once it has CLOSED, so its source can never
	 * change again and a path inside it is a finished path. The in-flight tail
	 * below renders as literal text and is never parsed at all.
	 */
	const { remarkPlugins, rehypePlugins } = useMathPipeline(source, true);
	return (
		<ReactMarkdown
			remarkPlugins={remarkPlugins}
			rehypePlugins={rehypePlugins}
			urlTransform={LINK_URL_TRANSFORM}
			components={MARKDOWN_COMPONENTS}
		>
			{source}
		</ReactMarkdown>
	);
});

StableBlock.displayName = "StableBlock";

/**
 * One frame's worth of newly arrived characters.
 *
 * Mounted once with its final text — the next frame's arrival becomes its own
 * span rather than extending this one — so the fade runs exactly once per
 * character and nothing already on screen re-animates.
 */
const ArrivedText = memo(
	({ text, animate }: { text: string; animate: boolean }) => (
		<span className={animate ? "lo-stream-chunk" : undefined}>{text}</span>
	),
);

ArrivedText.displayName = "ArrivedText";

type Arrival = {
	/** Absolute index in the source where this frame's text starts. */
	offset: number;
	/**
	 * Decided once, at creation, and never recomputed. Recomputing it would
	 * mean adding or removing the class on a live element, which either
	 * restarts a fade or cuts one off mid-way.
	 */
	animate: boolean;
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
 *   memoised `StableBlock` per block. Each is parsed on the frame it closes.
 * - The block still being written renders as plain text, split into one span
 *   per frame of arrival, so appending text costs one DOM insertion rather than
 *   a re-parse.
 *
 * Per-frame work is therefore proportional to what arrived, plus one block on
 * the frames where a block closes. Neither term grows with the length of the
 * message, which is the property the naive full-document re-parse lacks.
 *
 * The trade is that the in-flight block shows its markdown source — `**bold**`
 * reads literally for the second or two before the paragraph closes. Parsing
 * the tail every frame instead would put an O(tail) parse back on the hot path
 * and, worse, rebuild the tail's DOM on every frame, which is precisely the
 * "already-painted text must not reflow" property we want.
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

	const arrivalsRef = useRef<Arrival[]>([]);
	const previousLengthRef = useRef(0);

	// Scanning during render is safe here because it is a pure function of
	// `content` into state that is itself derived from `content`: a re-render
	// with the same string re-derives the same blocks and the same tail. Doing
	// it in an effect would paint one frame of stale text per chunk.
	scanMarkdownBlocks(scanner, content);

	const previousLength = previousLengthRef.current;
	if (content.length > previousLength) {
		// The first content to appear is not an arrival: on mount, or after a
		// reconnect replays the record, the text was never absent from the
		// screen, so fading it in would announce something that did not happen.
		if (previousLength > 0) {
			arrivalsRef.current.push({ offset: previousLength, animate: true });
		}
		previousLengthRef.current = content.length;
	} else if (content.length < previousLength) {
		arrivalsRef.current = [];
		previousLengthRef.current = content.length;
	}

	const { blockStart } = scanner;
	const arrivals = arrivalsRef.current;

	// Arrivals that the closed blocks have absorbed are gone from the DOM; drop
	// them so the list stays proportional to the tail rather than the message.
	let firstLive = 0;
	while (
		firstLive < arrivals.length &&
		arrivals[firstLive].offset <= blockStart
	) {
		firstLive += 1;
	}
	if (firstLive > 0) arrivals.splice(0, firstLive);

	const tailEnd = blockStart + trimmedEndLength(content.slice(blockStart));

	const segments: Arrival[] = [{ offset: blockStart, animate: false }];
	for (const arrival of arrivals) {
		if (arrival.offset >= tailEnd) break;
		segments.push(arrival);
	}

	const style = useStyleVariables(styleProps);

	return (
		<div className={cn("lo-markdown", className)} style={style}>
			{scanner.blocks.map((block, index) => (
				// Blocks are append-only, so the index is a stable identity: block
				// n is the same block for the life of the message.
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only list, index is the identity
				<StableBlock key={index} source={block} />
			))}
			{tailEnd > blockStart && (
				<p className="lo-stream-tail">
					{segments.map((segment, index) => {
						const end = segments[index + 1]?.offset ?? tailEnd;
						return (
							<ArrivedText
								key={segment.offset}
								text={content.slice(segment.offset, end)}
								animate={segment.animate}
							/>
						);
					})}
				</p>
			)}
		</div>
	);
};

StreamingMarkdown.displayName = "StreamingMarkdown";
