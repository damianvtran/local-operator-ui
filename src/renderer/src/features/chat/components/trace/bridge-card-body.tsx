import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useEffect, useState } from "react";
import { TeamBridgeMarkdown } from "../../../team-bridge/team-bridge-markdown";
import {
	type BridgeCardBody,
	type BridgeCardBodyItem,
	bridgeBodyPreview,
	bridgeCardBodyOf,
} from "./bridge-receipt-model";

/**
 * The admitted body (or the server's reason there is none) inside an inbound
 * Team Bridge card's detail pane.
 *
 * WHEN IT READS. The pane mounts only while the row is open (`Disclosure`
 * mounts content on open), so a transcript of a hundred cards makes no request
 * until a reader opens one, and each open re-reads: revocation is live (design
 * §2 C), so an answer is never cached past the open that asked for it. Two
 * mounts of the same card share one in-flight read.
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

/** Read one card's body, never throwing; `null` on any failure. */
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
			return t("ui.chat.bridgeReceipt.held");
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

/** One admitted body, folded past the collapse length. */
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
				<button
					type="button"
					className={cn(
						"self-start rounded-sm text-ink-dim text-meta underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
					)}
					aria-expanded={expanded}
					data-bridge-body-toggle=""
					onClick={() => setExpanded((open) => !open)}
				>
					{expanded
						? t("ui.chat.bridgeReceipt.show_less")
						: t("ui.chat.bridgeReceipt.show_more")}
				</button>
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
 * Closed, the section is today's sentence verbatim and nothing is requested, so
 * an older backend renders exactly as before.
 */
export const BridgeCardBodySection: FC<{
	sessionId: string | null;
	entryId: string;
	enabled: boolean;
	/** Test seam; production uses the desktop transport. */
	transport?: BridgeCardBodyTransport;
}> = memo(({ sessionId, entryId, enabled, transport }) => {
	useI18nLocale();
	const active = enabled && Boolean(sessionId) && Boolean(entryId);
	// `undefined` = still loading; `null` = the read failed or was malformed.
	const [answer, setAnswer] = useState<Read | undefined>(undefined);
	useEffect(() => {
		if (!active || !sessionId) return;
		let live = true;
		setAnswer(undefined);
		void readBridgeCardBody(sessionId, entryId, transport).then((read) => {
			if (live) setAnswer(read);
		});
		return () => {
			live = false;
		};
	}, [active, sessionId, entryId, transport]);

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
	return (
		<div className={cn("flex flex-col gap-2")} data-bridge-card-body="">
			{answer.items.map((item, index) => (
				<div
					key={item.messageId}
					className={cn(index > 0 && "border-hairline border-t pt-2")}
					data-bridge-message-id={item.messageId}
				>
					<Item item={item} />
				</div>
			))}
			{answer.more > 0 ? (
				<div className={cn("text-ink-dim text-meta")} data-bridge-body-more="">
					{t("ui.chat.bridgeReceipt.more", { count: answer.more })}
				</div>
			) : null}
		</div>
	);
});
