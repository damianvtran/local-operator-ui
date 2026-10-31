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
import { LANGUAGE_SETTING_KEY, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	CAPTURE_KEY_NAMES,
	END_EDIT_KEYS,
	MODIFIER_ONLY_KEYS,
	captureModifierTokens,
	composeCapturedChord,
} from "@shared/keymap/chord-capture";
import { cn } from "@shared/lib/utils";
import {
	type FC,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	DEFAULT_QUICK_SEND_VALUE,
	type MiniViewRegistrationState,
	formatQuickSendDisplay,
	isFunctionKeyToken,
} from "../../../../../shared/mini-view";
import { physicalKey } from "../../../../../shared/recording-shortcut";
import {
	alternatesCopy,
	desktopHotkeyNeedsModifierCopy,
	macosDetectionBoundaryCopy,
	priorArtCopy,
	quickSendScopeCopy,
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
	const key = physicalKey({
		key: event.key,
		code: event.code,
		alt: event.altKey,
	});
	return composeCapturedChord(
		captureModifierTokens(event),
		CAPTURE_KEY_NAMES[key] ?? key.toLowerCase(),
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
	useI18nLocale();
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
			<span className="text-meta text-ink-dim">{quickSendScopeCopy()}</span>
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
					{macosDetectionBoundaryCopy()}
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
	useI18nLocale();
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
				aria-label={t(
					"ui.settings.configuration.setting_control.label_press_the_key_you_want",
					{ label: String(label) },
				)}
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
						setRefusal(desktopHotkeyNeedsModifierCopy());
						return;
					}
					setRefusal(null);
					onChange(binding);
				}}
			/>
			<span className="text-meta text-ink-dim">
				{t(
					"ui.settings.configuration.setting_control.press_the_keys_you_want_esc_cancels",
				)}
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
	/**
	 * The id this picker's `aria-describedby` points at, and the id the inner
	 * note carries when it renders one. Defaults to `settingEffectiveId(key)`,
	 * which is the General surface's spelling; a second surface that can be
	 * co-mounted passes `settingEffectiveIdFor(key, <surface>)` so the two never
	 * collide (see that helper).
	 */
	effectiveNoteId?: string;
	/**
	 * Suppress the row's own effective note (`EffectiveLanguage`).
	 *
	 * The note is the picker's OWN caption and belongs with it wherever the
	 * control is the header of its surface. It must be suppressed where the
	 * surface already renders its own caption for the same fact: the General
	 * language section renders the phase-aware sentence (`In effect: <tag>` /
	 * pending / saved / last-known / not-yet-resolved) directly under the
	 * control, and leaving the inner note on rendered "en" TWICE in two voices
	 * (design round 1 D1). One surface, one caption.
	 */
	suppressEffectiveNote?: boolean;
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

/** Native names are language identifiers, not claims of translated coverage.
 * The backend's choices decide eligibility. Flags are decorative representative
 * artwork, never a country preference; intrinsic pigments are not UI role colors.
 */
export const LANGUAGE_IDENTIFIERS = [
	{ value: "en", name: "English", country: "us" },
	{ value: "fr", name: "Français", country: "fr" },
	{ value: "es", name: "Español", country: "es" },
	{ value: "zh-CN", name: "简体中文", country: "cn" },
	{ value: "ru", name: "Русский", country: "ru" },
	{ value: "vi", name: "Tiếng Việt", country: "vn" },
	{ value: "ur", name: "اردو", country: "pk" },
	{ value: "hi", name: "हिन्दी", country: "in" },
] as const;

/**
 * The tag the SERVER served, resolved to the one name table above.
 *
 * WHY A NORMALISER RATHER THAN A PINNED TAG. Eligibility is the backend's answer
 * (`languageChoices` enables a value only when the server's `choices` contains
 * it), so the identifier table must never be the thing that decides what is
 * selectable. But the flag and autonym hang off the tag this table spells, and
 * the core's own `SUPPORTED_LOCALES` normalises a served tag by its exact
 * spelling (`zh-CN`). A future core that served the bare `zh` subtag - or a
 * region variant like `zh-Hans` - would otherwise render a genuinely served
 * locale as a disabled, unnamed option, which reads as "this backend does not
 * have Chinese" over a backend that just answered in it.
 *
 * So the match is by primary language subtag with an exact hit preferred: an
 * exact `zh-CN` wins, `zh-Hans`/`zh`/`zh-TW` fall back to the `zh-CN` entry, and
 * anything unknown simply has no artwork (server eligibility still decides).
 */
export function languageIdentifierFor(value: string) {
	const exact = LANGUAGE_IDENTIFIERS.find((item) => item.value === value);
	if (exact) return exact;
	const primary = value.split("-")[0]?.toLowerCase();
	if (!primary) return undefined;
	return LANGUAGE_IDENTIFIERS.find(
		(item) => item.value.split("-")[0]?.toLowerCase() === primary,
	);
}

export function languageChoices(setting: BackendSetting) {
	const available = new Map(
		setting.choices.map((choice) => [String(choice.value), choice]),
	);
	return ["auto", ...LANGUAGE_IDENTIFIERS.map((item) => item.value)].map(
		(value) => ({
			value,
			enabled: available.has(value),
			label: available.get(value)?.label ?? value,
			description: available.get(value)?.description ?? "",
		}),
	);
}

const LanguageFlag: FC<{ country: string }> = ({ country }) => {
	useI18nLocale();
	/*
	 * Explicit artwork rather than generated bands: a repeated pigment (Spain's
	 * two reds) has no natural list index to key on, so each band carries the
	 * geometry and the key its own artwork states.
	 */
	const hband = (k: string, fill: string, y: number, h = 16 / 3) => (
		<rect key={k} x="0" y={y} width="24" height={h} fill={fill} />
	);
	const vband = (k: string, fill: string, x: number) => (
		<rect key={k} x={x} y="0" width="8" height="16" fill={fill} />
	);
	return (
		<svg
			viewBox="0 0 24 16"
			className="h-4 w-6 shrink-0"
			aria-hidden="true"
			focusable="false"
		>
			{country === "fr" && (
				<>
					{vband("fr-left", "#002395", 0)}
					{vband("fr-middle", "#ffffff", 8)}
					{vband("fr-right", "#ed2939", 16)}
				</>
			)}
			{country === "es" && (
				<>
					{hband("es-top", "#aa151b", 0)}
					{hband("es-middle", "#f1bf00", 16 / 3)}
					{hband("es-bottom", "#aa151b", 32 / 3)}
				</>
			)}
			{country === "ru" && (
				<>
					{hband("ru-top", "#ffffff", 0)}
					{hband("ru-middle", "#0039a6", 16 / 3)}
					{hband("ru-bottom", "#d52b1e", 32 / 3)}
				</>
			)}
			{country === "in" && (
				<>
					{hband("in-top", "#ff9933", 0)}
					{hband("in-middle", "#ffffff", 16 / 3)}
					{hband("in-bottom", "#138808", 32 / 3)}
					<circle
						cx="12"
						cy="8"
						r="2"
						fill="none"
						stroke="#000080"
						strokeWidth="0.7"
					/>
				</>
			)}
			{country === "us" && (
				<>
					<rect width="24" height="16" fill="#ffffff" />
					{[0, 2, 4, 6, 8, 10, 12].map((stripe) => (
						<rect
							key={stripe}
							width="24"
							height={16 / 13}
							y={(stripe * 16) / 13}
							fill="#b22234"
						/>
					))}
					<rect width="10" height="9" fill="#3c3b6e" />
					<path
						d="M2 2h1v1H2zm3 0h1v1H5zm3 0h1v1H8zM2 5h1v1H2zm3 0h1v1H5zm3 0h1v1H8z"
						fill="#ffffff"
					/>
				</>
			)}
			{["cn", "vn"].includes(country) && (
				<>
					<rect width="24" height="16" fill="#da251d" />
					<path
						d={
							country === "vn"
								? "M12 3l1.5 3.5 4 .4-3 2.6 1 3.8-3.5-2-3.5 2 1-3.8-3-2.6 4-.4z"
								: "M5 2l1 2.4 2.5.2-2 1.6.7 2.5L5 7.3 2.8 8.7l.7-2.5-2-1.6L4 4.4z"
						}
						fill="#ffde00"
					/>
				</>
			)}
			{country === "pk" && (
				<>
					<rect width="24" height="16" fill="#01411c" />
					<rect width="6" height="16" fill="#ffffff" />
					<path d="M17 3a5 5 0 1 0 3 8 4.5 4.5 0 0 1-3-8z" fill="#ffffff" />
					<path
						d="M18 3l.5 1.3 1.5.1-1.1 1 .4 1.4-1.3-.8-1.2.8.4-1.4-1.1-1 1.4-.1z"
						fill="#ffffff"
					/>
				</>
			)}
		</svg>
	);
};

export const LanguageChoiceLabel: FC<{
	value: string;
	fallback: string;
	/**
	 * The option cannot be selected on this backend. Used for the flag treatment,
	 * not for the text: the autonym stays fully legible (see the bidi note below).
	 */
	disabled?: boolean;
}> = ({ value, fallback, disabled = false }) => {
	useI18nLocale();
	const identity = languageIdentifierFor(value);
	if (!identity)
		return (
			<>
				{value === "auto" ? t("ui.settings.language.general.system") : fallback}
			</>
		);
	return (
		/*
		 * `min-w-0` on the row plus `whitespace-nowrap` on each part is what keeps
		 * this a SINGLE OPTION rather than a wrapping paragraph: without it the RTL
		 * autonym broke to a second line while `简体中文` stayed inline (UX U2).
		 *
		 * `items-center` with the leading-none flag and an explicit `leading-6` on
		 * the text is the line box a right-to-left script needs: Arabic ascenders and
		 * descenders both exceed a Latin x-height, and at the inherited tight line
		 * height the Arabic glyph line COLLAPSED to a sliver with a stray Latin
		 * fragment at the left edge (design round 1 D3). The isolated `<bdi>` is the
		 * other half: `dir="auto"` on the text itself - not merely on a wrapper -
		 * is what stops the surrounding Latin UI from re-ordering the run.
		 */
		<span className="inline-flex min-w-0 items-center gap-2">
			<span className={disabled ? "opacity-45 saturate-50" : undefined}>
				<LanguageFlag country={identity.country} />
			</span>
			<bdi
				dir="auto"
				lang={identity.value}
				className="whitespace-nowrap leading-6"
			>
				{identity.name}
			</bdi>
		</span>
	);
};

/**
 * The effective-note's DOM id on the CANONICAL surface, and the picker's
 * `aria-describedby` target there (U2).
 *
 * A surface that can be co-mounted must NOT reuse this spelling - it derives its
 * own with `settingEffectiveIdFor` below, so two live surfaces never put one id
 * on two elements. The note this id names is documented on `EffectiveLanguage`.
 */
export const settingEffectiveId = (key: string) => `setting-effective-${key}`;

/**
 * The same note's id on a SECOND surface that may be co-mounted.
 *
 * WHY A SECOND SPELLING. `setting-effective-language` is emitted by whichever
 * element owns the caption for the surface in view, and each picker must point
 * at ITS OWN caption. Two surfaces that can be mounted at once — the General
 * section and the palette dialog, co-mounted when the dialog is opened on
 * `/settings` — would otherwise both emit the canonical id, and
 * `getElementById` would resolve one picker's `aria-describedby` to the OTHER
 * surface's caption (QA round 5, Q5). Distinct ids per surface is the fix that
 * needs no proof: one id, one owner, one describedby target, at every moment.
 */
export const settingEffectiveIdFor = (key: string, surface: string) =>
	`${settingEffectiveId(key)}-${surface}`;

/** The palette dialog's own spelling, since it can be open beside the section. */
export const DIALOG_EFFECTIVE_SURFACE = "dialog";

/**
 * What `auto` resolves to RIGHT NOW, under the language row's picker.
 *
 * The note is LIVE (`aria-live="polite"`): a locale that lands while the row
 * is on screen - this row's own save, or the TUI's, picked up by the
 * capabilities watch - is announced rather than silently repainted, and the
 * picker's `aria-describedby` names it so the relationship survives a screen
 * reader's focus order (U2, round 1).
 */
const EffectiveLanguage = ({ id }: { id?: string }) => {
	const locale = useI18nLocale();
	/*
	 * Through `t()` from the first line this string exists: the row is the
	 * i18n core's first product consumer, and a literal here would have been
	 * new debt the string scanner flags - it flagged this slice's first draft,
	 * and `ui.settings.language.effective` is the key that answered it.
	 */
	return (
		<span id={id} aria-live="polite" className="text-meta text-ink-dim">
			{/*
			 * The native name, not the raw tag (design round 1, D4): the picker
			 * the reader just used names languages natively, so the caption that
			 * confirms the switch does too. A locale the table does not know
			 * falls back to the raw tag rather than naming nothing.
			 */}
			{t("ui.settings.language.effective", {
				locale: languageIdentifierFor(locale)?.name ?? locale,
			})}
		</span>
	);
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
	suppressEffectiveNote = false,
	effectiveNoteId: effectiveNoteIdProp,
}: SettingControlProps) => {
	useI18nLocale();
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
	/*
	 * The language row's effective note, and its `describedby` target. Only
	 * this key gets one: the note is the one piece of control-adjacent text
	 * that changes WITHOUT the reader acting on the control (U2, round 1).
	 */
	/*
	 * The picker's describedby target, and the one caption id on this surface (U2,
	 * round 1). It is emitted WHETHER OR NOT this control renders the note itself:
	 * where the surface owns the caption (`suppressEffectiveNote`), the id belongs
	 * to THAT element, and the control still has to point at it — QA round 4's Q1
	 * caught the first version making the id conditional on the note, which left
	 * the surviving caption anonymous and the picker describing nothing.
	 */
	const effectiveNoteId =
		setting.key === LANGUAGE_SETTING_KEY
			? (effectiveNoteIdProp ?? settingEffectiveId(setting.key))
			: undefined;
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
				<div className="flex w-full flex-col items-end gap-1">
					<Select
						value={value}
						disabled={disabled}
						onValueChange={onValueChange}
					>
						<SelectTrigger
							aria-label={setting.label}
							aria-describedby={
								[helpId, effectiveNoteId].filter(Boolean).join(" ") || undefined
							}
							className="w-full"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(setting.key === LANGUAGE_SETTING_KEY
								? languageChoices(setting)
								: setting.choices
							).map((choice) => (
								<SelectItem
									key={serialize(choice.value)}
									value={serialize(choice.value)}
									disabled={"enabled" in choice && !choice.enabled}
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
									{setting.key === LANGUAGE_SETTING_KEY ? (
										<>
											<LanguageChoiceLabel
												value={String(choice.value)}
												fallback={choice.label}
												disabled={"enabled" in choice && !choice.enabled}
											/>
											{"enabled" in choice && !choice.enabled && (
												/*
												 * Visibly SECONDARY to the label it qualifies (design round 1
												 * D4): the reason is a qualifier on the option, so it is smaller
												 * and dimmer than the autonym and never competes with it. It also
												 * carries `whitespace-nowrap` so it cannot break the row into
												 * two lines beside the RTL label (UX U2).
												 */
												<span className="ms-2 shrink-0 text-caption text-ink-dim whitespace-nowrap">
													{t("ui.settings.language.general.unavailable_choice")}
												</span>
											)}
										</>
									) : (
										choice.label
									)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{setting.key === LANGUAGE_SETTING_KEY && !suppressEffectiveNote && (
						<EffectiveLanguage id={effectiveNoteId} />
					)}
				</div>
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
						{t(
							"ui.settings.configuration.setting_control.one_hop_per_line_as_provider_model_effort_an_empty_chain_moves_to",
						)}
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
