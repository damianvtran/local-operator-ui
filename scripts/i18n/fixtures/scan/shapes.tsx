/*
 * Fixture for `scripts/i18n/check-strings.test.mjs` — NOT product code.
 *
 * The DATA SHAPES the widened ratchet sees: a copy-keyed object-literal
 * property, a JSX child expression, and the template spelling of either. Every
 * case carries the neighbouring shape it must NOT become — the machine
 * positions (a log, a thrown error, a test id, a CSS class, a prop name, a code
 * snippet) are in the same file on purpose: they are one key press away from the
 * prose beside them, and a rule that cannot tell them apart is a rule that will
 * be turned off.
 *
 * The fixture runs through `findViolations(sourceFile, { dataShapes: true })`
 * regardless of where it lives (`scanSnapshot` turns the data shapes on for a
 * fixture corpus); the surface boundary itself is asserted separately, against
 * the same function with `dataShapes: false`.
 */

declare const count: number;
declare const flag: boolean;
declare const t: (key: string) => string;
declare const NAME: string;

/* --- object literals: copy keys -------------------------------------------------- */

export const Labels = {
	label: "Flagged label",
	title: "Flagged title",
	description: "Flagged description",
	text: "Flagged text",
	message: `Flagged ${NAME} message`,
	detail: "Flagged detail",
	cancel: "Flagged cancel",
	summary: flag ? "Flagged summary A" : "Flagged summary B",
	// biome-ignore lint/style/useTemplate: the fixture pins `+` as a copy shape
	caption: "Flagged" + NAME,
};

/* --- object literals: NOT copy --------------------------------------------------- */

export const NotCopy = {
	// A catalogue key is the KEYED spelling: the component calls `t(value)` on it.
	label: "ui.settings.section.interface_language.label",
	// A token key, whatever its value looks like.
	status: "Flagged is not a key here",
	kind: "connecting",
	id: "agent-messages-onboarding",
	name: "Flagged is not a key here either",
	// Prose value on a non-copy key: the key set is the vocabulary, not the prose.
	className: "text-ink-muted",
	"data-testid": "copy-shapes",
	code: "npm run build",
	// A copy key whose value is a call: a keyed site exposes no static text.
	// (see `Keyed` below for the same shape at a JSX attribute)
	tooltip: "never",
};

export const Keyed = { label: t("ui.chat.page_chrome.aside_text_only") };

/* --- object literals: the pragma -------------------------------------------------- */

export const Pragmad = {
	label: "Token on this line", // i18n: ignore fixture pins the property-line pragma
	title: "Flagged beside the pragma",
};

/* --- JSX children: expressions ---------------------------------------------------- */

export const Children = () => (
	<div>
		<span>{flag ? "Flagged arm A" : "Flagged arm B"}</span>
		<span>{`Flagged ${count} children`}</span>
		<span>{"Flagged braced literal"}</span>
		<span>{`${count} Flagged template`}</span>
		<span>{flag && "Flagged and-right"}</span>
		{/* biome-ignore lint/style/useTemplate: the fixture pins `+` as a copy shape */}
		<span>{"Flagged" + NAME}</span>
		<span>{count} Flagged plain text</span>
		{/* JSX text and an expression spelling the same sentence are two findings:
		    the text is one node and the expression another. */}
	</div>
);

/* --- JSX children: machine positions --------------------------------------------- */

export const Machine = () => {
	console.log(`Logged ${count} rows`);
	throw new Error(`Thrown ${NAME} error`);
};

export const MachineJsx = () => (
	<div className={`css-${NAME}-flag`} data-testid="copy-shapes">
		<span>{t("ui.chat.page_chrome.aside_text_only")}</span>
		<span>{count}</span>
		<span>·</span>
	</div>
);
