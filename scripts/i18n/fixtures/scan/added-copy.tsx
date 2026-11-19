/* Fixture only: the real scanner excludes this directory. */

/*
 * The shape the scanner was blind to (i18n programme, C1): a sentence held in a
 * module-level const and rendered through a JSX expression. The sink is an
 * Identifier, and the literal lives in a declaration the walk never reached, so
 * a whole user-facing sentence could ship in English in every locale while the
 * catalogue guard still reported zero missing keys.
 *
 * Deliberately an ordinary sentence about nothing in particular: the guard must
 * learn the SHAPE, not a blacklist of the sentences that happened to be found.
 */
const ADDED_CONST_COPY = "Added const copy";
const ADDED_CONST_LABEL = "Added const label";

export const AddedCopyFixture = ({ enabled, count, kind, serverText, t }) => {
	const items = [
		{ label: "Added object label" },
		// biome-ignore lint/style/noUnusedTemplateLiteral: pins no-substitution object template copy
		{ description: `Added object template` },
		{ title: enabled ? "Added enabled title" : "Added disabled title" },
		{ text: `Added ${count} template suffix` },
		{ message: "Added " + "concatenated copy" },
		{ label: enabled && "Added logical and label" },
		{ label: enabled || "Added logical or label" },
		{ label: serverText ?? "Added nullish label" },
		{ label: t("ui.fixture.keyed") },
		{ label: "ui.fixture.keyed" },
		{ tooltip: serverText },
		{ id: "technical-identifier", model: "gpt-5" },
		{
			text: /* i18n: ignore model identifier stays English */ "Local Operator",
		},
	];
	return (
		<div>
			<button type="button" aria-label={"Added expression label"} />
			<input
				// biome-ignore lint/style/noUnusedTemplateLiteral: pins no-substitution attribute copy
				placeholder={`Added expression placeholder`}
			/>
			<img
				// biome-ignore lint/style/noUnusedTemplateLiteral: pins a conditional no-substitution template
				alt={enabled ? "Added enabled alt" : `Added disabled alt`}
			/>
			<div title={`Added ${kind} template title`} />
			<div>{"Added JSX expression text"}</div>
			<div>{enabled && "Added JSX logical text"}</div>
			<p>{ADDED_CONST_COPY}</p>
			<button type="button" aria-label={ADDED_CONST_LABEL} />
			<div>{t("ui.fixture.keyed")}</div>
			<button type="button" aria-label={t("ui.fixture.keyed")} />
			<button
				type="button"
				aria-label={
					/* i18n: ignore product name stays English */ "Local Operator"
				}
			/>
			<div title={enabled ? "Unchanged debt one" : "Unchanged debt two"} />
			<div title={serverText} />
			<div>{"ui.fixture.raw_key"}</div>
			{items}
		</div>
	);
};

/*
 * The shape the RATCHET leaves to this guard (agent review round 1, QA Q-3): a
 * template in a `const`, a `return` or an array literal. `check-strings.mjs`
 * cannot separate prose from ids, URLs and units in that position (234 such
 * templates in the renderer), so an ADDED one is caught here, where it costs a
 * pragma on the line rather than a permanent debt entry.
 *
 * Module scope on purpose: no identifier is referenced, so the fixture stays
 * parse-only the way the rest of this file is.
 */
// biome-ignore lint/style/noUnusedTemplateLiteral: pins a no-substitution template in a const
const ADDED_PLAIN_TEMPLATE = `Added plain const sentence`;
export const ADDED_TEMPLATE_TABLE = [
	// biome-ignore lint/style/noUnusedTemplateLiteral: pins array-element templates
	`Added array sentence`,
	// biome-ignore lint/style/noUnusedTemplateLiteral: pins array-element templates
	`Added second array sentence`,
];

export const AddedTemplateFixture = ({ count }: { count: number }) => {
	// biome-ignore lint/style/noUnusedTemplateLiteral: pins a no-substitution template in a return
	if (count > 0) return `Added returned sentence`;
	return ADDED_PLAIN_TEMPLATE;
};

export const AddedTemplateToken = () => {
	// biome-ignore lint/style/noUnusedTemplateLiteral: pins a token that takes the pragma
	const machine = `template-token`; /* i18n: ignore a machine token, not copy */
	return machine;
};

/* The same machine shape WITHOUT a pragma: the rule fires on it, which is why
 * the token above needs the pragma rather than being invisible. */
// biome-ignore lint/style/noUnusedTemplateLiteral: pins a machine token that the rule still flags
export const ADDED_MACHINE_TOKEN = `machine-token`;

/* A SUBSTITUTING template with a single word and no space. It is copy — the
 * reason the sink rule may not demand a space before it fires, and the case
 * that would slip through if it did. */
declare const addedMachineCount: number;
export const ADDED_SUBSTITUTING_TEMPLATE = `${addedMachineCount}online`;
