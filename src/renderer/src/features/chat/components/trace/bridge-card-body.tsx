import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useEffect, useState } from "react";
import { TeamBridgeMarkdown } from "../../../team-bridge/team-bridge-markdown";
import {
	bridgeCardBodyIsFinal,
	bridgeCardRereadDelay,
} from "./bridge-card-reread";
import {
	type BridgeCardBody,
	type BridgeCardBodyItem,
	bridgeBodyPreview,
	bridgeCardBodyOf,
	bridgeCardFold,
} from "./bridge-receipt-model";

/**
 * The admitted body (or the server's reason there is none) inside an inbound
 * Team Bridge card's detail pane.
 *
 * WHEN IT READS. The pane mounts only while the row is open (`Disclosure`
 * mounts content on open), so a transcript of a hundred cards makes no request
 * until a reader opens one, and each open re-reads: revocation is live (design
 * §2 C), so an answer is never cached past the open that asked for it. Two
 * mounts of the same card share one in-flight read. While the pane stays open
 * and the answer can still change (pending, held, offline), it reads again on
 * the backoff in `bridge-card-reread.ts`, so a body handed off minutes or hours
 * later appears without closing and reopening the card.
 *
 * WHAT IT NEVER DOES. It never derives a moderation outcome (design §2 D): every
 * sentence comes from the server's closed `state`/`reason` vocabulary, and a
 * failure to read is "unavailable", not "held" or "refused". The body is
 * untrusted markdown authored by someone else; it renders through
 * `TeamBridgeMarkdown` (images inert as text, raw HTML inert, links external
 * only) under the card's untrusted-provenance label, never as app copy.
 */

/** One read's outcome: a parsed answer, or `null` for any failure. */
type Read = BridgeCardBody | null;

const inflight = new Map<string, Promise<Read>>();

/** The default transport: the app's desktop door. Injectable for tests. */
export type BridgeCardBodyTransport = (input: {
	sessionId: string;
	entryId: string;
}) => Promise<unknown>;

const desktopTransport: BridgeCardBodyTransport = async ({
	sessionId,
	entryId,
}) => {
	const response = await desktopRequest({
		op: "sessions.bridgeCardBody",
		sessionId,
		entryId,
	});
	// A refusal (404 from a server that lost the route, 401, 5xx) is not an
	// answer; the caller turns `null` into the generic unavailable sentence.
	if (
		response.status === null ||
		response.status < 200 ||
		response.status >= 300
	)
		return null;
	return response.body;
};

/**
 * Read one card's body, never throwing; `null` on any failure.
 *
 * Concurrent callers for one card share the request in flight; the entry is
 * dropped as soon as it settles, so the next scheduled re-read always issues a
 * NEW request rather than replaying an old answer.
 */
export function readBridgeCardBody(
	sessionId: string,
	entryId: string,
	transport: BridgeCardBodyTransport = desktopTransport,
): Promise<Read> {
	const key = `${sessionId}\u0000${entryId}`;
	const running = inflight.get(key);
	if (running) return running;
	const promise = transport({ sessionId, entryId })
		.then(bridgeCardBodyOf, () => null)
		.finally(() => inflight.delete(key));
	inflight.set(key, promise);
	return promise;
}

/** The sentence for an item that carries no body. */
function stateSentence(item: BridgeCardBodyItem): string {
	switch (item.state) {
		case "pending":
			return t("ui.chat.bridgeReceipt.pending");
		case "held":
			// A transient hold (screening not run / delivery unfinished) is not a
			// moderation decision; same ruling as the TUI (core #4238 D3/R4).
			return item.transient
				? t("ui.chat.bridgeReceipt.held_transient")
				: t("ui.chat.bridgeReceipt.held");
		case "refused":
			return t("ui.chat.bridgeReceipt.refused");
		case "not_admitted":
			return t("ui.chat.bridgeReceipt.not_admitted");
		default:
			switch (item.reason) {
				case "signed_out":
					return t("ui.chat.bridgeReceipt.unavailable_reason.signed_out");
				case "other_account":
					return t("ui.chat.bridgeReceipt.unavailable_reason.other_account");
				case "not_member":
					return t("ui.chat.bridgeReceipt.unavailable_reason.not_member");
				case "deleted":
					return t("ui.chat.bridgeReceipt.unavailable_reason.deleted");
				case "hub_unsupported":
					return t("ui.chat.bridgeReceipt.unavailable_reason.hub_unsupported");
				case "offline":
					return t("ui.chat.bridgeReceipt.unavailable_reason.offline");
				default:
					return t("ui.chat.bridgeReceipt.unavailable");
			}
	}
}

/**
 * The timer the re-read schedule runs on. Injectable so tests drive the backoff
 * with a fake clock instead of waiting real minutes.
 */
export type BridgeCardRereadClock = {
	setTimeout: (run: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
};

const realClock: BridgeCardRereadClock = {
	setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
	clearTimeout: (handle) =>
		globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The muted outcome line, in `BridgeDetail`'s own outcome idiom. */
const Outcome: FC<{ text: string; state: string }> = ({ text, state }) => (
	<div
		className={cn("whitespace-normal text-ink-muted")}
		data-detail-section="bridge-outcome"
		data-bridge-body-state={state}
	>
		{text}
	</div>
);

/**
 * The "Show more" / "Show less" control shared by a body's fold and the card's.
 *
 * Accent ink (#1977 design round 1, D5): in the meta grey it read as a caption
 * like the provenance label around it until hovered; the TUI draws this
 * affordance in `accent` too. `data-*` attributes are passed through so the
 * two folds stay separately addressable.
 */
const FoldToggle: FC<{
	expanded: boolean;
	onToggle: () => void;
	marker: Record<string, string>;
}> = ({ expanded, onToggle, marker }) => (
	<button
		type="button"
		className={cn(
			"self-start rounded-sm text-accent text-meta underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-accent-hover hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
		)}
		aria-expanded={expanded}
		{...marker}
		onClick={onToggle}
	>
		{expanded
			? t("ui.chat.bridgeReceipt.show_less")
			: t("ui.chat.bridgeReceipt.show_more")}
	</button>
);

/** One admitted body, folded past the collapse length or line count. */
const AdmittedBody: FC<{ body: string }> = ({ body }) => {
	const [expanded, setExpanded] = useState(false);
	const preview = bridgeBodyPreview(body);
	const shown = expanded || !preview.truncated ? body : preview.text;
	return (
		<div
			className={cn("flex flex-col gap-1")}
			data-bridge-body-state="admitted"
		>
			<div
				/*
				 * No height cap here, unlike the pane's other sections: the fold is
				 * the "Show more" cut, and a reader who pressed it asked for the
				 * whole message. Capping it as well would hand them a second,
				 * nested scroll box clipped mid-line. Bodies are bounded at the
				 * source (core keeps at most 16 KiB per body). Wide tables and code
				 * still scroll sideways inside their own box.
				 */
				className={cn("overflow-x-auto text-ink")}
				data-detail-section="bridge-body"
			>
				<TeamBridgeMarkdown>{shown}</TeamBridgeMarkdown>
			</div>
			{preview.truncated ? (
				<FoldToggle
					expanded={expanded}
					onToggle={() => setExpanded((open) => !open)}
					marker={{ "data-bridge-body-toggle": "" }}
				/>
			) : null}
		</div>
	);
};

const Item: FC<{ item: BridgeCardBodyItem }> = ({ item }) =>
	item.state === "admitted" && item.body ? (
		<AdmittedBody body={item.body} />
	) : (
		<Outcome text={stateSentence(item)} state={item.state} />
	);

/**
 * The card's body section.
 *
 * `enabled` is the capability gate (`features.team_bridge_card_body`) plus the
 * conditions under which this app can ask at all (a local, top-level session).
 * Closed, the section is today's sentence and nothing is requested. The
 * transcript row does not mount this section at all when the read is not
 * offered: it keeps the sentence in `BridgeDetail`'s outcome slot, above the
 * provenance line, so an older backend's pane is unchanged (review R3). The
 * closed branch here is the defensive fallback for any other caller.
 *
 * WHY THE READ STAYS ON OPEN (core #4238 design D1 analog). The TUI resolves
 * cards on mount because its collapsed header used to say "no preview"; core
 * gave it a `local_only` resolver for that. The desktop route has no local-only
 * mode (every call is the full resolver, which can make a hub history read),
 * and the collapsed desktop row never said "unavailable" — it reads
 * `Received from <sender> · <conversation>`, which stays true. Reading on
 * mount would buy no truer collapsed row and cost one hub read per visible
 * card, so the read stays on open.
 */
export const BridgeCardBodySection: FC<{
	sessionId: string | null;
	entryId: string;
	enabled: boolean;
	/** Test seam; production uses the desktop transport. */
	transport?: BridgeCardBodyTransport;
	/** Test seam; production uses the real timers. */
	clock?: BridgeCardRereadClock;
}> = memo(({ sessionId, entryId, enabled, transport, clock = realClock }) => {
	useI18nLocale();
	const active = enabled && Boolean(sessionId) && Boolean(entryId);
	// `undefined` = still loading; `null` = the read failed or was malformed.
	const [answer, setAnswer] = useState<Read | undefined>(undefined);
	// The card-level fold (D2). Resets with each open, like the body itself;
	// a re-read while open keeps it, so a reader's "Show more" is not undone.
	const [cardExpanded, setCardExpanded] = useState(false);
	useEffect(() => {
		if (!active || !sessionId) return;
		// `live` ends the schedule on close/unmount or when the entry changes: a
		// read still in flight then lands nowhere and schedules nothing.
		let live = true;
		let attempt = 0;
		let timer: unknown = null;
		let reading = false;
		let settled = false;
		// Only the first read of an open shows "Loading…". A re-read keeps the
		// last answer on screen until the new one lands, so a pending pane never
		// flashes back to loading every few seconds.
		setAnswer(undefined);
		setCardExpanded(false);
		const read = () => {
			timer = null;
			reading = true;
			void readBridgeCardBody(sessionId, entryId, transport).then((next) => {
				reading = false;
				if (!live) return;
				setAnswer(next);
				if (bridgeCardBodyIsFinal(next)) {
					settled = true;
					return;
				}
				timer = clock.setTimeout(read, bridgeCardRereadDelay(attempt));
				attempt += 1;
			});
		};
		// Coming back to the window is when a reader looks again, so a waiting
		// pane asks at once instead of on its next tick (which may be a minute
		// away). The backoff position is kept: regaining focus is not progress.
		const regain = () => {
			if (!live || settled || reading) return;
			if (document.hidden) return;
			if (timer !== null) clock.clearTimeout(timer);
			read();
		};
		window.addEventListener("focus", regain);
		document.addEventListener("visibilitychange", regain);
		read();
		return () => {
			live = false;
			if (timer !== null) clock.clearTimeout(timer);
			window.removeEventListener("focus", regain);
			document.removeEventListener("visibilitychange", regain);
		};
	}, [active, sessionId, entryId, transport, clock]);

	if (!active)
		return (
			<Outcome text={t("ui.chat.bridgeReceipt.unavailable")} state="legacy" />
		);
	if (answer === undefined)
		return (
			<div
				className={cn("text-ink-dim")}
				data-bridge-body-state="loading"
				aria-busy="true"
			>
				{t("ui.chat.bridgeReceipt.loading")}
			</div>
		);
	if (answer === null || answer.items.length === 0)
		return (
			<Outcome
				text={t("ui.chat.bridgeReceipt.unavailable")}
				state="unavailable"
			/>
		);
	const fold = bridgeCardFold(answer.items);
	const listed = cardExpanded ? answer.items : fold.shown;
	return (
		<div className={cn("flex flex-col gap-2")} data-bridge-card-body="">
			{listed.map((item, index) => (
				<div
					key={item.messageId}
					className={cn(index > 0 && "border-hairline border-t pt-2")}
					data-bridge-message-id={item.messageId}
				>
					<Item item={item} />
				</div>
			))}
			{/*
			 * "And N more messages" counts what follows the WHOLE listed run, so
			 * it is shown only while that run is visible: under the folded card it
			 * would read as the count of everything not shown and undercount it.
			 */}
			{answer.more > 0 && (cardExpanded || fold.hidden === 0) ? (
				<div className={cn("text-ink-dim text-meta")} data-bridge-body-more="">
					{t("ui.chat.bridgeReceipt.more", { count: answer.more })}
				</div>
			) : null}
			{fold.hidden > 0 ? (
				<FoldToggle
					expanded={cardExpanded}
					onToggle={() => setCardExpanded((open) => !open)}
					marker={{ "data-bridge-card-toggle": "" }}
				/>
			) : null}
		</div>
	);
});
