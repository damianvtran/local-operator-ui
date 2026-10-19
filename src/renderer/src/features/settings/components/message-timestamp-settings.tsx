import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { ToggleSetting } from "@shared/components/common/toggle-setting";
import {
	Alert,
	Button,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import type { FC } from "react";
import { messageTimestampRows } from "../message-timestamp-rows";
import { backendSettingsKeys } from "./backend-settings-section";

const TIMESTAMPS_KEY = "display.message_timestamps";
const STYLE_KEY = "display.message_timestamp_style";

/*
 * The registry's help text ends in a "(desktop app)" scope tag written for the
 * terminal's /settings list. Here, on the desktop's own Appearance page, it is
 * noise. Strip ONE trailing parenthetical (ASCII or full-width brackets, so a
 * translated tag goes too) and nothing else; copy without one is untouched.
 */
const TRAILING_PAREN =
	/\s*[(\uFF08][^()\uFF08\uFF09]*[)\uFF09](\s*[.\u3002])?\s*$/u;
export const withoutScopeTag = (help: string): string =>
	help.replace(TRAILING_PAREN, (_, stop?: string) => (stop ? "." : "")).trim();

type Failure = { key: string; value: unknown; message: string };

/**
 * The message-timestamp preferences inside Settings > Appearance, presented
 * like their neighbours (an instant switch, a segmented control) rather than as
 * registry rows with Save. Each change COMMITS ON CHANGE through
 * `settings.edit`, then refetches the shared `backendSettingsKeys.all` entry so
 * every open transcript repaints. Labels, help and choices are the registry's
 * (single-sourced, localised by the backend); renders nothing while the plane
 * does not advertise `settings` or the backend predates the keys.
 */
export const MessageTimestampSettings: FC = () => {
	const capabilities = useDesktopCapabilities();
	const advertised = desktopFeatureEnabled(capabilities.data, "settings");
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: advertised,
		staleTime: 10_000,
	});
	const rows = useMemo(
		() => messageTimestampRows(settingsQuery.data?.settings ?? []),
		[settingsQuery.data],
	);
	const master = rows.find((row) => row.key === TIMESTAMPS_KEY);
	const style = rows.find((row) => row.key === STYLE_KEY);

	const [failure, setFailure] = useState<Failure | null>(null);
	// The style the reader just picked, shown until the refetch confirms it.
	const [pendingStyle, setPendingStyle] = useState<string | null>(null);
	const noteId = useId();
	const labelId = useId();

	if (!advertised || !master) return null;

	const commit = async (key: string, value: unknown) => {
		setFailure(null);
		try {
			await desktopResult({ op: "settings.edit", key, value: value as never });
			await settingsQuery.refetch();
			setPendingStyle(null);
		} catch (error) {
			setPendingStyle(null);
			setFailure({
				key,
				value,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};

	const on = master.value === true;
	const styleValue = pendingStyle ?? String(style?.value ?? "absolute");

	return (
		<div
			className="flex flex-col gap-3"
			data-testid="message-timestamp-settings"
		>
			<div data-setting-key={master.key}>
				<ToggleSetting
					value={on}
					label={master.label}
					description={withoutScopeTag(master.help)}
					onChange={(next) => commit(master.key, next)}
				/>
			</div>
			{style && (
				<div
					data-setting-key={style.key}
					aria-disabled={!on}
					className="flex items-start justify-between gap-4"
				>
					<div className="min-w-0 flex-1">
						<span
							id={labelId}
							className={cn(
								"flex min-h-6 items-center text-body",
								on ? "text-ink" : "text-ink-dim",
							)}
						>
							{style.label}
						</span>
						<p
							id={noteId}
							className="mt-0.5 max-w-2xl text-body-sm text-ink-muted"
						>
							{on
								? withoutScopeTag(style.help)
								: `Turn on ${master.label} to choose a style.`}
						</p>
					</div>
					<div className="flex h-6 shrink-0 items-center">
						<Tabs
							value={styleValue}
							onValueChange={(next) => {
								if (!on) return;
								setPendingStyle(next);
								void commit(style.key, next).catch(() => undefined);
							}}
						>
							<TabsList aria-labelledby={labelId} aria-describedby={noteId}>
								{style.choices.map(
									(choice: BackendSetting["choices"][number]) => (
										<TabsTrigger
											key={String(choice.value)}
											value={String(choice.value)}
											disabled={!on}
										>
											{choice.label}
										</TabsTrigger>
									),
								)}
							</TabsList>
						</Tabs>
					</div>
				</div>
			)}
			{failure && (
				<Alert variant="danger" role="alert">
					<span>{failure.message}</span>{" "}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							void commit(failure.key, failure.value).catch(() => undefined);
						}}
					>
						{t("ui.settings.configuration.backend_setting_row.retry")}
					</Button>
				</Alert>
			)}
		</div>
	);
};
