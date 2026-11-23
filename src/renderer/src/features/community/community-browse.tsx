/**
 * D5 - Browse, opened over the current channel (RFC v2.4 §5.4).
 *
 * CHANNELS: search by name or purpose, All / Joined / Not joined / Private
 * chips, and rows that state joined and private in TEXT (a badge with a word),
 * never colour alone. Private channels the reader is not in are never listed.
 *
 * WHAT THE ROW'S ACTION IS. Every row opens the channel. The local member door
 * has no join-channel operation yet (its thirteen ops are list, bootstrap, join
 * and leave the COMMUNITY, channels, history, submit, submission status and
 * cancel, edit, delete, react, events), so "Join" for a public channel the
 * reader has not joined is not offered: opening it shows its public history,
 * and the not-joined state is said in text. The join control lands with that
 * operation.
 *
 * PEOPLE: the directory people route is `x-status: planned` in the contract and
 * absent from the member allowlist, so the tab says "coming soon" rather than
 * showing an empty search that looks like nobody is here.
 *
 * Member counts render only when the hub supplies them (`member_count` is not in
 * contract 1.0.0-draft); a guessed count would contradict mobile and relay.
 */
import type { CommunityChannel } from "@shared/api/local-operator/community-api";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Check, Hash, Lock, Search, Users } from "lucide-react";
import { type FC, useState } from "react";
import { type CommunityBrowseFilter, browseChannels } from "./community-model";

const FILTERS: readonly CommunityBrowseFilter[] = [
	"all",
	"joined",
	"not_joined",
	"private",
];

const FILTER_KEY = {
	all: "ui.community.browse.filter.all",
	joined: "ui.community.browse.filter.joined",
	not_joined: "ui.community.browse.filter.not_joined",
	private: "ui.community.browse.filter.private",
} as const satisfies Record<CommunityBrowseFilter, string>;

export const CommunityBrowseView: FC<{
	open: boolean;
	onClose: () => void;
	communityName: string;
	channels: readonly CommunityChannel[];
	state: "loading" | "error" | "ready";
	onRetry: () => void;
	onOpenChannel: (channelId: string) => void;
	/** Story/capture seeds only. */
	defaultTab?: "channels" | "people";
	defaultQuery?: string;
	defaultFilter?: CommunityBrowseFilter;
}> = ({
	open,
	onClose,
	communityName,
	channels,
	state,
	onRetry,
	onOpenChannel,
	defaultTab = "channels",
	defaultQuery = "",
	defaultFilter = "all",
}) => {
	useI18nLocale();
	const [tab, setTab] = useState<"channels" | "people">(defaultTab);
	const [query, setQuery] = useState(defaultQuery);
	const [filter, setFilter] = useState<CommunityBrowseFilter>(defaultFilter);
	const rows = browseChannels(channels, filter, query);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				data-community-browse=""
				className="max-w-[600px] gap-0 p-0"
			>
				<div className="flex flex-col gap-3 p-4 pb-0">
					<DialogTitle className="pe-8 text-[15px]">
						{t("ui.community.browse.title", { community: communityName })}
					</DialogTitle>
					<div className="relative">
						<Search
							size={14}
							aria-hidden="true"
							className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							autoFocus
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("ui.community.browse.search")}
							aria-label={t("ui.community.browse.search")}
							className="ps-8"
						/>
					</div>
					{tab === "channels" && (
						<fieldset
							aria-label={t("ui.community.browse.filter.label")}
							className="m-0 flex flex-wrap gap-1.5 border-0 p-0"
						>
							{FILTERS.map((value) => (
								<button
									key={value}
									type="button"
									aria-pressed={filter === value}
									onClick={() => setFilter(value)}
									className={cn(
										"inline-flex h-7 items-center gap-1 rounded-full border px-3 text-meta-sm",
										filter === value
											? "border-accent bg-accent-wash text-ink"
											: "border-control text-ink-muted hover:bg-elevated",
									)}
								>
									{filter === value && <Check size={12} aria-hidden="true" />}
									{t(FILTER_KEY[value])}
								</button>
							))}
						</fieldset>
					)}
					<div role="tablist" className="flex gap-4 border-b border-hairline">
						{(["channels", "people"] as const).map((value) => (
							<button
								key={value}
								type="button"
								role="tab"
								aria-selected={tab === value}
								onClick={() => setTab(value)}
								className={cn(
									"-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px]",
									tab === value
										? "border-accent text-ink"
										: "border-transparent text-ink-muted hover:text-ink",
								)}
							>
								{value === "channels" ? (
									<Hash size={13} aria-hidden="true" />
								) : (
									<Users size={13} aria-hidden="true" />
								)}
								{value === "channels"
									? t("ui.community.browse.tab.channels")
									: t("ui.community.browse.tab.people")}
							</button>
						))}
					</div>
				</div>
				<div
					role="tabpanel"
					className="max-h-[420px] min-h-[200px] overflow-y-auto px-2 py-2"
				>
					{tab === "people" ? (
						<p
							data-community-browse-people="soon"
							className="px-3 py-10 text-center text-[13px] text-ink-muted"
						>
							{t("ui.community.browse.people_soon")}
						</p>
					) : state === "loading" ? (
						<output className="block px-3 py-10 text-center text-[13px] text-ink-muted">
							{t("ui.community.browse.loading")}
						</output>
					) : state === "error" ? (
						<div className="flex flex-col items-center gap-3 px-3 py-10">
							<p className="text-[13px] text-ink">
								{t("ui.community.browse.error")}
							</p>
							<Button variant="secondary" size="sm" onClick={onRetry}>
								{t("ui.community.channel.retry")}
							</Button>
						</div>
					) : rows.length === 0 ? (
						<p className="px-3 py-10 text-center text-[13px] text-ink-muted">
							{t("ui.community.browse.empty")}
						</p>
					) : (
						<ul>
							{rows.map((channel) => (
								<li
									key={channel.id}
									data-community-browse-row={channel.name}
									className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-surface"
								>
									{channel.visibility === "private" ? (
										<Lock
											size={15}
											aria-hidden="true"
											className="text-ink-dim"
										/>
									) : (
										<Hash
											size={15}
											aria-hidden="true"
											className="text-ink-dim"
										/>
									)}
									<div className="min-w-0 flex-1">
										<p className="flex items-center gap-2">
											<span className="truncate text-[13px] font-medium text-ink">
												{channel.name}
											</span>
											<span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 text-meta-sm text-ink-muted">
												{channel.visibility === "private" ? (
													<>
														<Lock size={10} aria-hidden="true" />
														{t("ui.community.browse.private_member")}
													</>
												) : channel.member === false ? (
													t("ui.community.browse.not_joined")
												) : (
													<>
														<Check size={10} aria-hidden="true" />
														{t("ui.community.browse.joined")}
													</>
												)}
											</span>
										</p>
										{channel.purpose && (
											<p className="truncate text-meta-sm text-ink-muted">
												{channel.purpose}
											</p>
										)}
									</div>
									{typeof channel.member_count === "number" && (
										<span className="flex shrink-0 items-center gap-1 text-meta-sm tabular-nums text-ink-muted">
											<Users size={12} aria-hidden="true" />
											{t("ui.community.browse.members", {
												count: channel.member_count,
											})}
										</span>
									)}
									<Button
										variant="secondary"
										size="sm"
										data-community-action="browse-open"
										onClick={() => onOpenChannel(channel.id)}
									>
										{t("ui.community.browse.open")}
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
				{tab === "channels" && state === "ready" && (
					<p className="border-t border-hairline px-4 py-2 text-meta-sm text-ink-muted">
						{t("ui.community.browse.count", { count: rows.length })}
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
};
