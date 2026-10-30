import type { OwnerAuditScope } from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert } from "@shared/components/ui/alert";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Eye, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
import type {
	OwnerAuditConversation,
	OwnerAuditMessage,
} from "../../../../shared/team-bridge-owner-audit-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import type { ChiefLabels } from "./team-bridge-model";
import {
	ownerAuditChronology,
	ownerAuditDelivery,
	ownerAuditSenderLabel,
	ownerAuditSenderProfile,
	ownerAuditTitle,
	ownerAuditToBridgeMessage,
} from "./team-bridge-owner-audit-model";
import { ConversationKindIcon, RAIL_ROW } from "./team-bridge-rail";
import { useTeamBridgeDirectory } from "./use-team-bridge";
import {
	useOwnerAuditConversations,
	useOwnerAuditMessages,
	useOwnerAuditReplies,
} from "./use-team-bridge-owner-audit";

type ReadState = "loading" | "error" | "ready";

/**
 * A FAILED LATER PAGE MUST NOT ERASE WHAT IS ALREADY SHOWN.
 *
 * `fetchNextPage` (and a background refetch) that rejects puts the whole query
 * into `status: "error"` even though its earlier pages are still in `data`, so
 * deriving the view from `isError` alone replaced a loaded transcript — or the
 * whole rail — with the failure block when "Load older messages" hit a 503
 * (agent review round 1, M1: reproduced against these components). `data` is
 * the fact that a read succeeded; the error state belongs to the reader that
 * has nothing to show. A failed later page keeps the rows and offers the retry
 * that failed-page affordance already carries.
 */
function readState(query: {
	isPending: boolean;
	isError: boolean;
	data: unknown;
}): ReadState {
	if (query.isPending) return "loading";
	if (query.isError && !query.data) return "error";
	return "ready";
}
const title = (conversation: OwnerAuditConversation) =>
	ownerAuditTitle(conversation, t("ui.ownerAudit.unnamed"));

/**
 * A refusal is NOT an empty list, and it must not LOOK like one either.
 *
 * The words already differed; the treatment did not, so an empty section and a
 * failed one were the same grey paragraph (design review round 1, D6). The
 * failure now wears the semantic danger ink the contrast contract verifies, sits
 * on its section's own inset instead of outdenting itself, and is the ONLY retry
 * in its scope — the panel header drops its Refresh while this is what the
 * reader is looking at, so one refetch does not appear twice (D7).
 */
function AuditFailure({
	retry,
	inset = "px-3",
}: {
	retry: () => void;
	/*
	 * The section's own inline inset. The rail's rows sit at `px-3`; the panel's
	 * transcript rows carry a 20px gutter (`px-5`) now that the scroll container
	 * has none, so the panel passes that and its failure lines up with the
	 * column instead of hanging 8px left of it (design review round 1, D2).
	 */
	inset?: "px-3" | "px-5";
}) {
	return (
		<div role="alert" className={cn("space-y-2 text-sm text-danger", inset)}>
			<p>{t("ui.ownerAudit.error")}</p>
			<Button variant="ghost" onClick={retry}>
				{t("ui.ownerAudit.retry")}
			</Button>
		</div>
	);
}

export function OwnerAuditRailView({
	conversations,
	state,
	selectedId,
	onSelect,
	retry,
	hasMore = false,
	loadingMore = false,
	loadMore,
}: {
	conversations: OwnerAuditConversation[];
	state: ReadState;
	selectedId?: string;
	onSelect: (conversation: OwnerAuditConversation) => void;
	retry: () => void;
	hasMore?: boolean;
	loadingMore?: boolean;
	loadMore?: () => void;
}) {
	useI18nLocale();
	if (state === "loading")
		return (
			<output className="px-3 py-2 text-sm text-ink-muted">
				{t("ui.ownerAudit.loading")}
			</output>
		);
	if (state === "error") return <AuditFailure retry={retry} />;
	return (
		<>
			{conversations.length === 0 && (
				<p className="px-3 py-2 text-sm text-ink-muted">
					{t("ui.ownerAudit.empty_list")}
				</p>
			)}
			<ul>
				{conversations.map((conversation) => (
					<li key={conversation.id}>
						<button
							type="button"
							aria-current={selectedId === conversation.id ? "page" : undefined}
							/* One 30px rail anatomy: the audit is already scoped to this
							   chief of staff, so repeating her name added a second line
							   instead of information (design round 2, D1). */
							className={cn(
								RAIL_ROW,
								"text-ink-muted hover:bg-row-hover hover:text-ink",
								selectedId === conversation.id && "bg-row-selected text-ink",
							)}
							onClick={() => onSelect(conversation)}
						>
							<ConversationKindIcon kind={conversation.kind} />
							<span className="min-w-0 flex-1 truncate">
								{title(conversation)}
							</span>
						</button>
					</li>
				))}
			</ul>
			{hasMore && (
				<Button variant="ghost" disabled={loadingMore} onClick={loadMore}>
					{t("ui.ownerAudit.more")}
				</Button>
			)}
		</>
	);
}

function OwnerAuditRail({
	scope,
	selectedId,
	onSelect,
}: {
	scope: OwnerAuditScope;
	selectedId?: string;
	onSelect: (conversation: OwnerAuditConversation) => void;
}) {
	const query = useOwnerAuditConversations(scope);
	const conversations = [
		...new Map(
			query.data?.pages
				.flatMap((page) => page.conversations)
				.map((row) => [row.id, row]) ?? [],
		).values(),
	];
	return (
		<OwnerAuditRailView
			conversations={conversations}
			selectedId={selectedId}
			onSelect={onSelect}
			state={readState(query)}
			retry={() => void query.refetch()}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			loadMore={() => void query.fetchNextPage()}
		/>
	);
}

/**
 * The chief-of-staff label composition, from the same two catalogue strings
 * every Team Bridge surface uses ("Aida (Ben Tran)" / "Ben Tran's chief of
 * staff"). Defined here (and only here for the audit), not imported from the page,
 * because the page module is the composition root (importing it would pull the whole page into this view's
 * bundle and couple two lanes that ship separately).
 */
function ownerAuditChiefLabels(): ChiefLabels {
	return {
		named: (agent, person) => t("ui.teamBridge.chief.label", { agent, person }),
		unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
	};
}

/*
 * THE VERDICT NEEDS ITS OWN CHANNEL. It used to be a third grey field beside the
 * sender and the timestamp — same size, same ink, no mark — so the one question
 * this surface exists to answer ("what did my chief of staff let through?")
 * could not be answered by scanning (design review round 1, D1). These are the
 * shipped `Badge` variants and their contrast-audited wash/ink pairs, so the
 * mark carries meaning in every palette without a new token: admitted is
 * quiet-positive, rejected is the refusal, not screened is informational, and
 * an unknown verdict stays neutral rather than borrowing a judgement it does
 * not have.
 *
 * "OWN" CARRIES NO CHIP. In a chief of staff's own DM most rows are her own
 * messages, and a "Sent by your chief of staff" chip on every one of them was
 * noise that drowned the verdicts that matter. The row's name and Bot avatar
 * already say who sent it, so the absence of a chip is the quiet state.
 */
const VERDICT = {
	admitted: { variant: "success", copy: "ui.ownerAudit.admitted" },
	rejected: { variant: "danger", copy: "ui.ownerAudit.rejected" },
	not_screened: { variant: "info", copy: "ui.ownerAudit.not_screened" },
	unknown: { variant: "neutral", copy: "ui.ownerAudit.unknown_status" },
} as const;

/**
 * The audit transcript: the SHARED message list, plus what only an audit adds.
 *
 * ONE RENDERER. Channels and DMs render through `TeamBridgeMessageList`; the
 * audit used to hand-roll its rows (wip slice c766a8c2daa), so markdown, the
 * avatar, day dividers, clock times, runs and the "Aida (Person)" names all
 * differed between the two doors to the same conversation. The rows now come
 * from the list, and the audit's additions travel through its read-only
 * `decorate` hook: the verdict chip, the collapse of unadmitted text, the
 * audit's own null-body sentence, the attachment notes and thread replies.
 *
 * THE OLD "NEVER INVOKE MARKDOWN" RULE is still met in substance: the list's
 * body renderer (`TeamBridgeMarkdown`) emits no raw HTML, draws images as text
 * and links only http(s)/mailto, which is the same guarantee a member's channel
 * relies on for the same bodies. What this surface must never do — load an
 * attachment's bytes, offer a reaction, a reply or a "Message" action — is
 * withheld by omission: the adapter drops `attachments`, and none of
 * `reactionContext` / `onReply` / `onMessagePerson` is passed, so the toolbar
 * (which renders nothing without one of the first two) and the profile card's
 * Message button do not exist here.
 */
function AuditTranscript({
	conversation,
	messages,
	people,
	renderReplies,
	density,
}: {
	conversation: OwnerAuditConversation;
	messages: OwnerAuditMessage[];
	people: readonly TeamBridgeDirectoryMember[];
	renderReplies?: (message: OwnerAuditMessage) => ReactNode;
	density?: "regular" | "compact";
}) {
	const wire = new Map(messages.map((message) => [message.id, message]));
	const chiefLabels = ownerAuditChiefLabels();
	return (
		<TeamBridgeMessageList
			messages={messages.map(ownerAuditToBridgeMessage)}
			labelFor={(sender) =>
				ownerAuditSenderLabel(sender, people, conversation.members, chiefLabels)
			}
			profileFor={(sender) => ownerAuditSenderProfile(sender, people)}
			tenantId={conversation.tenant_id}
			density={density}
			/* A distinct stream, and no arrival motion: an audit is a paged read of
			   history, and sharing the member stream's key would let this read write
			   that conversation's arrival journal. */
			arrivalKey={`owner-audit:${conversation.tenant_id}:${conversation.id}`}
			arrivalsEnabled={false}
			decorate={(row) => {
				const message = wire.get(row.id);
				if (!message) return undefined;
				const delivery = ownerAuditDelivery(
					message,
					conversation.agent.account_id,
				);
				const verdict = delivery === "own" ? null : VERDICT[delivery];
				const attachmentCount =
					message.attachments?.length ?? message.attachment_count ?? 0;
				return {
					badge: verdict && (
						<Badge variant={verdict.variant}>{t(verdict.copy)}</Badge>
					),
					withheldCopy: t("ui.ownerAudit.body_unavailable"),
					/* Unadmitted text is plaintext-equivalent and closed by default: the
					   owner opens it deliberately. Admitted and own text read open. */
					collapsedSummary:
						delivery === "admitted" || delivery === "own"
							? undefined
							: t("ui.ownerAudit.reveal"),
					attachments:
						attachmentCount > 0 ? (
							<ul className="mt-1 space-y-0.5 text-[12px] text-ink-muted">
								{message.attachments?.length ? (
									message.attachments.map((attachment) => (
										<li key={attachment.id}>
											{attachment.state === "expired"
												? t("ui.ownerAudit.attachment_expired")
												: t("ui.ownerAudit.attachment_unavailable")}
										</li>
									))
								) : (
									<li>{t("ui.ownerAudit.attachment_unavailable")}</li>
								)}
							</ul>
						) : undefined,
					after:
						renderReplies && (message.reply_count ?? 0) > 0
							? renderReplies(message)
							: undefined,
				};
			}}
		/>
	);
}

/**
 * THE AUDIT WINDOW'S END, where a reader checks whether there is more.
 *
 * A TRUNCATED HISTORY THAT READS AS A COMPLETE ONE is the failure this surface
 * exists to prevent, and it was the shape of design review round 1, D3: the
 * membership sentence was the third of four identical 12px `ink-muted` lines in
 * the header, the same size and grey as the standing disclosure, so the one line
 * saying "this list is incomplete" was indistinguishable from boilerplate. It
 * closes the message list now, at the point where a reader looks for the next
 * message and finds none, and the cut-off cases carry a `hairline` rule and the
 * reading ink (`text-sm text-ink`) so they cannot be skimmed as metadata. The
 * open-window case stays quiet (`text-meta text-ink-dim`): there is nothing cut
 * off to notice, and a complete history needs no alarm.
 *
 * The unknown case takes the CUT-OFF treatment, not the quiet one: the hub's
 * vocabulary is additive, so an unrecognised membership state means this client
 * cannot say whether the list ends where the conversation does, and the safe
 * error is to look uncertain rather than complete.
 */
function OwnerAuditWindowEnd({
	conversation,
}: { conversation: OwnerAuditConversation }) {
	useI18nLocale();
	const membership = conversation.agent.state;
	if (membership === "active") {
		return (
			<p className="mx-5 mt-4 text-meta text-ink-dim">
				{t("ui.ownerAudit.active")}
			</p>
		);
	}
	return (
		<p className="mx-5 mt-4 border-hairline border-t pt-3 text-ink text-sm">
			{membership === "left"
				? t("ui.ownerAudit.left")
				: membership === "removed"
					? t("ui.ownerAudit.removed")
					: t("ui.ownerAudit.window_unconfirmed")}
		</p>
	);
}

/**
 * The other agent owners, as the reader's language joins a list.
 *
 * `Intl.ListFormat` rather than a hand-written ", ": list punctuation is a
 * property of the locale (Chinese joins with "、", Urdu with "،"), and the
 * platform already knows it, so no locale needs a new string. Each name stays
 * its own list item (data straight from the server, never inflected); only the
 * locale's literals sit between them, hidden from assistive tech because the
 * list semantics already separate the items. The `unit` type joins without an
 * "and", which is right for a set of names rather than a sentence. The cast is
 * the ES2021 type this project's ES2020 `lib` does not declare; Chromium has
 * shipped the API since 72.
 */
type ListPart = { type: "element" | "literal"; value: string };
const listFormat = (
	Intl as unknown as {
		ListFormat?: new (
			locale: string,
			options: { style: "short"; type: "unit" },
		) => { formatToParts: (items: string[]) => ListPart[] };
	}
).ListFormat;
function OwnerAuditViewers({
	names,
	locale,
}: { names: { key: string; name: string }[]; locale: string }) {
	const parts: ListPart[] = listFormat
		? new listFormat(locale, { style: "short", type: "unit" }).formatToParts(
				names.map((entry) => entry.name),
			)
		: names.map((entry) => ({ type: "element", value: entry.name }));
	/* The literal text that precedes each name, keyed by the name's own entry so
	   no React key depends on a position. */
	const before: string[] = [];
	let pending = "";
	for (const part of parts) {
		if (part.type === "literal") pending += part.value;
		else {
			before.push(pending);
			pending = "";
		}
	}
	return (
		<ul className="inline">
			{names.map((entry, index) => (
				<li key={entry.key} className="inline">
					{index > 0 && <span aria-hidden="true">{before[index]}</span>}
					<span className="text-ink">{entry.name}</span>
				</li>
			))}
		</ul>
	);
}

export function OwnerAuditPanelView({
	conversation,
	messages,
	state,
	retry,
	hasMore = false,
	loadingMore = false,
	loadMore,
	renderReplies,
	readerAccountId,
	people = EMPTY_PEOPLE,
}: {
	conversation: OwnerAuditConversation;
	messages: OwnerAuditMessage[];
	state: ReadState;
	retry: () => void;
	hasMore?: boolean;
	loadingMore?: boolean;
	loadMore?: () => void;
	renderReplies?: (message: OwnerAuditMessage) => ReactNode;
	/**
	 * The signed-in account reading this panel, so the viewer list can name OTHER
	 * agent owners without listing the reader as an additional reader of their own
	 * audit (design review round 1, D2). Required rather than optional: with no
	 * reader the list is unanswerable, and an optional prop would let the
	 * contradiction back in silently at the next call site.
	 */
	readerAccountId: string;
	/**
	 * The tenant directory, so senders are named and pictured by the same rule a
	 * channel uses ("Aida (Ben Tran)", a photo or initial, the Bot glyph).
	 * Optional because the directory is a SEPARATE read that may still be
	 * loading or may have failed: the transcript must render either way, and
	 * then falls back to the stored labels rather than leaving names blank.
	 */
	people?: readonly TeamBridgeDirectoryMember[];
}) {
	const locale = useI18nLocale();
	/*
	 * WHO ELSE CAN READ THIS. `viewers` is the server's own answer, one entry per
	 * agent owner whose agent is (or was) in the conversation. It includes the
	 * caller, so rendering it verbatim listed the reader as a second reader:
	 * "Visible only to you" followed by "Also visible to Damian Tran" (design
	 * review round 1, D2). The reader is filtered out; the label above the names
	 * carries no placeholder, so no locale has to inflect a person's name.
	 */
	const otherViewers = (conversation.viewers ?? []).filter(
		(viewer) => viewer.account_id !== readerAccountId,
	);
	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label={t("ui.ownerAudit.title")}
		>
			{/*
			 * THE HEADER IS THE THREAD HEADER, then one quiet band. The title row
			 * is the member view's own anatomy (h-11, 15px semibold, the kind
			 * glyph), so opening a conversation through the audit does not change
			 * what a conversation looks like. Everything the audit must disclose
			 * sits in ONE band below it: the shipped `Alert` in the notice-band
			 * grammar with its border made transparent (the default-on banner's
			 * treatment), so the panel gains a tone step, never a rule. It used to
			 * be four stacked grey paragraphs and a full-size button, which read as
			 * page content rather than as the frame around it.
			 */}
			<header className="shrink-0 px-5 pb-2">
				<div className="flex h-11 items-center gap-2">
					<span className="text-ink-dim">
						<ConversationKindIcon kind={conversation.kind} />
					</span>
					<h2 className="min-w-0 flex-1 truncate font-semibold text-[15px] text-ink">
						{title(conversation)}
					</h2>
					{/* One retry per scope: while the body shows AuditFailure, the
					 * header's Refresh would be a second control for the same refetch. */}
					{state !== "error" && (
						<Button variant="ghost" size="sm" onClick={retry}>
							<RefreshCw aria-hidden="true" />
							{t("ui.ownerAudit.refresh")}
						</Button>
					)}
				</div>
				<Alert
					variant="neutral"
					icon={<Eye aria-hidden="true" />}
					className={cn(NOTICE_BAND, "items-start border-transparent")}
				>
					{/* Two sentences, one paragraph. The gap is a margin, not a typed
					 * space, so scripts that set sentences without one keep their own
					 * rhythm. */}
					<p className="text-body-sm text-ink-muted">
						<span>{t("ui.ownerAudit.read_only")}</span>
						<span className="ms-1">{t("ui.ownerAudit.disclosure")}</span>
					</p>
					{otherViewers.length > 0 && (
						/* A div, not a p: the names are a real list, and a list may
						   not sit inside a paragraph. */
						<div className="text-body-sm text-ink-muted">
							<span className="me-1">{t("ui.ownerAudit.viewers_label")}</span>
							<OwnerAuditViewers
								locale={locale}
								names={otherViewers.map((viewer, index) => ({
									key: `${viewer.account_id}:${viewer.agent_member_key}:${index}`,
									name:
										viewer.display_label || t("ui.ownerAudit.unknown_sender"),
								}))}
							/>
						</div>
					)}
				</Alert>
			</header>
			{/* No horizontal padding here: the shared list's rows carry the column's
			 * own 20px gutter (and their hover band runs edge to edge), so every
			 * other child takes the same `px-5` itself. */}
			<div className="min-h-0 flex-1 overflow-auto pb-5">
				{state === "loading" ? (
					<output className="block px-5 py-8 text-[13px] text-ink-muted">
						{t("ui.ownerAudit.loading")}
					</output>
				) : state === "error" ? (
					<div className="py-4">
						<AuditFailure retry={retry} inset="px-5" />
					</div>
				) : (
					<>
						{hasMore && (
							<div className="flex flex-wrap items-center gap-x-2 px-5 pt-3">
								<p className="text-meta text-ink-dim">
									{t("ui.ownerAudit.page_cutoff")}
								</p>
								<Button
									variant="ghost"
									size="sm"
									onClick={loadMore}
									disabled={loadingMore}
								>
									{t("ui.ownerAudit.older")}
								</Button>
							</div>
						)}
						{messages.length === 0 ? (
							<p className="px-5 py-8 text-[13px] text-ink-muted">
								{t("ui.ownerAudit.empty_history")}
							</p>
						) : (
							<AuditTranscript
								conversation={conversation}
								messages={messages}
								people={people}
								renderReplies={renderReplies}
							/>
						)}
						<OwnerAuditWindowEnd conversation={conversation} />
					</>
				)}
			</div>
		</section>
	);
}

const EMPTY_PEOPLE: readonly TeamBridgeDirectoryMember[] = [];

function AuditReplies({
	scope,
	conversation,
	root,
	people,
}: {
	scope: OwnerAuditScope;
	conversation: OwnerAuditConversation;
	root: OwnerAuditMessage;
	people: readonly TeamBridgeDirectoryMember[];
}) {
	const query = useOwnerAuditReplies(scope, conversation.id, root.id);
	if (query.isPending)
		return (
			<output className="block py-1 text-[12px] text-ink-muted">
				{t("ui.ownerAudit.loading")}
			</output>
		);
	if (readState(query) === "error")
		return <AuditFailure retry={() => void query.refetch()} />;
	return (
		<div>
			{/* The thread pane's own density: replies are the same rows, narrower. */}
			<AuditTranscript
				conversation={conversation}
				messages={ownerAuditChronology(
					query.data?.pages.map((page) => page.replies) ?? [],
				)}
				people={people}
				density="compact"
			/>
			{query.hasNextPage && (
				<Button
					variant="ghost"
					size="sm"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
				>
					{t("ui.ownerAudit.more")}
				</Button>
			)}
		</div>
	);
}

function ReplyDisclosure({
	scope,
	conversation,
	root,
	people,
}: {
	scope: OwnerAuditScope;
	conversation: OwnerAuditConversation;
	root: OwnerAuditMessage;
	people: readonly TeamBridgeDirectoryMember[];
}) {
	const [open, setOpen] = useState(false);
	return (
		<details
			className="mt-1"
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			{/* The shared row's "N replies" summary wears the accent; this is the
			 * same door, read-only, so it wears the same ink at the same size. */}
			<summary className="inline-flex min-h-[24px] w-fit cursor-pointer items-center text-[12px] text-accent">
				{t("ui.ownerAudit.replies")}
			</summary>
			{open && (
				<AuditReplies
					scope={scope}
					conversation={conversation}
					root={root}
					people={people}
				/>
			)}
		</details>
	);
}

function OwnerAuditPanel({
	scope,
	conversation,
}: { scope: OwnerAuditScope; conversation: OwnerAuditConversation }) {
	const query = useOwnerAuditMessages(scope, conversation.id);
	/* The same directory read (and cache entry) the member view uses for this
	   organization, so names usually arrive with no extra request. Its failure
	   is not this panel's failure: the transcript falls back to stored labels. */
	const directory = useTeamBridgeDirectory(
		conversation.tenant_id,
		true,
		scope.accountId,
	);
	const people = directory.data?.members ?? EMPTY_PEOPLE;
	return (
		<OwnerAuditPanelView
			conversation={conversation}
			messages={ownerAuditChronology(
				query.data?.pages.map((page) => page.messages) ?? [],
			)}
			state={readState(query)}
			retry={() => void query.refetch()}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			loadMore={() => void query.fetchNextPage()}
			renderReplies={(message) => (
				<ReplyDisclosure
					scope={scope}
					conversation={conversation}
					root={message}
					people={people}
				/>
			)}
			readerAccountId={scope.accountId}
			people={people}
		/>
	);
}

/**
 * The section's own header: what this list IS, in the rail.
 *
 * Extracted so the slot and the Storybook story render the SAME chrome. The
 * story used to compose its own heading, which meant the frames showed a
 * heading the app does not ship — invisible to every other check, and exactly
 * the kind of drift a design review catches in one glance.
 */
export function OwnerAuditSectionHeader() {
	useI18nLocale();
	return (
		<>
			<h2 className="px-3 py-2 font-medium text-meta text-ink-dim tracking-wide">
				{t("ui.ownerAudit.title")}
			</h2>
			<p className="px-3 pb-2 text-meta text-ink-dim">
				{t("ui.ownerAudit.read_only")}
			</p>
		</>
	);
}

export type OwnerAuditSlot = {
	active: boolean;
	clear: () => void;
	panel: ReactNode;
	rail: (beforeSelect: () => void) => ReactNode;
};

/** The selected audit row never enters TeamBridgeTarget or the member list.
 * Account remount + scope identity remove stale selection before a new tenant
 * can render. The caller clears human selection to suppress its read marker. */
export function useOwnerAuditSurface({
	accountId,
	enabled,
	scopeKey,
	organizations,
	onSelect,
}: {
	accountId?: string;
	enabled: boolean;
	scopeKey: string;
	organizations: { tenantId: string; name: string }[];
	onSelect: () => void;
}): OwnerAuditSlot | undefined {
	const [selection, setSelection] = useState<{
		scopeKey: string;
		conversation: OwnerAuditConversation;
	} | null>(null);
	const selected =
		selection?.scopeKey === scopeKey &&
		organizations.some(
			(org) => org.tenantId === selection.conversation.tenant_id,
		)
			? selection.conversation
			: null;
	if (!enabled || !accountId) return undefined;
	return {
		active: selected !== null,
		clear: () => setSelection(null),
		panel: selected && (
			<OwnerAuditPanel
				key={`${accountId}:${selected.tenant_id}:${selected.id}`}
				scope={{ accountId, tenantId: selected.tenant_id }}
				conversation={selected}
			/>
		),
		rail: (beforeSelect) => (
			<section className="mt-4" aria-label={t("ui.ownerAudit.title")}>
				<OwnerAuditSectionHeader />
				{organizations.map((organization) => (
					<div key={`${accountId}:${organization.tenantId}`}>
						{organizations.length > 1 && (
							<h3 className="px-3 py-1 text-xs text-ink-muted">
								{organization.name}
							</h3>
						)}
						<OwnerAuditRail
							scope={{ accountId, tenantId: organization.tenantId }}
							selectedId={
								selected?.tenant_id === organization.tenantId
									? selected.id
									: undefined
							}
							onSelect={(conversation) => {
								beforeSelect();
								onSelect();
								setSelection({ scopeKey, conversation });
							}}
						/>
					</div>
				))}
			</section>
		),
	};
}
