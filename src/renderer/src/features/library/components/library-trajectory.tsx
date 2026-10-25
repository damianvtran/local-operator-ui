/**
 * The asset's conversation, below the asset.
 *
 * WHY IT EXISTS (operator): asking about a Library asset used to throw the
 * reader into `/chat`, losing the file they were asking about. The asset must
 * stay the subject, so its conversation is painted here — clipped, bounded, and
 * live — and the composer under it continues the SAME conversation.
 *
 * THE RENDERER IS THE CHAT PAGE'S, NOT A SECOND GRAMMAR. `CanonicalTranscript`
 * already owns collapsing, folding, stream ordering and lazy paging; re-sorting
 * or re-windowing its records here would be the two rails `branding.md` §7
 * forbids. This component's whole job is the subscription and the handful of
 * facts the transcript cannot read for itself, so the props below are the chat
 * page's (`chat-content.tsx`) minus the ones a second live consumer has no
 * standing to supply — the run-details child reader is the precedent for a
 * surface that mounts it outside the chat route.
 *
 * WHAT IT DELIBERATELY DOES NOT SUPPLY (v1), and why:
 *
 * - `starting`/`startingAfterId`/`startingSession`/`startingSince` are
 *   `false`/`null`. Those name a send THIS app admitted through the canonical
 *   store; this surface's send goes through the plain `sessions.message` route
 *   (see `library-composer.tsx`), so there is no admission latch to describe.
 *   The user's row still appears, delivered by the stream.
 * - The question dock is NOT mounted. Answering a gate needs the chat page's
 *   answer machinery (its send lock, owner-epoch check, refusal classification
 *   and retry), and a second copy of that here is exactly the "meaningful new
 *   answer machinery" this slice refuses. A pending question is stated in the
 *   header as one honest line with an Open-chat control, which answers it where
 *   the answering surface already lives. A read-only dock was rejected: a card
 *   whose options cannot be pressed says the wrong thing.
 * - `isSmallView` is false. That prop exists for a chat column squeezed by a
 *   pane BESIDE it; this IS the pane (the dock is 448px, the expanded view is
 *   wider), and the transcript's bottom-pinned scroller is what opens a long
 *   conversation at its newest row.
 */

import { effectiveGate } from "@features/chat/ask-queue";
import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ChevronDown, Link2, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef } from "react";

export type LibraryTrajectoryProps = {
	sessionId: string;
	/** The linked conversation's own title. */
	title: string;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	/** Leave for `/chat` — the explicit press, never an automatic jump. */
	onOpenChat: () => void;
	onUnlink: () => void;
	/**
	 * Called when a turn that was streaming settles. The preview uses it to bump
	 * the file-freshness tick: the agent usually wrote the asset it was asked
	 * about, so the settle is the moment worth re-probing the path.
	 */
	onTurnSettled: () => void;
	/**
	 * The live `streaming` reading, on every edge. The preview hands it to the
	 * composer so a send typed mid-turn chooses `steer` — and it is a callback
	 * rather than the composer's own snapshot because the snapshot is a one-shot
	 * read: it cannot know a turn started after this panel mounted.
	 */
	onStreamingChange: (streaming: boolean) => void;
};

export const LibraryTrajectory: FC<LibraryTrajectoryProps> = ({
	sessionId,
	title,
	collapsed,
	onToggleCollapsed,
	onOpenChat,
	onUnlink,
	onTurnSettled,
	onStreamingChange,
}) => {
	useI18nLocale();
	const capabilities = useDesktopCapabilities();
	/*
	 * The chat pane's own subscription, with the same feature negotiation it
	 * passes: a fail-closed `false` keeps today's wire shape until the backend
	 * advertises the capability, exactly as the chat page does.
	 */
	const canonical = useCanonicalSessionStream(
		sessionId,
		true,
		true,
		sessionId,
		{
			openFrame: desktopFeatureEnabled(capabilities.data, "open_frame"),
			journalOrder: desktopFeatureEnabled(capabilities.data, "journal_order"),
			peerJournalSource: desktopFeatureEnabled(
				capabilities.data,
				"peer_journal_source",
			),
		},
	);
	const containerRef = useRef<HTMLDivElement>(null);
	/*
	 * THE TURN PAIR, read through the hold the way the chat page reads it
	 * (`frontend ?? heldFrontend`): a reconnect answers with a null `frontend`
	 * for a moment, and a bare read would blank the working line and call the
	 * turn settled - which would re-probe the file mid-turn and report the
	 * agent's own half-written file as an external change.
	 */
	const frontend = canonical.frontend ?? canonical.heldFrontend;
	const streaming = frontend?.streaming === true;
	/*
	 * THE SAME DERIVATION THE CHAT PAGE USES, not the raw field: a frame whose
	 * ask mirror is suppressed must not present a question this surface has no
	 * way to answer, and the one consumer of the gate must read the one answer.
	 * Read through the hold for the same reason `streaming` is.
	 */
	const gate = effectiveGate(canonical.frontend ?? canonical.heldFrontend);
	const previousStreaming = useRef(streaming);
	useEffect(() => {
		if (previousStreaming.current !== streaming) {
			onStreamingChange(streaming);
			if (!streaming) onTurnSettled();
		}
		previousStreaming.current = streaming;
	}, [streaming, onTurnSettled, onStreamingChange]);

	/*
	 * Before the first snapshot there are no rows to draw and no end claim to
	 * make: the shared `Spinner` (the app's one loading affordance) holds the
	 * well rather than a bespoke skeleton. Once the stream is answering, the
	 * transcript owns both the empty state and the working line.
	 */
	const firstSnapshotPending =
		canonical.transcript.records.length === 0 &&
		canonical.awaitingHydration &&
		!canonical.missing;

	return (
		<section
			data-library-trajectory=""
			data-collapsed={collapsed ? "" : undefined}
			className={cn(
				"flex min-h-0 flex-col bg-sunken",
				/*
				 * BOUNDED, AND NEVER THE VIEWER'S AIR: 38% by default, capped at
				 * 20rem so a wide window does not grow a second reading column,
				 * floored at 10rem so the well always has a row or two. Collapsed,
				 * it keeps its header row and gives the whole panel back to the
				 * viewer.
				 */
				collapsed ? "shrink-0" : "min-h-40 max-h-80 shrink-0 basis-[38%]",
			)}
		>
			<header className="flex shrink-0 items-center gap-2 px-4 py-1.5">
				<Link2 size={13} aria-hidden="true" className="text-ink-dim" />
				{/*
				 * THE HEADER IS THE TOGGLE. It carries the conversation's own name as
				 * its accessible name, so the control needs no icon-label copy of its
				 * own; the chevron is decoration on the same press. `aria-expanded`
				 * states the state, which is what a disclosure control owes.
				 */}
				<button
					type="button"
					aria-expanded={!collapsed}
					onClick={onToggleCollapsed}
					className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-start text-meta text-ink-muted hover:text-ink focus-visible:outline-offset-1"
				>
					<span className="min-w-0 flex-1 truncate">
						{t("ui.library.composer.chat_about", { title })}
					</span>
					<ChevronDown
						aria-hidden="true"
						className={cn(
							"size-3.5 shrink-0 transition-transform duration-fast",
							collapsed && "rotate-180",
						)}
					/>
				</button>
				<Button variant="ghost" size="sm" onClick={onOpenChat}>
					{t("ui.library.composer.open_chat")}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.library.composer.unlink")}
					onClick={onUnlink}
				>
					<X aria-hidden="true" />
				</Button>
			</header>
			{!collapsed && gate && (
				/*
				 * ONE HONEST LINE, IN THE DOCK POSITION THE CHAT PAGE USES. The
				 * question is not answerable here (see the header note), and a card
				 * of disabled options would present it as one that is. The press
				 * goes to the surface that can answer it.
				 */
				<div
					data-library-trajectory-gate=""
					className="flex shrink-0 items-center gap-2 px-4 pb-1.5"
				>
					<span className="min-w-0 flex-1 text-meta text-ink">
						{t("ui.mesh.mesh_approvals.waiting_for_you")}
					</span>
					<Button variant="secondary" size="sm" onClick={onOpenChat}>
						{t("ui.library.composer.open_chat")}
					</Button>
				</div>
			)}
			{!collapsed && (
				<div
					data-lo-sidebar-edge-cues
					className="flex min-h-0 grow flex-col overflow-hidden"
				>
					{firstSnapshotPending ? (
						<div className="flex flex-1 items-center justify-center">
							<Spinner label={t("ui.library.preview.loading")} />
						</div>
					) : (
						<CanonicalTranscript
							frontend={canonical.frontend}
							transcript={canonical.transcript}
							gate={gate}
							waiting={streaming}
							starting={false}
							loadingOlder={canonical.loadingOlder}
							onLoadOlder={canonical.loadOlder}
							onLoadOlderOutcome={canonical.loadOlderDetailed}
							olderFailed={canonical.olderFailed}
							containerRef={containerRef}
							isSmallView={false}
							status={canonical.status}
							failure={canonical.failure}
							awaitingHydration={canonical.awaitingHydration}
							hydrationProven={canonical.hydrated}
							/*
							 * A stale/missing conversation paints the transcript's OWN
							 * missing and failure states rather than a blank well: the
							 * asset outlives a session that was deleted elsewhere.
							 */
							missing={canonical.missing}
							/* The failure notice's own action: the same `retry` the chat page's
							 * notice presses, so a transport failure here is recoverable in place. */
							onReconnect={canonical.retry}
						/>
					)}
				</div>
			)}
		</section>
	);
};
