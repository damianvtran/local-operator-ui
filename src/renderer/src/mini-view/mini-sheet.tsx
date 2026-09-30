/**
 * The mini view's compact sheet: the model and effort pickers, in-frame.
 *
 * WHY A MINI-LOCAL PRESENTATION rather than mounting the chat's own pickers
 * (design R2's picker-fit question; integration plan §3.9). The chat's picker
 * layer is a page-level registry: every dialog reads `PickerContext`, which
 * carries a live `CanonicalSessionHandle`, a command dispatcher and the page's
 * note channel - machinery a hotkey-summoned document deliberately does not
 * mount. A compact sheet keeps the DATA paths identical to the dialogs
 * (`commands.entities` for the list, `sessions.command` for the switch, so
 * `/model typed` and `/model picked here` are one route) while owning only the
 * presentation, which is this document's to own.
 *
 * WHAT IT IS NOT: a general command surface. Three destination presses reach
 * the frame from the composer's readings strip - model, effort, context - and
 * this component serves the two that PICK. Context reads (`/context`) run
 * through the frame's note line instead, because a one-shot command has no
 * list to draw.
 *
 * KEYBOARD: arrows move, Enter picks, Esc is the FRAME's (its ladder closes
 * this sheet before it would dismiss the window); the container takes focus on
 * open so the walk needs no pointer.
 */

import { argumentRows } from "@features/chat/components/slash-argument-rows";
import type { ArgumentRow } from "@features/chat/components/slash-argument-rows";
import {
	errorText,
	isNativeAction,
	toResult,
} from "@features/chat/pickers/use-picker-backend";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { cn } from "@shared/lib/utils";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopCommandReceipt } from "../../../shared/desktop-session-contract";
import { MINI_COPY } from "./mini-copy";

/** The two lists a chip opens; the third chip (context) reads, it does not pick. */
export type MiniSheetMode = "model" | "effort";

interface MiniSheetProps {
	mode: MiniSheetMode;
	/** The seat conversation both reads and the switch address. */
	sessionId: string;
	onClose: () => void;
	/** A pick the owner accepted: the frame re-reads its snapshot. */
	onPicked: () => void;
}

/** The `commands.entities` payload's shape, as far as this sheet reads it. */
type EntitiesPayload = {
	command: string;
	entities: unknown[];
	current: unknown;
};

export function MiniSheet({
	mode,
	sessionId,
	onClose,
	onPicked,
}: MiniSheetProps) {
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	const [rows, setRows] = useState<ArgumentRow[]>([]);
	const [failure, setFailure] = useState<string | null>(null);
	const [active, setActive] = useState(0);
	const [picking, setPicking] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const title = mode === "model" ? MINI_COPY.sheetModel : MINI_COPY.sheetEffort;

	const load = useCallback(async () => {
		setPhase("loading");
		setFailure(null);
		try {
			const payload = await desktopResult<EntitiesPayload>({
				op: "commands.entities",
				sessionId,
				command: mode,
			});
			setRows(argumentRows(mode, payload.entities, payload.current));
			setActive(0);
			setPhase("ready");
		} catch (error) {
			setFailure(errorText(error));
			setPhase("error");
		}
	}, [mode, sessionId]);

	useEffect(() => {
		void load();
	}, [load]);

	/*
	 * Focus on open, and keep it here while the pointer moves: the walk is
	 * keyboard-first (the window is hotkey-summoned), so a row's press must not
	 * pull focus out of the sheet between arrows.
	 */
	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	const pick = useCallback(
		async (row: ArgumentRow) => {
			if (picking) return;
			setPicking(true);
			setFailure(null);
			try {
				const receipt = await desktopResult<DesktopCommandReceipt>({
					op: "sessions.command",
					sessionId,
					requestId: crypto.randomUUID(),
					command: mode,
					args: row.value,
				});
				/*
				 * The owner's own answer decides: a native action means the
				 * destination wanted a surface this sheet is not, and a result
				 * whose tone is `error` is the owner REFUSING - both belong in
				 * the sheet, under the list that offered the row, rather than as
				 * a silent close that leaves the chip unchanged.
				 */
				const outcome = toResult(receipt.result);
				if (isNativeAction(receipt.result) || outcome.tone === "error") {
					setFailure(outcome.text);
					setPicking(false);
					return;
				}
				onPicked();
				onClose();
			} catch (error) {
				setFailure(`${MINI_COPY.switchFailed} ${errorText(error)}`);
				setPicking(false);
			}
		},
		[mode, onClose, onPicked, picking, sessionId],
	);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActive((index) => Math.min(index + 1, rows.length - 1));
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setActive((index) => Math.max(index - 1, 0));
			} else if (event.key === "Enter") {
				event.preventDefault();
				const row = rows[active];
				if (row) void pick(row);
			}
		},
		[active, pick, rows],
	);

	/*
	 * The active row drives its own scroll into view, block: "nearest" - the
	 * list keeps its position while the walk stays visible, rather than the
	 * list jumping to centre the row.
	 */
	useEffect(() => {
		rowRefs.current[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const current = rows.find((row) => row.current);

	return (
		<div
			ref={containerRef}
			tabIndex={-1}
			// biome-ignore lint/a11y/useSemanticElements: the sheet is a listbox by keyboard contract (arrows + Enter), and a native <select> cannot carry row details, a current marker and a scroll region; the alternatives are the same div with no role at all.
			role="listbox"
			aria-label={title}
			data-tour-tag="mini-sheet"
			onKeyDown={onKeyDown}
			className="flex max-h-[320px] min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-control bg-elevated text-ink shadow-overlay outline-none"
		>
			<div className="flex h-6 shrink-0 items-center justify-between gap-2 border-b border-hairline px-3">
				<span className="text-meta text-ink-muted">{title}</span>
				<span className="min-w-0 truncate text-meta text-ink-dim">
					{phase === "ready" && current ? current.name : ""}
				</span>
			</div>
			{phase === "loading" ? (
				<p className="px-3 py-2 text-meta text-ink-dim">
					{MINI_COPY.sheetLoading}
				</p>
			) : phase === "error" ? (
				<button
					type="button"
					onClick={() => void load()}
					className="px-3 py-2 text-left text-meta text-danger"
				>
					{MINI_COPY.sheetFailed} {failure}
				</button>
			) : rows.length === 0 ? (
				<p className="px-3 py-2 text-meta text-ink-dim">
					{MINI_COPY.sheetUnavailable}
				</p>
			) : (
				/*
				 * THE LIST IS CAPPED, THE WINDOW IS NOT (design R2's sheet question). The
				 * frame grows to fit its content up to `MINI_VIEW_MAX_HEIGHT` and main clamps
				 * there, so a catalogue longer than the cap must scroll INSIDE the sheet
				 * instead of asking for a window the clamp will refuse - otherwise the rows
				 * past the ceiling are painted outside the frame, the defect this pass
				 * exists to remove. A whole number of reading rows (`max-h-64` = 256px) keeps
				 * the sheet comfortably inside the ceiling on the smallest supported display.
				 */
				<div className="max-h-64 min-h-0 flex-1 overflow-y-auto py-0.5">
					{rows.map((row, index) => (
						<button
							key={row.value}
							ref={(node) => {
								rowRefs.current[index] = node;
							}}
							type="button"
							// biome-ignore lint/a11y/useSemanticElements: a row carries name, description, detail, a current marker and the sheet's scroll region; `<option>` cannot, and a native `<select>` cannot be keyboard-driven the way this sheet's arrows/Enter contract needs.
							role="option"
							aria-selected={index === active}
							onMouseEnter={() => setActive(index)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => void pick(row)}
							className={cn(
								"flex h-7 w-full items-center gap-2 px-3 text-left text-body-sm",
								index === active ? "bg-accent-wash" : undefined,
							)}
						>
							<span className="min-w-0 flex-1 truncate">{row.name}</span>
							{row.description ? (
								<span className="shrink-0 text-meta text-ink-dim">
									{row.description}
								</span>
							) : null}
							{row.detail ? (
								<span className="shrink-0 text-meta text-ink-dim">
									{row.detail}
								</span>
							) : null}
							{row.current ? (
								<Check
									aria-hidden="true"
									className="size-3.5 shrink-0 text-accent"
								/>
							) : null}
						</button>
					))}
				</div>
			)}
			{failure !== null && phase === "ready" ? (
				<p className="shrink-0 border-t border-hairline px-3 py-1.5 text-meta text-danger">
					{failure}
				</p>
			) : null}
		</div>
	);
}
