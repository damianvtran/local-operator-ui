/**
 * The Mesh tab's pairing state, as one bundle for `MeshPairingSection`.
 *
 * Owns the three things the read cannot carry (see `mesh-pairings.ts`): what the
 * person answered on each card, the last refusal per card, and the short-lived
 * outcomes of cards the read stopped serving. Kept out of `mesh-page.tsx` so the
 * page only passes the bundle through and the bookkeeping has one home.
 */

import { t } from "@shared/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MeshPairingSectionProps } from "./mesh-pairing-card";
import {
	MESH_PAIRING_OUTCOME_MS,
	type MeshPairingRow,
	type PairingAnswerAsk,
	type PairingAnswerRecord,
	type PairingOutcome,
	type PairingRefusal,
	foldPairingOutcomes,
	pairingRefusal,
	useFeedMeshPairing,
	useMeshPairingAnswer,
	useMeshPairingEligibility,
	useMeshPairings,
	useSecondClock,
} from "./mesh-pairings";

const EMPTY_ROWS: readonly MeshPairingRow[] = [];

export function useMeshPairingTray(
	enabled: boolean,
	/** Network ids the mesh read already shows, so a joiner's close reads as "joined". */
	joinedNetworkIds: ReadonlySet<string>,
): MeshPairingSectionProps | undefined {
	const feedId = useFeedMeshPairing(enabled);
	const read = useMeshPairings(enabled);
	const eligibility = useMeshPairingEligibility(enabled);
	const answer = useMeshPairingAnswer();
	/*
	 * A SENT HOLD (UX review U6): after an accepted answer the card keeps its
	 * in-flight look until a read that STARTED after the answer lands, so Admit /
	 * Confirm cannot re-enable with the digits still filled for the second or two
	 * before the card moves on. `at` is compared with the query's own
	 * `dataUpdatedAt`; a read that shows the card unchanged releases it too.
	 */
	const [held, setHeld] = useState<{
		id: string;
		decision: "admit" | "decline";
		at: number;
	} | null>(null);
	const answers = useRef(new Map<string, PairingAnswerRecord>());
	const previous = useRef<readonly MeshPairingRow[]>(EMPTY_ROWS);
	const joinedRef = useRef(joinedNetworkIds);
	joinedRef.current = joinedNetworkIds;
	const [outcomes, setOutcomes] = useState<PairingOutcome[]>([]);
	const [refusal, setRefusal] = useState<{
		id: string;
		refusal: PairingRefusal;
		serial: number;
	} | null>(null);
	const rows = read.data ?? EMPTY_ROWS;
	const nowSeconds = useSecondClock(
		enabled && (rows.length > 0 || outcomes.length > 0),
	);

	// A new read (data or only its timestamp) is the trigger: an unchanged list
	// still releases the sent hold.
	useEffect(() => {
		const next = read.data;
		if (!next) return;
		setHeld((current) =>
			current && read.dataUpdatedAt > current.at ? null : current,
		);
		// Captured NOW: the updater runs at the next render, after the ref below
		// has already moved on to `next` (which would fold nothing).
		const prior = previous.current;
		const joined = joinedRef.current;
		const answered = answers.current;
		setOutcomes((current) =>
			foldPairingOutcomes({
				previous: prior,
				rows: next,
				outcomes: current,
				answers: answered,
				nowMs: Date.now(),
				joinedNetworks: joined,
			}),
		);
		previous.current = next;
		// A refusal about a card that is gone is now an outcome, not an error.
		setRefusal((current) =>
			current && next.some((row) => row.id === current.id) ? current : null,
		);
	}, [read.data, read.dataUpdatedAt]);

	// Outcomes leave on the same clock the time-left lines read.
	useEffect(() => {
		setOutcomes((current) => {
			const kept = current.filter(
				(outcome) => nowSeconds * 1000 - outcome.at < MESH_PAIRING_OUTCOME_MS,
			);
			return kept.length === current.length ? current : kept;
		});
	}, [nowSeconds]);

	// A joiner whose card closed reads "finished" until the network shows up.
	const shown = useMemo(
		() =>
			outcomes.map((outcome) =>
				outcome.kind === "finished" &&
				joinedNetworkIds.has(outcome.row.networkId)
					? { ...outcome, kind: "joined" as const }
					: outcome,
			),
		[outcomes, joinedNetworkIds],
	);

	if (!enabled) return undefined;
	const onAnswer = (ask: PairingAnswerAsk) => {
		setRefusal(null);
		answer.mutate(ask, {
			onSuccess: (result) => {
				answers.current.set(ask.row.id, {
					decision: ask.decision,
					status: result.status,
				});
				setHeld({ id: ask.row.id, decision: ask.decision, at: Date.now() });
			},
			onError: (error) => {
				const mapped = pairingRefusal(error);
				// Name the button to press again (design D6).
				const refused: PairingRefusal =
					mapped.kind === "foreground"
						? {
								...mapped,
								action:
									ask.decision === "decline"
										? "decline"
										: ask.row.side === "inviter"
											? "admit"
											: "confirm",
							}
						: mapped;
				if (refused.kind === "mismatch" && refused.attemptsLeft === 0)
					answers.current.set(ask.row.id, {
						decision: ask.decision,
						status: "spent",
					});
				setRefusal({ id: ask.row.id, refusal: refused, serial: Date.now() });
			},
		});
	};
	return {
		rows,
		outcomes: shown,
		// The skeleton only when the feed already named an open card: an idle tab
		// must not flash a placeholder on every mount.
		loading: read.isPending && typeof feedId === "string",
		error: read.isError ? t("ui.mesh.pairing.error.read") : null,
		onRetry: () => void read.refetch(),
		nowSeconds,
		pending:
			answer.isPending && answer.variables
				? { id: answer.variables.row.id, decision: answer.variables.decision }
				: held
					? { id: held.id, decision: held.decision }
					: null,
		// `null` until main has said, or when it could not: unknown, answerable.
		eligibility: eligibility.data ?? null,
		refusal,
		onAnswer,
	};
}
