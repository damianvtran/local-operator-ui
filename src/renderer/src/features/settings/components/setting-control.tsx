/**
 * The `kind` -> control switch, and the slot each control occupies.
 *
 * Two things live here that used to be spread through the row.
 *
 * 1. THE SLOT. Every control was rendered full width, which is the operator's
 *    "most settings taking up full width and being inefficient with space" as a
 *    number: 68 of 99 rows carried a control wider than 800px and 90 of 99
 *    carried one narrower than 40px, all inside a ~77px row. A control is sized
 *    by its KIND here — a switch is a switch, a number is a number, a host list
 *    is a list — and the row's layout, not the caller, decides what happens when
 *    the column is too narrow for it (it stacks). Full width survives only where
 *    the value genuinely is multi-line: `list` and `cascade`.
 *
 * 2. THE HOTKEY KIND. The contract's `kind` union did not name `hotkey`, so the
 *    two `keymap.*` rows fell through to the default text branch and rendered a
 *    plain text input for a field whose own help says "press the key you want".
 *    A hotkey has to LISTEN for a keystroke, which is why it is a kind rather
 *    than a string with a hint (see `settings_io.Kind.HOTKEY`).
 *
 * Nothing saves on blur here either — a control reports its draft upward and the
 * row's Save decides when anything is written.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import {
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	Textarea,
} from "@shared/components/ui";
import {
	CAPTURE_KEY_NAMES,
	END_EDIT_KEYS,
	MODIFIER_ONLY_KEYS,
	captureModifierTokens,
	composeCapturedChord,
} from "@shared/keymap/chord-capture";
import { cn } from "@shared/lib/utils";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
	DEFAULT_QUICK_SEND_VALUE,
	type MiniViewRegistrationState,
	formatQuickSendDisplay,
	isFunctionKeyToken,
} from "../../../../../shared/mini-view";
import {
	DESKTOP_HOTKEY_NEEDS_MODIFIER_COPY,
	MACOS_DETECTION_BOUNDARY_COPY,
	QUICK_SEND_SCOPE_COPY,
	alternatesCopy,
	priorArtCopy,
	registrationCopy,
} from "../../../mini-view/mini-copy";
import { rendererPlatform } from "../../../mini-view/renderer-platform";
import { settingComboSource } from "../backend-setting-combos";
import { durationSpec } from "../retention-duration";
import { CASCADE_SENTINEL, serialize } from "./backend-settings-drafts";
import { RetentionDurationControl } from "./retention-duration-control";
import { SettingCombobox } from "./setting-combobox";

/**
 * The width each kind's control occupies.
 *
 * `min-w-0` on the two full-width kinds is what lets a textarea shrink inside a
 * flex row instead of forcing the row wider than its column.
 */
const SLOT: Record<BackendSetting["kind"], string> = {
	bool: "w-9",
	int: "w-28",
	float: "w-28",
	enum: "w-64",
	text: "w-96",
	hotkey: "w-56",
	list: "w-full min-w-0",
	cascade: "w-full min-w-0",
	readonly: "w-40",
};

/** The slot class for one setting, exported for the row's own layout. */
export function controlSlot(kind: BackendSetting["kind"]): string {
	return SLOT[kind] ?? SLOT.text;
}

/**
 * The keystroke names, the modifier-only keys, the edit-ending keys and the
 * composition all live in `@shared/keymap/chord-capture` now (the registry's
 * recorder imports the same set — issue #928). This module keeps only the
 * backend grammar's spelling: what `hotkeyFromEvent` emits is byte-identical
 * to what it emitted when these lived here, which is the pass condition for
 * the extraction (every stored `keymap.*` row reads back the same).
 */

/**
 * The binding a keystroke spells, in the one order the registry stores.
 *
 * The registry normalizes again at the write boundary (`settings_io.coerce` ->
 * `keymap.normalize_key`), so this is the capture half of the contract rather
 * than a second definition of it: what it guarantees is that the common case
 * (`cmd+shift+n`) is already in the runtime's own spelling and reads back the
 * same in the field.
 */
export function hotkeyFromEvent(
	event: KeyboardEvent<HTMLInputElement>,
): string {
	// `isComposing` lives on the native event: an IME candidate window would
	// otherwise bind whatever half-typed character the reader has so far.
	if (MODIFIER_ONLY_KEYS.has(event.key) || event.nativeEvent.isComposing) {
		return "";
	}
	return composeCapturedChord(
		captureModifierTokens(event),
		CAPTURE_KEY_NAMES[event.key] ?? event.key.toLowerCase(),
	);
}

/**
 * Whether a captured chord may be a GLOBAL shortcut (design §H.2, §A.5).
 *
 * The desktop validator's first rule, mirrored at capture time so the refusal
 * happens under the reader's fingers rather than at Save: at least one
 * modifier — a bare letter would fire while they type, on every app on the
 * machine — with bare function keys as the one documented exception (they are
 * not typable). The backend still validates at the write boundary; this is the
 * capture half, and it exists because a stored-but-unregistrable value is the
 * dead key the design forbids, not because the server would accept it.
 */
function desktopChordAllowed(binding: string): boolean {
	const tokens = binding.split("+");
	const key = tokens.at(-1) ?? "";
	const hasModifier = tokens.length > 1;
	if (hasModifier) return true;
	return isFunctionKeyToken(key);
}

/**
 * The desktop-scope extras under a hotkey field (design §H.2): the scope line,
 * the live registration state and the alternates sentence.
 *
 * The registration state is PUSHED to every renderer on every change
 * (`mini-view:registration`), so a chord that failed to register while the
 * page was open reads correctly on the next paint rather than after a reload —
 * the design's "registration failure is surfaced, never silent". Absent bridge
 * (Storybook, a headless rig) renders nothing rather than guessing: this row
 * is the one place the app speaks about the shortcut's live state, and a
 * fabricated answer there is worse than an absent one.
 */
const DesktopHotkeyDetails = () => {
	const [registration, setRegistration] =
		useState<MiniViewRegistrationState | null>(null);
	const platform = useMemo(rendererPlatform, []);

	useEffect(() => {
		const api = window.api?.miniView;
		if (!api) return undefined;
		let cancelled = false;
		api
			.getRegistration()
			.then((state) => {
				if (!cancelled) setRegistration(state);
			})
			.catch(() => {
				/* No registration state readable yet (an older main, a race at
				   startup): the badge stays absent and the push path fills it. */
			});
		const unsubscribe = api.onRegistration((state) => {
			if (!cancelled) setRegistration(state);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const display = formatQuickSendDisplay(
		registration?.value ?? DEFAULT_QUICK_SEND_VALUE,
		platform,
	);

	return (
		<span
			className="flex flex-col gap-0.5"
			data-tour-tag="quick-send-registration"
		>
			<span className="text-meta text-ink-dim">{QUICK_SEND_SCOPE_COPY}</span>
			{registration ? (
				<output
					className={cn(
						"text-meta",
						registration.status === "registered"
							? "text-ink-muted"
							: "text-danger",
					)}
				>
					{registrationCopy(registration.status, display)}
				</output>
			) : null}
			{/*
			 * THE macOS HONESTY LINE (QA round 1, Q2): `register()` answers true
			 * for a chord another app or the system owns on macOS, so a silent
			 * dead key can sit behind a "Registered" badge. The row states the
			 * practical path instead of promising a detection the platform
			 * cannot deliver; Windows and Linux refuse such a chord and surface
			 * it through the taken state, so the line is macOS-only.
			 */}
			{platform === "mac" && registration?.status === "registered" ? (
				<span className="text-meta text-ink-dim">
					{MACOS_DETECTION_BOUNDARY_COPY}
				</span>
			) : null}
			<span className="text-meta text-ink-dim">{alternatesCopy(platform)}</span>
		</span>
	);
};

/**
 * The hotkey field: it captures a keystroke instead of accepting text.
 *
 * `readOnly`, because a hand-typed `ctrl+N` is exactly the value the runtime
 * cannot bind — the field's only writer is a real key press. That is also why
 * there is no `placeholder` here: an example in the field would invite typing
 * into a control that does not accept typing.
 *
 * The sentence under the field is the other half of that: until it existed, the
 * only instruction lived in the field's ACCESSIBLE NAME, which a sighted reader
 * never meets (UX round 1, U7).
 *
 * THE `desktop` HALF (quick-send design §H.2). A row whose `hotkey_scope` is
 * `"desktop"` binds a GLOBAL chord rather than a key inside the terminal — so
 * the same keystroke means a different thing, and the capture rules say so: a
 * chord with no modifier is refused under the field instead of being stored
 * (the backend would refuse the write anyway; the reader should learn it at the
 * key press, not at Save), the field lists the live registration state, and it
 * discloses the known soft claimants for the chord it is showing. Everything
 * else — the escape/enter handling, the modifier-only filter, the hint
 * sentence — is shared, because those are facts about capturing ANY chord.
 */
const HotkeyInput = ({
	value,
	label,
	disabled,
	desktop = false,
	onChange,
}: {
	value: string;
	label: string;
	disabled: boolean;
	/** True for `hotkey_scope === "desktop"` — see the docstring above. */
	desktop?: boolean;
	onChange: (value: string) => void;
}) => {
	/*
	 * The refusal holds until the next captured chord: it explains the LAST
	 * press, so it must not linger once a different (accepted) chord replaces
	 * the field's value — and it must not be committed anywhere, because
	 * nothing was committed.
	 */
	const [refusal, setRefusal] = useState<string | null>(null);
	const platform = useMemo(rendererPlatform, []);
	const warning = desktop ? priorArtCopy(value, platform) : null;

	return (
		<span className="flex w-full flex-col gap-0.5">
			<Input
				readOnly
				value={value}
				disabled={disabled}
				aria-label={`${label}: press the key you want`}
				className="font-mono text-body-sm"
				onKeyDown={(event) => {
					// Cancel/commit first: a keystroke that ends the edit is not a
					// binding, so it must not reach `hotkeyFromEvent` at all.
					if (END_EDIT_KEYS.has(event.key)) {
						event.currentTarget.blur();
						return;
					}
					const binding = hotkeyFromEvent(event);
					// An unmodified printable key is a keystroke the reader meant to bind;
					// a modifier alone is not, and neither is a key the runtime cannot
					// name — both are left alone rather than bound to something unusable.
					if (!binding) return;
					event.preventDefault();
					if (desktop && !desktopChordAllowed(binding)) {
						setRefusal(DESKTOP_HOTKEY_NEEDS_MODIFIER_COPY);
						return;
					}
					setRefusal(null);
					onChange(binding);
				}}
			/>
			<span className="text-meta text-ink-dim">
				Press the keys you want; Esc cancels.
			</span>
			{refusal ? (
				<output className="text-meta text-danger">{refusal}</output>
			) : null}
			{warning ? (
				<span className="text-meta text-ink-muted">{warning}</span>
			) : null}
			{desktop ? <DesktopHotkeyDetails /> : null}
		</span>
	);
};

export type SettingControlProps = {
	setting: BackendSetting;
	/** The serialized draft, or the cascade sentinel for the cascade kind. */
	value: string;
	/**
	 * The `hosting` this row will boot on: the hosting row's draft while it is
	 * unsaved, the server's value otherwise. Only the model rows read it, and
	 * only to narrow their list.
	 */
	effectiveHosting?: string;
	/** The cascade chains, when the kind is `cascade`. */
	chains?: Record<string, string[]>;
	/** True while the row is saving, or gated off by another setting. */
	disabled?: boolean;
	onValueChange: (value: string) => void;
	onChainsChange?: (chains: Record<string, string[]>) => void;
	/**
	 * The id of the row's help sentence, WHEN the row is rendering one.
	 *
	 * It comes from the row rather than being derived here because only the row
	 * knows its tier: an advanced row keeps its help behind a disclosure, and an
	 * `aria-describedby` that names an element nobody rendered is a worse failure
	 * than no association at all.
	 */
	helpId?: string;
};

export const SettingControl = ({
	setting,
	value,
	chains,
	disabled = false,
	onValueChange,
	onChainsChange,
	effectiveHosting = "",
	helpId,
}: SettingControlProps) => {
	/*
	 * The searchable combobox branch, keyed on the setting's KEY rather than on
	 * its kind, and placed before the switch so it cannot be reached by a later
	 * arm.
	 *
	 * WHY A KEY: every one of these rows IS `Kind.TEXT`, on the server and on the
	 * wire, and stays that way — the suggestions assist a deliberately open value
	 * space rather than constraining it to a closed set. A new `kind` would force
	 * `coerce`, `validate` and the CLI to grow a branch for that open space, which
	 * is the argument the TUI recorded when it shipped the same feature
	 * (`_SUGGEST_KEYS` in `settings_view.py`). The row's own behaviour — its
	 * `text` slot width, its deep-link reveal seam — therefore stays as it is.
	 */
	const comboSource = settingComboSource(setting.key);
	if (comboSource) {
		return (
			<SettingCombobox
				setting={setting}
				kind={comboSource}
				value={value}
				disabled={disabled}
				onValueChange={onValueChange}
				effectiveHosting={effectiveHosting}
				helpId={helpId}
			/>
		);
	}

	/*
	 * A bounded duration, keyed like the combobox above and for the same reason:
	 * the wire says `int`, and the registry's `unit`/`minimum`/`maximum` are what
	 * make a stepped control possible (`retention-duration.ts`). Placed before the
	 * kind switch so the plain number field is only the fallback for a row this
	 * control does not understand.
	 */
	if (durationSpec(setting)) {
		return (
			<RetentionDurationControl
				setting={setting}
				value={value}
				disabled={disabled}
				onValueChange={onValueChange}
				helpId={helpId}
			/>
		);
	}

	switch (setting.kind) {
		case "bool":
			return (
				<Switch
					checked={value === "true"}
					disabled={disabled}
					onCheckedChange={(checked) =>
						onValueChange(checked ? "true" : "false")
					}
					aria-label={setting.label}
				/>
			);
		case "enum":
			return (
				<Select value={value} disabled={disabled} onValueChange={onValueChange}>
					<SelectTrigger aria-label={setting.label} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{setting.choices.map((choice) => (
							<SelectItem
								key={serialize(choice.value)}
								value={serialize(choice.value)}
								/*
								 * The registry ships a sentence for each choice (`snapcompact for
								 * vision models, else context-full`) and 43 of the 102 settings
								 * have one, so the listbox was four opaque words where "what does
								 * this do" is answerable (UX round 1, U6). The sentence is the
								 * item's `title` rather than a second line INSIDE the item: an
								 * open listbox is a portal-rendered popper that no committed frame
								 * can photograph, so a change to the item's anatomy would be a
								 * visual change no design round could review. The item's own
								 * anatomy is therefore untouched and the copy is reachable.
								 */
								title={choice.description || undefined}
							>
								{choice.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "int":
		case "float":
			return (
				<Input
					type="number"
					value={value}
					disabled={disabled}
					min={setting.minimum ?? undefined}
					max={setting.maximum ?? undefined}
					step={setting.kind === "int" ? 1 : "any"}
					onChange={(event) => onValueChange(event.target.value)}
					aria-label={setting.label}
				/>
			);
		case "hotkey":
			return (
				<HotkeyInput
					value={value}
					label={setting.label}
					disabled={disabled}
					/*
					 * Absent (`null`/`undefined`) means `app`, which is what every
					 * hotkey row meant before the field existed — an older server's
					 * payloads therefore render exactly the control they always did.
					 */
					desktop={setting.hotkey_scope === "desktop"}
					onChange={onValueChange}
				/>
			);
		case "list":
			return (
				<Textarea
					value={value}
					disabled={disabled}
					rows={Math.min(6, setting.members.length + 2)}
					onChange={(event) => onValueChange(event.target.value)}
					aria-label={setting.label}
					placeholder={setting.placeholder}
					className="font-mono text-body-sm"
				/>
			);
		case "cascade": {
			const live =
				chains ?? (setting.value as Record<string, string[]> | null) ?? {};
			return (
				<div className="flex flex-col gap-3">
					{Object.entries(live).map(([chainName, hops]) => (
						<div key={chainName} className="flex flex-col gap-1">
							<span className="font-mono text-meta text-ink-dim">
								{chainName}
							</span>
							<Textarea
								value={hops.join("\n")}
								disabled={disabled}
								rows={Math.max(2, hops.length + 1)}
								onChange={(event) =>
									onChainsChange?.({
										...live,
										[chainName]: event.target.value
											.split("\n")
											.map((line) => line.trim())
											.filter(Boolean),
									})
								}
								aria-label={`${setting.label}: ${chainName}`}
								className="font-mono text-body-sm"
							/>
						</div>
					))}
					<p className="text-meta text-ink-dim">
						One hop per line, as provider/model (effort). An empty chain moves
						to the next provider.
					</p>
				</div>
			);
		}
		default:
			return (
				<Input
					value={value}
					disabled={disabled}
					onChange={(event) => onValueChange(event.target.value)}
					aria-label={setting.label}
					placeholder={setting.placeholder}
				/>
			);
	}
};

/** Whether a draft is the untouched cascade sentinel. */
export const isCascadeUntouched = (draft: string) => draft === CASCADE_SENTINEL;
