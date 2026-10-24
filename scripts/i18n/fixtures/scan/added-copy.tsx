/* Fixture only: the real scanner excludes this directory. */
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
			<button type="button" aria-label={t("ui.fixture.keyed")} />
			<button
				type="button"
				aria-label={
					/* i18n: ignore product name stays English */ "Local Operator"
				}
			/>
			<div title={enabled ? "Unchanged debt one" : "Unchanged debt two"} />
			<div title={serverText} />
			{items}
		</div>
	);
};
