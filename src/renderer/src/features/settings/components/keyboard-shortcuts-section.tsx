import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
 * override; an override also shows Reset), cleared (the explicit no-chord state
 * — `No shortcut` plus Reset, UX round 1's U4), recording (the field has focus —
 * the hint appears with it), refused/conflict (the previous value is KEPT and
 * the sentence is shown under the field). Every state is reachable by keyboard
 * alone: the field is Tab-reachable, Tab and Shift+Tab LEAVE the recording
 * rather than being refused (U1 — one Tab then reaches Reset), Escape/Enter end
 * the recording cue while the field keeps focus (U2 — a blur dropped the caret
 * to `<body>` and sent the next Tab back to the page top), and Clear/Reset hand
 * focus back to the field as they delete themselves. Re-pressing the chord a
 * row already answers records nothing, and pressing the row's DEFAULT while an
 * override exists is the override's own reset (U3).
 *
 * WHAT IS DELIBERATELY INERT: paste. The field is `readOnly`, so a pasted
 * string is neither a chord this runtime could replay nor a keystroke the
 * reader made — a pasted value that "took" would be a binding nobody pressed.
 *
 * THE REFUSAL SENTENCES COME FROM `captureRefusal` (reserved, taken, needs a
 * modifier, not a bindable key), so the recorder and the store's write boundary
 * refuse the same set in the same words — the field only decides WHEN to ask,
 * and passes the platform it read so the needs-a-modifier sentence names the
 * keys this machine has (U5).
 */

import { Button, Input, Label } from "@shared/components/ui";
import {
	END_EDIT_KEYS,
	MODIFIER_ONLY_KEYS,
	NAVIGATION_KEYS,
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
import { useId, useMemo, useRef, useState } from "react";
import { rendererPlatform } from "../../../mini-view/renderer-platform";
import { SettingsSection } from "./settings-section";

/*
 * Tooltips use an imperative ("Open console") while these rows name the
 * destination ("Console"). Keep those as separate messages: stripping an
 * English prefix would produce the wrong grammar as soon as the action is
 * translated, and would silently fall back to the whole imperative.
 */
const rowLabel = (action: KeymapAction): string => {
	switch (action.id) {
		case "panel.console":
			return t("ui.settings.shortcuts.row.console");
		case "panel.canvas":
			return t("ui.settings.shortcuts.row.canvas");
		case "panel.run":
			return t("ui.settings.shortcuts.row.execution");
		case "panel.ask":
			return t("ui.settings.shortcuts.row.asks");
		case "panel.browser":
			return t("ui.settings.shortcuts.row.browser");
		case "panel.code":
			return t("ui.settings.shortcuts.row.code_review");
	}
};

const ShortcutRow: FC<{ action: KeymapAction }> = ({ action }) => {
	useI18nLocale();
	const fieldId = useId();
	const fieldRef = useRef<HTMLInputElement | null>(null);
	/*
	 * The WHOLE map is subscribed for the refusal check (a candidate is refused
	 * against every other action's effective chord), and the row's own override
	 * for the Reset state — reading the narrower field off the same store keeps
	 * one source and two subscriptions, which zustand handles per selector.
	 */
	const bindings = useUiPreferencesStore((s) => s.shortcutBindings);
	const override = bindings[action.id];
	const setShortcutBinding = useUiPreferencesStore((s) => s.setShortcutBinding);
	const clearShortcutBinding = useUiPreferencesStore(
		(s) => s.clearShortcutBinding,
	);
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
						effective === null
							? t(
									"ui.settings.shortcuts.keyboard_shortcuts_section.no_shortcut",
								)
							: chordGlyph(effective, platform)
					}
					aria-label={t(
						"ui.settings.shortcuts.keyboard_shortcuts_section.label_press_the_keys_you_want",
						{ label: String(label) },
					)}
					/*
					 * The row's stable hook for stories and capture rigs: the label
					 * above is copy and moves with the design, while this names the
					 * ACTION (persisted data), so a rig can find the field it means
					 * even after a wording pass.
					 */
					data-shortcut-action={action.id}
					ref={fieldRef}
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
						 * TAB NAVIGATES (UX round 1's U1): the press is left to the browser — no
						 * refusal, no `preventDefault` — so focus moves exactly as it does
						 * anywhere else in the product, one press reaches Reset, and the field's
						 * own `onBlur` ends the recording. Refusing it bought nothing and cost
						 * the section its keyboard path.
						 */
						if (NAVIGATION_KEYS.has(event.key)) return;
						/*
						 * Cancel/commit first: a keystroke that ends the edit is not a
						 * binding, so it must not reach the recorder at all (the hotkey
						 * field's own rule, one extractor over). It clears the recording CUE
						 * but keeps the field's focus (UX round 1's U2): a blur here dropped
						 * the caret to `<body>` and the next Tab restarted at the top of the
						 * page, while blur-and-refocus would re-arm the recording and make
						 * Escape a visible no-op. The next captured key re-arms the cue.
						 */
						if (END_EDIT_KEYS.has(event.key)) {
							setRecording(false);
							setRefusal(null);
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
						const sentence = captureRefusal(
							candidate,
							action.id,
							bindings,
							platform,
						);
						if (sentence !== null) {
							event.preventDefault();
							setRecording(true);
							setRefusal(sentence);
							return;
						}
						/*
						 * U3: the chord the row already answers changes nothing. Re-pressing the
						 * displayed chord must not plant an override equal to it — nothing
						 * visibly changed, so nothing should appear to have changed, and an
						 * override map full of default-identical entries misleads whoever
						 * inspects later what they customised.
						 */
						if (candidate === effective) {
							setRecording(true);
							setRefusal(null);
							return;
						}
						event.preventDefault();
						setRecording(true);
						setRefusal(null);
						/*
						 * ...and pressing a row's DEFAULT while an override exists is the
						 * override's own reset: the entry is deleted rather than stored with a
						 * value identical to the default (U3's second half).
						 */
						if (candidate === action.defaultChord) {
							setShortcutBinding(action.id, null);
						} else if (candidate !== null) {
							// A null candidate never reaches here (captureRefusal refuses it
							// by name), so the chord is a real one the store will
							// canonicalise again at its own boundary.
							setShortcutBinding(action.id, candidate);
						}
					}}
				/>
				{effective !== null && (
					<Button
						variant="secondary"
						size="sm"
						aria-label={t(
							"ui.settings.shortcuts.keyboard_shortcuts_section.clear_label_s_shortcut",
							{ label: String(label) },
						)}
						onClick={() => {
							/*
							 * CLEAR IS NOT RESET (UX round 1's U4): the explicit no-chord
							 * state — the action stops answering entirely and its default is
							 * freed for another row — where Reset restores the default. The
							 * button deletes itself and hands focus back to the field, so a
							 * keyboard user keeps their place.
							 */
							clearShortcutBinding(action.id);
							fieldRef.current?.focus();
						}}
					>
						{t("ui.settings.shortcuts.keyboard_shortcuts_section.clear")}
					</Button>
				)}
				{override !== undefined && (
					<Button
						variant="secondary"
						size="sm"
						aria-label={t(
							"ui.settings.shortcuts.keyboard_shortcuts_section.reset_label_to_its_default",
							{ label: String(label) },
						)}
						onClick={() => {
							setShortcutBinding(action.id, null);
							fieldRef.current?.focus();
						}}
					>
						{t("ui.settings.shortcuts.keyboard_shortcuts_section.reset")}
					</Button>
				)}
			</div>
			{recording && (
				<span className="text-meta text-ink-dim">
					{t(
						"ui.settings.shortcuts.keyboard_shortcuts_section.press_the_keys_you_want_esc_cancels",
					)}
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
}> = ({ sectionRef }) => {
	useI18nLocale();
	return (
		<SettingsSection
			title={t(
				"ui.settings.shortcuts.keyboard_shortcuts_section.keyboard_shortcuts",
			)}
			icon={Keyboard}
			description={t(
				"ui.settings.shortcuts.keyboard_shortcuts_section.shortcuts_for_the_panel_rail_focus_a_field_and_press_the_keys_you",
			)}
			sectionRef={sectionRef}
		>
			<div className="flex flex-col gap-4">
				{/*
				 * THE BROWSER'S SCOPE, STATED BEFORE THE ROWS (LOH-13). The browser's own
				 * chords are refused here, and a refused capture is the only moment this
				 * section would otherwise mention them — a refusal names the job but not
				 * the reason the chord was dead from the composer, which reads as broken.
				 * The paragraph names the browser-owning group rather than listing the
				 * chords again: the keymap registry stays the one place a chord is spelled,
				 * and each browser-only refused row repeats the instruction it needs.
				 */}
				<p
					data-shortcut-note="browser-scope"
					className="max-w-2xl text-body-sm text-ink-muted"
				>
					{t(
						"ui.settings.shortcuts.keyboard_shortcuts_section.browser_shortcuts_answer_only_while_the_browser_has_focus",
					)}
				</p>
				<div className="flex flex-col gap-4">
					{KEYMAP_ACTIONS.map((action) => (
						<ShortcutRow key={action.id} action={action} />
					))}
				</div>
			</div>
		</SettingsSection>
	);
};
