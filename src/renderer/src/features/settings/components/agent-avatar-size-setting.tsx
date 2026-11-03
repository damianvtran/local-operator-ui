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
	parseAgentAvatarSize,
} from "@features/chat/agent-avatar-size";
import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
