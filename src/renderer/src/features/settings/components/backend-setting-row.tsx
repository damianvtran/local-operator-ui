/**
 * One registry setting, as one line of a table.
 *
 * The surface this replaces gave every row a two-line block with a full-width
 * control under it, ~77px tall, and then stated the row's scope a third time
 * (`Changed from the default; takes effect immediately`) under the control. At
 * 99 rows that measured 10,896px of region with 29 such sentences on a
 * configured install. What is here instead:
 *
 * - the LABEL left, one step up in ink; the row's registry `help` under it on a
 *   core row, or behind the row's OWN reveal on an advanced row (always-on help
 *   costs ~6,800px across 99 rows, and an advanced row is by definition one the
 *   reader asked for);
 * - the CONTROL right, in a slot sized by `kind` (see `setting-control.tsx`);
 * - the CHANGED state as a state: a dot plus `Use default`, appearing only when
 *   the row is off its default, never as a sentence;
 * - a `warning` clause ALWAYS visible, in danger ink, outside the help text and
 *   never behind a disclosure — a consequence is not detail;
 * - a gated child disabled and EXPLAINED while its gate is off;
 * - a redacted or retired row that keeps its wrapper, its label and its
 *   `data-setting-key`. It used to return early without any of the three, which
 *   left four keys unidentifiable ("Retired" read as three bare numbers),
 *   unanchored by any deep link and unreachable by the one focus path that
 *   exists.
 *
 * Nothing saves on blur, and a failed save keeps the draft: the draft lives in
 * the SECTION now (so that collapsing a section cannot discard an edit, and so
 * that `n unsaved changes` can count what it holds), and this row is a
 * controlled view over it.
 *
 * The row keys on its own COLUMN, not on the window: at a 1000px window the
 * settings column is 660px once the page's own rail sits beside it (an earlier
 * draft of the spec quoted 888px for that window, and the QA round measured the
 * column instead — the conclusion is unaffected, because the failure mode is a
 * column measurement and never a window one), so a window-width breakpoint would
 * never fire where it is needed, and the row stacks (label, then control) only
 * when the column itself is too narrow for both.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import { Alert, Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { RotateCcw, Undo2 } from "lucide-react";
import type { FC } from "react";
import type { SettingTier } from "../backend-settings-tiers";
import {
	type SettingDraft,
	isDraftDirty,
	serialize,
} from "./backend-settings-drafts";
import { SettingControl, controlSlot } from "./setting-control";
import { ChangedDot } from "./settings-group-header";

/**
 * The chevron column, reserved on a row that has nothing to reveal.
 *
 * A core row shows its help inline and has no disclosure, but its label still
 * starts on the same rail as an advanced row's — one 14px gutter plus the 6px
 * gap `Disclosure`'s own row uses. Without it the list would show two label
 * columns and read as two lists.
 */
const CHEVRON_GUTTER = "size-3.5 shrink-0";

export type SettingGate = {
	/** The key that must be on for this row to be editable. */
	key: string;
	/** That key's label, so the sentence names a control the reader can see. */
	label: string;
	/** Whether the gate is currently on. */
	on: boolean;
};

export type BackendSettingRowProps = {
	setting: BackendSetting;
	draft: SettingDraft;
	tier: SettingTier;
	/** The row's gate, when the wire says one exists. */
	gate?: SettingGate | null;
	saving: boolean;
	/** The sentence from the last failed save, shown beside the row it is about. */
	error: string | null;
	onDraftChange: (draft: SettingDraft) => void;
	onSave: () => void;
	onReset: () => void;
};

export const BackendSettingRow: FC<BackendSettingRowProps> = ({
	setting,
	draft,
	tier,
	gate,
	saving,
	error,
	onDraftChange,
	onSave,
	onReset,
}) => {
	const gatedOff = Boolean(gate && !gate.on);
	const dirty = isDraftDirty(setting, draft);
	const disabled = saving || gatedOff;
	/** The kinds whose control is a multi-line editor rather than a field. */
	const wideControl = setting.kind === "list" || setting.kind === "cascade";

	/**
	 * The label, plus the marks that belong beside it.
	 *
	 * The warning is HERE rather than inside the disclosed help on purpose: help
	 * is detail a reader may skip, a warning is a consequence they may not.
	 *
	 * It takes its OWN LINE under the label rather than sitting beside it, and
	 * that is a fix rather than a preference: in one flex row the warning was the
	 * `shrink-0` member and the label was the `truncate` one, so the label was the
	 * thing that gave way — the registry's one warning row rendered as `host …`,
	 * its identity destroyed by its own warning, on the row a reader reached BY
	 * SEARCHING FOR IT (design round 1, D2; UX round 1, U9). A warning may cost the
	 * row a line; it may not cost the row its name.
	 */
	const marks = (
		<span className="flex min-w-0 flex-col gap-0.5">
			<span className="truncate text-body-sm text-ink">{setting.label}</span>
			{setting.kind === "readonly" && (
				// Why this value has no control, said in the row rather than only
				// behind its reveal: a value a reader cannot edit and cannot
				// immediately explain reads as broken (UX round 1, U10). Plain
				// text, not a badge — a state, like the changed dot beside it.
				<span className="text-meta text-ink-dim">Read-only</span>
			)}
			{setting.warning && (
				<span className="text-meta text-danger">{setting.warning}</span>
			)}
		</span>
	);

	/**
	 * Why this row cannot be edited, in the row's own words.
	 *
	 * It names the SWITCH rather than saying "disabled" — the reader's next
	 * question is always which control to turn on, and the answer is one line
	 * above or below in the same section.
	 */
	const gateNote = gatedOff && gate && (
		<p className="text-meta text-ink-dim">
			Needs {gate.label} on. Nothing here is saved while it is off.
		</p>
	);

	return (
		/*
		 * TWO ELEMENTS, because the ROW is what wraps and the outer div is the
		 * identity every anchor and test reaches for (and the boundary the table's
		 * hairlines are drawn on).
		 *
		 * The fallback is a WRAP rather than a breakpoint, and that is a measured
		 * decision rather than a preference: a row's two columns need
		 * `label + gap + control` of width, the control's size comes from its KIND
		 * (a switch is 36px, a text field 384px), so one breakpoint cannot be right
		 * for both. At a 620px window the story's column is 572px, which cleared a
		 * 560px breakpoint and left a `text` row with a 140px label — every word of
		 * its help wrapped, and the label itself truncated to `D…` (the `narrow`
		 * frame is what caught it). `min-w-44` on the label column instead makes the
		 * CONTROL give way: a row that cannot fit both columns puts its control on
		 * the next line, at the column's left edge, which is the same shape the
		 * spec asks for below ~560px — reached by content rather than by a number.
		 */
		<div
			data-setting-key={setting.key}
			data-tier={tier}
			className="border-b border-hairline"
		>
			<div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-1 py-2.5">
				<div
					className={cn(
						"flex min-w-44 flex-col gap-0.5",
						/*
						 * A multi-line editor is the one kind that gets the row's WIDTH
						 * as well as its own line: a list of host slugs or a failover
						 * chain is unreadable in a 200px box that wraps each entry three
						 * times, and the column it needs comes from the label's share
						 * rather than from a wider slot. Everything else keeps the label
						 * as the flexible column and the control at its kind's size.
						 */
						wideControl ? "shrink-0 basis-2/5" : "flex-1",
					)}
				>
					{tier === "advanced" && setting.help ? (
						// The row's own reveal. The shared primitive, because "one
						// disclosure idiom app-wide" is a rule with a reason: this
						// surface once had three.
						<Disclosure
							summary={marks}
							triggerClassName="min-h-5 py-0 px-0 text-body-sm text-ink hover:text-ink"
							/*
							 * The caret is the row's ONLY affordance, and the primitive paints the
							 * chevron slot `ink-disabled` — the role reserved for controls that do
							 * not respond — which measured 2.70:1 dark / 2.80:1 light against the
							 * 3:1 non-text floor this repo applies to a mark that carries state
							 * (design round 1, D1). `ink-dim` is 5.81:1 / 5.31:1 and matches the
							 * help text it reveals.
							 *
							 * `firstLine` because a row's mark belongs on the label's line, and a
							 * warning now makes that summary two lines tall.
							 */
							chevronClassName="text-ink-dim"
							summaryAlign="firstLine"
							rowClassName="min-h-5 py-0"
							className="w-full"
						>
							<span className="text-meta text-ink-dim">{setting.help}</span>
						</Disclosure>
					) : (
						<span className="flex min-h-5 items-center gap-1.5">
							<span aria-hidden={true} className={CHEVRON_GUTTER} />
							{marks}
						</span>
					)}
					{tier === "core" && setting.help && (
						// Aligned under the label rather than under the gutter: it is
						// the sentence that belongs to that label.
						<p className="ml-5 text-meta text-ink-dim">{setting.help}</p>
					)}
					{gateNote}
				</div>

				<div
					className={cn(
						// `self-center` against a two-line label, and no effect at all
						// on a line the control has to itself.
						"flex shrink-0 items-center gap-2 self-center",
						wideControl && "min-w-0 flex-1 items-start",
					)}
				>
					{/* Off the default: a dot and the way back. Both are on screen only
					    while they are true, which is what makes them readable as a state
					    instead of as chrome.

					    A `readonly` row is excluded from the RESET, because the request it
					    would send is one the registry refuses: `settings_io.reset_setting`
					    raises for `Kind.READONLY` and the route maps that to HTTP 422
					    ("this setting is retired and cannot be changed"), so the row offered
					    a control that could only fail and a `Retry` that re-issued the same
					    doomed request (review round 1, M2). It is reachable: `is_default`
					    is a value comparison, and the desktop app's own General sliders
					    write `conversation_length`, `detail_length` and
					    `max_learnings_history`. The DOT stays — the row genuinely is off
					    its default. */}
					{(!setting.is_default || dirty) && <ChangedDot />}
					{!setting.is_default && setting.kind !== "readonly" && (
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							onClick={onReset}
							/* Eight of these render identically in one tab order, so each
							   names the row it belongs to (UX round 1, U8). */
							aria-label={`Use default for ${setting.label}`}
						>
							<Undo2 aria-hidden="true" />
							Use default
						</Button>
					)}
					{dirty && (
						<Button
							variant="primary"
							size="sm"
							disabled={disabled}
							onClick={onSave}
						>
							{saving ? "Saving" : "Save"}
						</Button>
					)}
					{/*
					 * `data-setting-control` is the seam the section's deep-link reveal focuses
					 * through. Without it the reveal's selector matched the row's `Use default`
					 * button first — it precedes the control in document order — so an
					 * off-default row was focused on its reset button instead of its field
					 * (review round 1, n4).
					 */}
					<div className={controlSlot(setting.kind)} data-setting-control="">
						{setting.redacted ? (
							// The value is withheld, not the row: a reader who searched
							// for this key has to be able to see that it exists and why
							// it cannot be edited here.
							<span className="text-meta text-ink-dim">
								Set in the credential manager: this value carries inline
								credentials or query parameters.
							</span>
						) : setting.kind === "readonly" ? (
							<span className="text-body-sm text-ink-muted">
								{serialize(setting.value) || "Not set"}
							</span>
						) : (
							<SettingControl
								setting={setting}
								value={draft.value}
								chains={draft.cascadeBase ?? undefined}
								disabled={disabled}
								onValueChange={(value) => onDraftChange({ ...draft, value })}
								onChainsChange={(chains) =>
									onDraftChange({ ...draft, cascadeBase: chains })
								}
							/>
						)}
					</div>
				</div>

				{error && (
					// `role="alert"` because this appears in response to an ACTION: the
					// Alert primitive documents that it does not set it itself, since a
					// callout that was on the page all along must not interrupt a screen
					// reader and a failed save must.
					<Alert variant="danger" role="alert" className="w-full">
						<div className="flex items-center justify-between gap-3">
							<span>{error}</span>
							{/* Retry re-submits the RETAINED draft; it never re-reads the
						    field, so what a reader retries is what they typed. */}
							<Button
								variant="secondary"
								size="sm"
								disabled={saving}
								onClick={onSave}
							>
								<RotateCcw aria-hidden="true" />
								Retry
							</Button>
						</div>
					</Alert>
				)}
			</div>
		</div>
	);
};
