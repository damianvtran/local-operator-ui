/**
 * The full backend settings registry as searchable, typed editors.
 *
 * One destination for every registered key: a top search over labels, help
 * text and keys, with rows grouped under their registry sections. Each section
 * header carries its scope tag, because the moment a write lands and the
 * moment behaviour changes are not the same for most keys. "This device" is
 * the scope the desktop app owns itself (theme, onboarding state); it lives
 * in the page's own sections, not in this backend list.
 *
 * Dirty drafts are local to each row and survive failed saves; see
 * BackendSettingRow for that contract.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button, Input } from "@shared/components/ui";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackendSettingRow } from "./backend-setting-row";

export const backendSettingsKeys = {
	all: ["desktop", "settings"] as const,
};

/** Human-readable scope tags. The backend emits enum values; the words on the
 * header answer "when does this take effect", not "what enum is it". */
const SCOPE_LABELS: Record<string, string> = {
	live: "Takes effect immediately",
	new_launch: "Takes effect for new sessions",
	restart: "Takes effect after a restart",
};

type BackendSettingsSectionProps = {
	/** Key to reveal and focus, from a /settings navigation target. */
	focusKey?: string | null;
	/** Initial search filter, e.g. "web-search" from /search. */
	initialFilter?: string;
};

export const BackendSettingsSection: FC<BackendSettingsSectionProps> = ({
	focusKey,
	initialFilter = "",
}) => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "settings");
	const [filter, setFilter] = useState(initialFilter);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const focusAttempted = useRef(false);

	const query = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled,
		staleTime: 10_000,
	});

	const settings = query.data;
	const filtered = useMemo(() => {
		if (!settings) return null;
		const needle = filter.trim().toLowerCase();
		if (!needle) return settings.settings;
		return settings.settings.filter((setting) =>
			[setting.label, setting.help, setting.key, setting.section]
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [settings, filter]);

	// A /settings navigation target reveals its section and focuses the field.
	useEffect(() => {
		if (!focusKey || !settings || focusAttempted.current) return;
		focusAttempted.current = true;
		const target = settings.settings.find((s) => s.key === focusKey);
		if (!target) return;
		setCollapsed((current) => {
			if (!current.has(target.section)) return current;
			const next = new Set(current);
			next.delete(target.section);
			return next;
		});
		// Focus after the reveal has painted.
		requestAnimationFrame(() => {
			const el = document.querySelector<HTMLElement>(
				`[data-setting-key="${CSS.escape(focusKey)}"] input, [data-setting-key="${CSS.escape(focusKey)}"] textarea, [data-setting-key="${CSS.escape(focusKey)}"] button[role="switch"], [data-setting-key="${CSS.escape(focusKey)}"] button`,
			);
			el?.focus();
			el?.scrollIntoView({ block: "center" });
		});
	}, [focusKey, settings]);

	if (capabilities.data && !enabled) {
		return (
			<Alert variant="warning">
				Searchable backend settings need a newer Local Operator backend. Update
				the backend and restart the app to manage these settings here.
			</Alert>
		);
	}

	if (query.isLoading) {
		return (
			<div className="flex h-40 items-center justify-center">
				<Spinner size="lg" label="Loading settings" />
			</div>
		);
	}

	if (query.isError || !settings || !filtered) {
		return (
			<Alert variant="warning">
				<div className="flex items-center justify-between gap-3">
					<span>
						Settings could not be loaded. The backend may need an update.
					</span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void query.refetch()}
					>
						Retry
					</Button>
				</div>
			</Alert>
		);
	}

	const sections = settings.sections.filter((section) =>
		filtered.some((setting) => setting.section === section.name),
	);

	const toggle = (name: string) =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	return (
		<div className="flex flex-col gap-6">
			<div className="relative">
				<Search
					size={16}
					className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim"
					aria-hidden="true"
				/>
				<Input
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					placeholder="Search settings by name, description or key"
					aria-label="Search settings"
					className="pl-9"
				/>
				{filter && (
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute top-1/2 right-1 -translate-y-1/2"
						onClick={() => setFilter("")}
						aria-label="Clear search"
					>
						<X aria-hidden="true" />
					</Button>
				)}
			</div>

			{filtered.length === 0 && (
				<div className="flex flex-col items-center gap-2 py-6 text-center">
					<p className="text-body-sm text-ink-muted">
						No settings match this search.
					</p>
					<Button variant="secondary" size="sm" onClick={() => setFilter("")}>
						<X aria-hidden="true" />
						Clear search
					</Button>
				</div>
			)}

			{sections.map((section) => {
				const rows = filtered.filter(
					(setting) => setting.section === section.name,
				);
				const isCollapsed = collapsed.has(section.name);
				return (
					<section
						key={section.name}
						data-settings-section={section.name}
						className="flex flex-col gap-3"
					>
						<button
							type="button"
							onClick={() => toggle(section.name)}
							aria-expanded={!isCollapsed}
							className="flex items-baseline justify-between gap-3 text-left"
						>
							<span className="flex flex-col gap-0.5">
								<span className="text-heading text-ink">{section.title}</span>
								{section.description && (
									<span className="text-meta text-ink-dim">
										{section.description}
									</span>
								)}
							</span>
							<Badge variant="neutral">
								{SCOPE_LABELS[section.scope] ?? section.scope}
							</Badge>
						</button>
						{!isCollapsed && (
							<div className="flex flex-col gap-5">
								{rows.map((setting: BackendSetting) => (
									<BackendSettingRow
										key={setting.key}
										setting={setting}
										scope={SCOPE_LABELS[section.scope]}
										onSaved={() => query.refetch()}
									/>
								))}
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
};
