import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownTable } from "../chat/components/markdown-table";
import "../chat/components/markdown.css";

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
 * none), never as an element that fetches. Raw HTML is already inert:
 * react-markdown does not render it without `rehype-raw`, which is not used.
 * Attachments, when Team Bridge has them, will be a separate, explicit surface.
 */
const EXTERNAL_HREF = /^(https?:|mailto:)/i;

const COMPONENTS: Components = {
	a: ({ href, children }) =>
		typeof href === "string" && EXTERNAL_HREF.test(href) ? (
			<a href={href} target="_blank" rel="noreferrer">
				{children}
			</a>
		) : (
			<span className="font-mono text-mono-sm">{children}</span>
		),
	img: ({ alt, src }) => (
		<span className="text-ink-muted">
			{alt || (typeof src === "string" ? src : "")}
		</span>
	),
	table: MarkdownTable,
};

export const TeamBridgeMarkdown: FC<{ children: string; className?: string }> =
	memo(({ children, className }) => (
		<div className={cn("lo-markdown", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
				{children}
			</ReactMarkdown>
		</div>
	));
TeamBridgeMarkdown.displayName = "TeamBridgeMarkdown";
