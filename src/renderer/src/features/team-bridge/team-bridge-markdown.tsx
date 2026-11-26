import { USER_CONTENT_CLASS } from "@shared/analytics/autocapture-privacy";
import { cn } from "@shared/lib/utils";
import type { CSSProperties, FC } from "react";
import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { MarkdownTable } from "../chat/components/markdown-table";
import { remarkTableHtml } from "../chat/utils/remark-table-html";
import "../chat/components/markdown.css";
import type { MessageMentionRun } from "./mentions/message-mentions";
import { remarkTeamBridgeMentions } from "./mentions/remark-mentions";
import { EXTERNAL_HREF } from "./team-bridge-external-href";

/**
 * Markdown for Team Bridge message bodies: text written by OTHER PEOPLE (and
 * their agents) in the reader's organization.
 *
 * WHY NOT `ProjectMarkdown` AS-IS (review round 1, R1-9). That renderer is for
 * the reader's own project notes, so it renders `![](url)` as an `<img>`. Here
 * the author is someone else, and an image is a request the READER's app makes
 * the moment the message is painted: the renderer's CSP allows the local
 * backend's origin, so a teammate could make every recipient's app call its
 * own `localhost` API, or confirm they read the message (a tracking pixel).
 * Neither is a thing a chat message should be able to do on arrival.
 *
 * So the element map is ProjectMarkdown's (external links open in the
 * browser; anything else stays text; tables scroll in their own box) plus ONE
 * difference: an image renders as its alt text (or its URL as text when it has
 * none), never as an element that fetches. Arbitrary raw HTML remains inert:
 * the shared table transform projects only allowlisted presentation nodes and
 * drops images, active elements and attributes; `rehype-raw` is not enabled.
 * Attachments, when Team Bridge has them, will be a separate, explicit surface.
 */
const BridgeLink: NonNullable<Components["a"]> = ({ href, children }) =>
	typeof href === "string" && EXTERNAL_HREF.test(href) ? (
		<a href={href} target="_blank" rel="noreferrer">
			{children}
		</a>
	) : (
		<span className="font-mono text-mono-sm">{children}</span>
	);

const COMPONENTS: Components = {
	a: BridgeLink,
	img: ({ alt, src }) => (
		<span className="text-ink-muted">
			{alt || (typeof src === "string" ? src : "")}
		</span>
	),
	table: MarkdownTable,
};

// A Deliver binds more than the link label. In the approval inbox, print the
// destination too, but retain the normal external-link and no-image policies.
const PROOF_COMPONENTS: Components = {
	...COMPONENTS,
	a: ({ href, children }) => (
		<>
			<BridgeLink href={href}>{children}</BridgeLink>
			{href && href !== children && (
				<span className="text-ink-muted"> ({href})</span>
			)}
		</>
	),
	img: ({ alt, src }) => (
		<span className="text-ink-muted">
			{alt}
			{src && (alt ? ` (${src})` : src)}
		</span>
	),
};

const APPROVAL_URL = /^(?:https?:\/\/|mailto:)/;
const ENCODED_PERCENT = /%25/g;
const ORDERED_MARKER = /^(\d{1,9})[.)](?:[\t ]|$)/;
const approvalMarkdown = unified().use(remarkParse).use(remarkGfm).freeze();

// Allow only AST features whose visible projection we understand. In particular
// the GFM table transform can throw away a cell, and definitions, footnotes,
// tasks, HTML and code metadata can move, replace or omit source. Keep styled
// Markdown, but render the entire original body inert and inline for any such
// feature (including parser changes we have not accounted for).
type ApprovalNode = {
	type: string;
	position?: { start: { offset?: number }; end: { offset?: number } };
	children?: readonly ApprovalNode[];
	value?: string;
	url?: string;
	title?: string | null;
	alt?: string | null;
	checked?: boolean | null;
	ordered?: boolean | null;
	start?: number | null;
};
function preservesApprovalText(node: ApprovalNode, body: string): boolean {
	const from = node.position?.start.offset;
	const to = node.position?.end.offset;
	if (from === undefined || to === undefined) return false;
	const source = body.slice(from, to);
	const preservesChildren = () =>
		node.children?.every((child) => preservesApprovalText(child, body)) ??
		false;
	switch (node.type) {
		case "text":
			// Includes escapes/entities and other syntax the parser normalized.
			return source === node.value;
		case "root":
		case "paragraph":
		case "heading":
		case "blockquote":
		case "strong":
		case "emphasis":
		case "delete":
			return preservesChildren();
		case "list":
			return (
				preservesChildren() &&
				(!node.ordered ||
					node.children?.every((child, index) => {
						const from = child.position?.start.offset;
						const to = child.position?.end.offset;
						if (from === undefined || to === undefined) return false;
						const marker = ORDERED_MARKER.exec(body.slice(from, to))?.[1];
						return marker === String((node.start ?? 1) + index);
					}) === true)
			);
		case "listItem":
			return node.checked == null && preservesChildren();
		case "thematicBreak":
		case "break":
			return true;
		case "link":
		case "image": {
			const { url } = node;
			if (!url || node.title != null || !APPROVAL_URL.test(url)) return false;
			// The proof renderer prints simple explicit destinations, but its
			// Markdown/HTML pipeline may normalize other spellings. Compare the
			// parser's destination to the original instead of inspecting punctuation
			// elsewhere in the message.
			try {
				decodeURI(url);
				// Already-encoded escapes survive the renderer. Raw characters
				// that become another spelling need the original source alongside.
				if (encodeURI(url).replace(ENCODED_PERCENT, "%") !== url) return false;
			} catch {
				return false;
			}
			if (node.type === "image") return source === `![${node.alt}](${url})`;
			const labelEnd = node.children?.at(-1)?.position?.end.offset;
			return (
				labelEnd !== undefined &&
				body.slice(labelEnd, to) === `](${url})` &&
				preservesChildren()
			);
		}
		default:
			return false;
	}
}

export function needsLiteralHoldBody(body: string): boolean {
	try {
		return !preservesApprovalText(approvalMarkdown.parse(body), body);
	} catch {
		return true;
	}
}

export const TeamBridgeMarkdown: FC<{
	children: string;
	className?: string;
	/** Only the hold inbox uses this; ordinary messages keep concise labels. */
	showDestinations?: boolean;
	/** @-mention runs to highlight (`mentions/use-message-mentions.ts`). */
	mentions?: readonly MessageMentionRun[];
	/**
	 * Inline style on the prose block: the one seam for the `--md-*` custom
	 * properties `markdown.css` reads. WHY IT IS NEEDED AT ALL: that stylesheet is
	 * UNLAYERED and Tailwind's utilities are not, so an unlayered `color` rule wins
	 * over any `text-*` class on this element - a state carried by a utility class is
	 * invisible here (design review round 2, D3, measured `rgb(56,58,66)` on a pending
	 * row that asked for muted ink).
	 */
	/* Custom properties are legal in a style object but not in `CSSProperties`. */
	style?: CSSProperties & Record<`--${string}`, string>;
}> = memo(
	({ children, className, mentions, style, showDestinations = false }) => {
		const plugins = useMemo(
			() =>
				mentions?.length
					? [remarkGfm, remarkTableHtml, remarkTeamBridgeMentions(mentions)]
					: [remarkGfm, remarkTableHtml],
			[mentions],
		);
		return (
			/* A Team Bridge message body: user content, as the chat transcript's
		   `MarkdownRenderer` (review round 1, Q2). */
			<div
				className={cn("lo-markdown", USER_CONTENT_CLASS, className)}
				style={style}
			>
				<ReactMarkdown
					remarkPlugins={plugins}
					components={showDestinations ? PROOF_COMPONENTS : COMPONENTS}
				>
					{children}
				</ReactMarkdown>
			</div>
		);
	},
);
TeamBridgeMarkdown.displayName = "TeamBridgeMarkdown";
