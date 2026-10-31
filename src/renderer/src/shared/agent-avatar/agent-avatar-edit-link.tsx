/**
 * An agent's picture with a pencil on hover/focus that links to its editor.
 *
 * A DOOR, NOT AN EDITOR. Pressing it navigates to the agent's detail view on the
 * Agents page with `?edit=picture`, which scrolls to and focuses the one editor
 * (`features/agents/components/agent-avatar-field.tsx`). No upload, crop or
 * remove logic lives here or at any surface that places this, so there is one
 * editing path to keep correct.
 *
 * OWNED LOCAL AGENTS ONLY. The pencil means "you can change this". Local agents
 * are owned by this machine's operator; a remote agent, another person's agent
 * or a human photo is not, so `owned={false}` (or no `editHref`) renders the
 * bare picture with no link, no pencil and no tab stop - an affordance that
 * leads to a refusal is worse than none. The caller decides ownership because
 * only it knows where the identity came from; Team Bridge's lane, which owns
 * the popover and message placements, passes its own answer.
 *
 * IT DOES NOT RESOLVE PICTURES. `children` is whatever mark the surface draws -
 * `AgentMark` for a local agent, Team Bridge's resolver output on theirs - so
 * this wrapper stays independent of every resolver and can wrap any of them.
 *
 * WHY A LINK AND NOT A BUTTON. It goes somewhere; a link is what a screen
 * reader should announce and what a middle-click or a keyboard Enter expects.
 * Its accessible name is "Change {name}'s picture" (translated), so the picture
 * itself stays `alt=""` decoration and is not announced twice.
 *
 * NESTING. A surface whose row is already a `<button>` (the chat sidebar row)
 * must not put an `<a>` inside it - interactive content inside a button is
 * invalid and swallows clicks. Such a surface places this as a SIBLING of its
 * row button, which is what `chat-sidebar.tsx` does.
 */

import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Pencil } from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/**
 * The Agents-page URL that opens one agent's picture editor.
 *
 * `name` selects the pane (the page's own key for a profile), `agent` is the id
 * the editor uploads against, and `edit=picture` is the instruction that makes
 * the field scroll into view and take focus - and then drops itself from the
 * URL so a later visit does not re-focus.
 */
export function agentPictureEditorHref(target: {
	agentName: string;
	agentId?: string | null;
}): string {
	const params = new URLSearchParams({
		kind: "agent",
		name: target.agentName,
		edit: "picture",
	});
	if (target.agentId) params.set("agent", target.agentId);
	return `/agents?${params}`;
}

export type AgentAvatarEditLinkProps = {
	/**
	 * Extra props for the link itself: a surface that places it as a SIBLING of
	 * a row button (see NESTING above) positions it with these.
	 */
	linkProps?: { className?: string; style?: CSSProperties };
	/**
	 * True when this link is a sibling overlay on another element's button: it is
	 * then invisible and pointer-transparent until its `group/row` is hovered or
	 * it takes focus, so the underlying control keeps its own press.
	 */
	overlay?: boolean;
	/** The agent's display name, for the accessible name. */
	agentName: string;
	/** The agent id the editor uploads against (see `agentPictureEditorHref`). */
	agentId?: string | null;
	/** Whether the viewer owns this agent. False renders the bare picture. */
	owned: boolean;
	/**
	 * Where the editor is. Defaults to the Agents page for `agentName`; a
	 * caller that addresses agents differently passes its own.
	 */
	editHref?: string;
	/** The picture as the surface draws it. */
	children: ReactNode;
	className?: string;
	/** The pencil's size class; the default suits a 16-20px mark. */
	pencilClassName?: string;
};

export function AgentAvatarEditLink({
	agentName,
	agentId,
	owned,
	editHref,
	children,
	className,
	pencilClassName = "size-2",
	linkProps,
	overlay = false,
}: AgentAvatarEditLinkProps) {
	const navigate = useNavigate();
	if (!owned) {
		return (
			<span className={cn("relative inline-flex shrink-0", className)}>
				{children}
			</span>
		);
	}
	const href = editHref ?? agentPictureEditorHref({ agentName, agentId });
	const label = t("ui.agents.avatar.edit_link", { name: agentName });
	return (
		<a
			href={`#${href}`}
			aria-label={label}
			title={label}
			data-agent-avatar-edit=""
			/*
			 * The router is a hash router in the packaged app and a memory router in
			 * stories, so the href is informational (it shows on hover and survives a
			 * copy) and the press navigates through the router - a raw href would
			 * reload the renderer in one host and do nothing in the other. A modified
			 * click is left to the browser.
			 */
			onClick={(event: MouseEvent<HTMLAnchorElement>) => {
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.button)
					return;
				event.preventDefault();
				event.stopPropagation();
				navigate(href);
			}}
			className={cn(
				"group/avatar-edit relative inline-flex shrink-0 rounded-full",
				overlay &&
					/* OVERLAY MODE: the picture underneath belongs to someone else's button
					   (a sidebar row), so at rest this must not eat that button's own
					   press. The row's wrapper is the `group/row`, and hovering it - or
					   focusing here - brings the door forward. The anchor stays focusable
					   either way, which is the keyboard's door. */
					"pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
				"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				className,
				linkProps?.className,
			)}
			style={linkProps?.style}
		>
			{children}
			{/*
			 * THE PENCIL SITS ON A SCRIM OVER THE WHOLE DISC, shown only on hover or
			 * keyboard focus. Opacity is the only thing that changes, so nothing
			 * reflows under the pointer. The scrim (the theme's `scrim` role) quiets
			 * the photo; the pencil itself rides an `accent` chip in `on-accent` ink,
			 * the one fill/ink pair the contrast contract guarantees on every
			 * palette, so its legibility never depends on the picture or the scrim.
			 */}
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-scrim opacity-0",
					"transition-opacity duration-fast ease-out-quart",
					"group-hover/avatar-edit:opacity-100 group-focus-visible/avatar-edit:opacity-100",
				)}
			>
				<span className="flex items-center justify-center rounded-full bg-accent p-px text-on-accent">
					<Pencil className={pencilClassName} strokeWidth={2.5} />
				</span>
			</span>
		</a>
	);
}
