import { Avatar, AvatarFallback, Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Bot, FileText } from "lucide-react";
import type { FC } from "react";
import { type RunDetails, RunDetailsTrigger } from "./run-details";

/**
 * ChatHeaderProps
 * @property agentName - The name of the agent to display.
 * @property description - The description of the agent.
 * @property onOpenOptions - Optional callback for opening options/canvas.
 * @property runDetails - The session's derived subagent and to-do view model, or
 * `null`/absent when the session has none.
 *
 * `runDetails` is passed by `chat-page.tsx`, which owns the canonical stream and
 * derives the model per wire frame (`run-details.md` § 8); stories pass a fixture
 * instead. It stays OPTIONAL because its absence is a real state: `ChatContent`
 * also renders this header for a session with no canonical stream, where there
 * is nothing to derive from and the trigger must not appear. The trigger's own
 * visibility rule (has work, and the canvas closed) lives inside
 * `RunDetailsTrigger`, because both halves are facts about that surface rather
 * than about where the header puts it.
 */
type ChatHeaderProps = {
	agentName?: string;
	description?: string;
	onOpenOptions?: () => void;
	runDetails?: RunDetails | null;
};

export const ChatHeader: FC<ChatHeaderProps> = ({
	agentName = "Local Operator",
	description = "Your on-device AI assistant",
	onOpenOptions,
	runDetails = null,
}) => {
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);

	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const shortcut = isMac ? "⌘+Shift+C" : "Ctrl+Shift+C";

	return (
		<div
			/*
			 * 56px and `shrink-0`, matching the bar band its peers occupy: 52px
			 * command palette, 48px nav rail header, 40px canvas header. The old
			 * `h-21` declared 84px - 1.6x the largest peer - and, without `shrink-0`,
			 * never drew it: the column's flex deficit came out of this box, so it
			 * rendered 46.5px at one window size and 61.4px at another. A height that
			 * moves with composer content cannot be designed against, which is why
			 * the geometry is pinned before anything here is styled.
			 *
			 * 56 rather than 52: this bar carries two lines (16px name over 13px
			 * description, about 41px of text), where the command palette carries
			 * one. It is the smallest step on the 4px ramp that holds both without
			 * crowding them.
			 *
			 * `border-control`, not `hairline`, for the bottom rule. This line is
			 * what says the title block is chrome and the transcript below it is
			 * content - branding.md's own test for a structural boundary is
			 * whether removing it loses information, and here it does. As
			 * `hairline` it measured 1.32:1 against the sidebar's own header rule
			 * 8px away at 4.18:1: two rules at the top of one window drawn 3.2x
			 * apart, with the chat one the faint one. It matters more in a
			 * packaged build than these frames suggest, because the Chat/Raw tab
			 * row beneath it is `isDevelopmentMode()`-gated - in production this
			 * rule sits directly against the transcript's first row and is the
			 * only thing separating them.
			 */
			className={cn(
				"flex h-14 shrink-0 items-center gap-3 border-control border-b px-4",
			)}
			data-tour-tag="chat-header"
		>
			{/* No `size-*` override: the Avatar primitive's own 32px is the app's
			 * control size, and the 40px override made the same agent wear two
			 * different faces on one screen against the transcript's 28px marker.
			 * The glyph is sized by class rather than lucide's numeric `size` prop
			 * so a `size-*` sweep can see it; 16px is the ramp's default step and
			 * what a 32px circle carries. */}
			<Avatar>
				<AvatarFallback>
					<Bot className={cn("size-4")} aria-hidden={true} />
				</AvatarFallback>
			</Avatar>
			{/* `flex-1` as well as `min-w-0`: the block was min-w-0 inside a row
			 * whose only other content is an `ml-auto` action, so it yielded before
			 * the empty space did - the description clipped mid-sentence at 760px
			 * while 220px of bar sat unused to its right. Growing first means the
			 * text truncates only once there is genuinely no room left. */}
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				{/* `text-heading`, not `text-title`: branding.md reserves the 20px step
				 * for section and dialog titles and states that a desktop app has no
				 * hero. 20px over 13px also skipped two ramp steps in one bar. */}
				<h2 className={cn("truncate text-heading text-ink")}>{agentName}</h2>
				<span
					className={cn("truncate text-ink-muted text-body-sm")}
					title={description}
				>
					{description}
				</span>
			</div>

			{/*
			 * The header's action cluster: the run-details trigger, then the canvas
			 * button, as one group at the end of the bar. The cluster carries the
			 * `ml-auto` the canvas button used to carry, so the two actions sit 8px
			 * apart instead of being pinned to opposite ends of whatever else the bar
			 * happens to hold.
			 *
			 * The canvas button keeps its own gate exactly as it was
			 * (`onOpenOptions && !isCanvasOpen`). The trigger's gate is inside
			 * `RunDetailsTrigger`, and it returns `null` when it has nothing to show —
			 * so with an idle session this cluster is 8px of nothing and the header is
			 * pixel-for-pixel what it is today.
			 */}
			<div className={cn("ml-auto flex items-center gap-2")}>
				<RunDetailsTrigger details={runDetails} />
				{onOpenOptions && !isCanvasOpen && (
					<Tooltip content={`Open canvas (${shortcut})`} side="top">
						<Button
							variant="ghost"
							/* 32px `icon`, the size every other header action in the app
							 * uses. `icon-lg` (36px) made this one button the outlier. */
							size="icon"
							onClick={() => setCanvasOpen(true)}
							aria-label={`Open canvas (${shortcut})`}
							data-tour-tag="open-canvas-button"
						>
							<FileText aria-hidden={true} />
						</Button>
					</Tooltip>
				)}
			</div>
		</div>
	);
};
