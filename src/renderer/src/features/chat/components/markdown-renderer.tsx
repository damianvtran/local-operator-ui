import { cn } from "@shared/lib/utils";
import type { CSSProperties, FC } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
	type BlockScanner,
	createBlockScanner,
	scanMarkdownBlocks,
	trimmedEndLength,
} from "../utils/markdown-blocks";
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
};

const LANGUAGE_REGEX = /language-(\w+)/;
const NEWLINE_REGEX = /\n$/;
const INLINE_MATH_REGEX = /\$(?!\d)(.+?)\$/;
const DISPLAY_MATH_REGEX = /\$\$([\s\S]+?)\$\$/;
const MATH_ENVIRONMENT_REGEX = /\\begin\{([^}]+)\}([\s\S]+?)\\end\{\1\}/;
const MATH_COMMAND_REGEX = /\\[a-zA-Z]+(\{[^}]*\})?/;

/**
 * Hoisted, and that matters more than it looks.
 *
 * react-markdown memoises its pipeline against the props it is given. Rebuilding
 * this literal inside the component body handed it a new object on every render,
 * so the memo missed every time and the whole document was re-processed — the
 * exact cost the streaming path is built to avoid.
 */
const MARKDOWN_COMPONENTS: Components = {
	a: ({ href, children }) => (
		<a href={href} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	),
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
 */
const useMathPipeline = (content: string) => {
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
		remarkPlugins: mathEnabled ? GFM_AND_MATH : GFM_ONLY,
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
 * it was meant to do was already being done by the plugin.
 *
 * @param content - The markdown source
 * @param styleProps - Optional font size and line height overrides
 */
export const MarkdownRenderer: FC<MarkdownRendererProps> = memo(
	({ content, styleProps, className }) => {
		const trimmed = useMemo(() => content.trim(), [content]);
		const { remarkPlugins, rehypePlugins } = useMathPipeline(trimmed);
		const style = useStyleVariables(styleProps);

		return (
			<div className={cn("lo-markdown", className)} style={style}>
				<ReactMarkdown
					remarkPlugins={remarkPlugins}
					rehypePlugins={rehypePlugins}
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
	const { remarkPlugins, rehypePlugins } = useMathPipeline(source);
	return (
		<ReactMarkdown
			remarkPlugins={remarkPlugins}
			rehypePlugins={rehypePlugins}
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
