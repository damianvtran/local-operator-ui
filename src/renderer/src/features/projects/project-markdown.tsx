/**
 * Markdown as the project detail renders it: the description and the update
 * bodies.
 *
 * WHY NOT `MarkdownRenderer` (the chat's): that component IS a transcript
 * renderer — credential citations, canvas link targets, path probes, math and
 * mermaid diagrams — and every one of those rules is about a CONVERSATION,
 * not about a project write-up. What is shared, deliberately, is the prose
 * itself: `markdown.css`'s `.lo-markdown` is this app's one markdown
 * treatment (that stylesheet is written for exactly this shape of caller —
 * bare react-markdown output with no element to hang a class on), so a
 * heading, a list or a code block here is styled by the same rules as an
 * answer in a transcript and a change lands on both surfaces.
 *
 * LINKS: http(s) and mailto anchors carry `target="_blank"`, which routes the
 * press through the window-open handler main installs
 * (`setWindowOpenHandler` → `shell.openExternal`), so a link opens in the
 * operator's browser and the app's own window never navigates away. Anything
 * else a document can link to — `/`-relative, `#`-anchor, bare paths — renders
 * as monospace TEXT: this surface has no canvas, no link grammar and no
 * file-opening vocabulary of its own, and a control that looks like a link but
 * does nothing is worse than a fragment that never claimed to be one.
 *
 * GFM, not CommonMark alone: update bodies are written by agents, and tables,
 * task lists and admonition-style blockquotes are part of what they write
 * (`remark-gfm`, the same plugin the transcript renderer carries).
 */

import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "../chat/components/markdown.css";

const EXTERNAL_HREF = /^(https?:|mailto:)/i;

/**
 * The element map. Kept module-scope so a re-render does not hand react-markdown
 * a new components object (its processor is rebuilt when this identity moves —
 * `remark-linkify-targets.ts` measured that cost for the transcript; the rule
 * is the same here).
 */
const COMPONENTS: Components = {
	a: ({ href, children }) => {
		if (typeof href === "string" && EXTERNAL_HREF.test(href)) {
			return (
				<a href={href} target="_blank" rel="noreferrer">
					{children}
				</a>
			);
		}
		/*
		 * The non-external arm deliberately keeps the label as TEXT rather than
		 * a dead control: the monospace face is this app's marker for machine
		 * voice, and a path is exactly that.
		 */
		return <span className="font-mono text-mono-sm">{children}</span>;
	},
};

export type ProjectMarkdownProps = {
	children: string;
	className?: string;
};

export const ProjectMarkdown: FC<ProjectMarkdownProps> = memo(
	({ children, className }) => (
		<div className={cn("lo-markdown", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
				{children}
			</ReactMarkdown>
		</div>
	),
);
