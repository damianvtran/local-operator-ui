/**
 * The Keyboard shortcuts group (issue #928): one row per registry action, each
 * recording and clearing its own chord.
 *
 * WHY A SECTION AND NOT A ROW IN THE BACKEND REGISTRY. These bindings are
 * RENDERER-LOCAL (see `ui-preferences-store.shortcutBindings` for the whole
 * argument: the backend's `keymap.*` rows cannot carry a UI action without a
 * backend release), so they are not rows of the `/v1/settings` projection the
 * Backend section renders — a second editor for one wire is exactly what
 * `speech-section` argues against, and here the wire itself does not exist. The
 * section IS the single editor of this store field.
 *
 * THE ROW'S STATES, as the round's contract states them: assigned (default or
 * override; an override also shows Reset), recording (the field has focus — the
 * hint appears with it), refused/conflict (the previous value is KEPT and the
 * sentence is shown under the field), and unset (`No shortcut`). Every state is
 * reachable by keyboard alone: the field is Tab-reachable, Escape/Enter end the
 * edit, and Reset is a real button.
 *
 * WHAT IS DELIBERATELY INERT: paste. The field is `readOnly`, so a pasted
 * string is neither a chord this runtime could replay nor a keystroke the
 * reader made — a pasted value that "took" would be a binding nobody pressed.
 *
 * THE REFUSAL SENTENCES COME FROM `captureRefusal` (reserved, taken, needs a
 * modifier, not a bindable key), so the recorder and the store's write boundary
 * refuse the same set in the same words — the field only decides WHEN to ask.
 */

import { Button, Input, Label } from "@shared/components/ui";
import {
	END_EDIT_KEYS,
	MODIFIER_ONLY_KEYS,
	chordFromEvent,
} from "@shared/keymap/chord-capture";
import {
	captureRefusal,
	chordGlyph,
	effectiveChord,
} from "@shared/keymap/keymap-chord";
import {
	KEYMAP_ACTIONS,
	type KeymapAction,
} from "@shared/keymap/keymap-registry";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Keyboard } from "lucide-react";
import type { FC, RefObject } from "react";
import { useId, useMemo, useState } from "react";
import { rendererPlatform } from "../../../mini-view/renderer-platform";
import { SettingsSection } from "./settings-section";

/**
 * The row label: the action's own name with the verb dropped.
 *
 * "Open console" is the sentence a trigger's tooltip needs; the settings list's
 * field already says what pressing the chord does, so the list reads the panel
 * names ("Console", "Canvas") without a second copy of them — the registry
 * stays the one place either spelling comes from.
 */
const rowLabel = (action: KeymapAction): string => {
	const noun = action.label.replace(/^Open\s+/, "");
	return noun.charAt(0).toUpperCase() + noun.slice(1);
};

const ShortcutRow: FC<{ action: KeymapAction }> = ({ action }) => {
	const fieldId = useId();
	/*
	 * The WHOLE map is subscribed for the refusal check (a candidate is refused
	 * against every other action's effective chord), and the row's own override
	 * for the Reset state — reading the narrower field off the same store keeps
	 * one source and two subscriptions, which zustand handles per selector.
	 */
	const bindings = useUiPreferencesStore((s) => s.shortcutBindings);
	const override = bindings[action.id];
	const setShortcutBinding = useUiPreferencesStore((s) => s.setShortcutBinding);
	const [recording, setRecording] = useState(false);
	/*
	 * The refusal explains the LAST press, so it is cleared by the next accepted
	 * capture and by leaving the field — never committed anywhere, because
	 * nothing was committed.
	 */
	const [refusal, setRefusal] = useState<string | null>(null);
	const platform = useMemo(rendererPlatform, []);
	const effective = effectiveChord(action.id, bindings);
	const label = rowLabel(action);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center gap-2">
				<Label htmlFor={fieldId} className="w-32 text-body-sm text-ink">
					{label}
				</Label>
				<Input
					id={fieldId}
					readOnly
					value={
						effective === null ? "No shortcut" : chordGlyph(effective, platform)
					}
					aria-label={`${label}: press the keys you want`}
					/*
					 * The row's stable hook for stories and capture rigs: the label
					 * above is copy and moves with the design, while this names the
					 * ACTION (persisted data), so a rig can find the field it means
					 * even after a wording pass.
					 */
					data-shortcut-action={action.id}
					className={cn(
						"w-52",
						effective === null ? "text-body-sm" : "font-mono text-body-sm",
					)}
					onFocus={() => setRecording(true)}
					onBlur={() => {
						setRecording(false);
						setRefusal(null);
					}}
					onKeyDown={(event) => {
						/*
						 * Cancel/commit first: a keystroke that ends the edit is not a
						 * binding, so it must not reach the recorder at all (the hotkey
						 * field's own rule, one extractor over).
						 */
						if (END_EDIT_KEYS.has(event.key)) {
							event.currentTarget.blur();
							return;
						}
						// A modifier alone is not a gesture, and an IME composition is
						// not the candidate its half-typed key reports.
						if (
							MODIFIER_ONLY_KEYS.has(event.key) ||
							event.nativeEvent.isComposing
						) {
							return;
						}
						const candidate = chordFromEvent({
							key: event.key,
							metaKey: event.metaKey,
							ctrlKey: event.ctrlKey,
							altKey: event.altKey,
							shiftKey: event.shiftKey,
						});
						const sentence = captureRefusal(candidate, action.id, bindings);
						if (sentence !== null) {
							event.preventDefault();
							setRefusal(sentence);
							return;
						}
						event.preventDefault();
						setRefusal(null);
						// A null candidate never reaches here (captureRefusal refuses it
						// by name), so the chord is a real one the store will canonicalise
						// again at its own boundary.
						if (candidate !== null) setShortcutBinding(action.id, candidate);
					}}
				/>
				{override !== undefined && (
					<Button
						variant="secondary"
						size="sm"
						aria-label={`Reset ${label} to its default`}
						onClick={() => setShortcutBinding(action.id, null)}
					>
						Reset
					</Button>
				)}
			</div>
			{recording && (
				<span className="text-meta text-ink-dim">
					Press the keys you want; Esc cancels.
				</span>
			)}
			{refusal !== null && (
				<output className="text-meta text-danger">{refusal}</output>
			)}
		</div>
	);
};

export const KeyboardShortcutsSection: FC<{
	/** Scroll target for the settings sidebar. */
	sectionRef?: RefObject<HTMLDivElement>;
}> = ({ sectionRef }) => (
	<SettingsSection
		title="Keyboard shortcuts"
		icon={Keyboard}
		description="Shortcuts for the panel rail. Focus a field and press the keys you want; Esc cancels, and Reset restores an action's default."
		sectionRef={sectionRef}
	>
		<div className="flex flex-col gap-4">
			{KEYMAP_ACTIONS.map((action) => (
				<ShortcutRow key={action.id} action={action} />
			))}
		</div>
	</SettingsSection>
);
