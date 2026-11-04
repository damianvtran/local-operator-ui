/**
 * The agent picture size setting: a labelled row whose control is the app's own
 * segmented one, the same shape and geometry as `TranscriptDisplayModeSetting`
 * (it sits directly beneath it in Settings > Appearance), so the two rows read as
 * a pair and the tablist is named by the row's visible label.
 *
 * APP-LEVEL, NOT PER-AGENT: the step is the reader's, kept in the preferences
 * store (`agentAvatarSize`) and judged by `parseAgentAvatarSize` on the way in and
 * out. It sizes the chat window's turn head and the chat header; the help line
 * says the sidebar does not follow, because a reader who raises it and then looks
 * at the sidebar would otherwise think the setting is broken.
 */

import {
	AGENT_AVATAR_SIZE_OPTIONS,
	type AgentAvatarSize,
	HEADER_AVATAR_BOX,
	TURN_AVATAR_BOX,
	TURN_AVATAR_GAP,
	parseAgentAvatarSize,
} from "@features/chat/agent-avatar-size";
import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui";
import { AgentAvatar } from "@shared/components/ui/avatar";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { User } from "lucide-react";
import { type FC, useId } from "react";

type AgentAvatarSizeSettingProps = {
	/** The active step. */
	value: AgentAvatarSize;

	/** Called with the step the reader chose. */
	onChange: (size: AgentAvatarSize) => void;

	/** Settings search's stable row id, when this control is a searchable row. */
	searchRow?: string;
};

const BASE = "ui.settings.appearance.agent_avatar_size_setting";

const stepLabel = (size: AgentAvatarSize): string =>
	size === "small"
		? t(`${BASE}.small`)
		: size === "medium"
			? t(`${BASE}.medium`)
			: t(`${BASE}.large`);

/**
 * A LIVE SAMPLE OF WHAT THE STEP DRAWS (design review D4). The tabs say "Small"
 * and nothing about how small, and the two places the setting acts are not on
 * this page, so the row shows both: a header line (the face at the header's box
 * beside a title bar) and a turn head (the face at the turn head's box above the
 * first line). Each draws the same boxes and the same gap the shipped surfaces
 * read from `agent-avatar-size.ts`, on the neutral plate every picture sits on,
 * so the sample cannot drift from the surface. It is decoration: `aria-hidden`
 * and wordless, so it adds no copy to translate and nothing to announce - the
 * tabs are the control.
 */
/**
 * The sidebar row's picture, which the setting does not touch: `size-4` in
 * `chat-session-avatar.tsx` (`SESSION_MARK_BOX`) and the rail's 16px disc. Named
 * here so the sample draws the same box; `scripts/agent-avatar-presence.test.mjs`
 * pins it to the row's own constant.
 */
const SIDEBAR_AVATAR_BOX = { className: "size-4", glyphClassName: "size-2" };

const SizeSample: FC<{ size: AgentAvatarSize }> = ({ size }) => {
	const header = HEADER_AVATAR_BOX[size];
	const turn = TURN_AVATAR_BOX[size];
	const gap = TURN_AVATAR_GAP[size];
	const face = (box: string, glyph: string) => (
		<AgentAvatar
			className={cn("items-center justify-center text-ink-muted", box)}
		>
			<User className={glyph} aria-hidden="true" />
		</AgentAvatar>
	);
	return (
		<div
			aria-hidden="true"
			data-agent-size-sample={size}
			className="mt-3 flex items-start gap-6 rounded-md border border-hairline bg-surface p-3"
		>
			<div className="flex h-10 items-center gap-2">
				{face(header.className, header.glyphClassName)}
				<span className="h-2 w-16 rounded-full bg-sunken" />
			</div>
			<div className="flex flex-col">
				<span className={cn("flex", gap.className)}>
					{face(turn.className, turn.glyphClassName)}
				</span>
				<span className="h-2 w-28 rounded-full bg-sunken" />
			</div>
			{/*
			 * THE REFERENCE FOR "SIDEBAR ROWS KEEP THEIR SIZE" (design review D8): the
			 * sidebar's own fixed 16px mark beside a title bar, which does not move
			 * with the step. Wordless and aria-hidden like the rest of the sample, so
			 * the sentence above it is the only copy.
			 */}
			<div
				data-agent-size-sample-fixed=""
				className="flex h-10 items-center gap-2"
			>
				{face(SIDEBAR_AVATAR_BOX.className, SIDEBAR_AVATAR_BOX.glyphClassName)}
				<span className="h-2 w-12 rounded-full bg-sunken" />
			</div>
		</div>
	);
};

export const AgentAvatarSizeSetting: FC<AgentAvatarSizeSettingProps> = ({
	value,
	onChange,
	searchRow,
}) => {
	useI18nLocale();
	const labelId = useId();
	return (
		<div
			data-search-row={searchRow}
			data-search-control={searchRow ? "" : undefined}
			className="flex items-start justify-between gap-4"
		>
			<div className="min-w-0 flex-1">
				<span
					id={labelId}
					className="flex min-h-6 items-center text-body text-ink"
				>
					{t(`${BASE}.agent_picture_size`)}
				</span>
				<p className="mt-0.5 max-w-2xl text-body-sm text-ink-muted">
					{t(
						`${BASE}.how_large_the_agent_s_picture_appears_in_the_chat_window_and_the_chat`,
					)}
				</p>
				<SizeSample size={parseAgentAvatarSize(value)} />
			</div>
			{/* Fixed height, matching `ToggleSetting`, so the row's baseline holds. */}
			<div className="flex h-6 shrink-0 items-center">
				<Tabs
					value={value}
					onValueChange={(next) => onChange(parseAgentAvatarSize(next))}
				>
					<TabsList aria-labelledby={labelId}>
						{AGENT_AVATAR_SIZE_OPTIONS.map((size) => (
							<TabsTrigger key={size} value={size}>
								{stepLabel(size)}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>
		</div>
	);
};
