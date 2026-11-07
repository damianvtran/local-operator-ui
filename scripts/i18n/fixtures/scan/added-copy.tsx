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
