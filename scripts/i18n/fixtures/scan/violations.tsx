/*
 * Fixture for `scripts/i18n/check-strings.test.mjs` — NOT product code.
 *
 * Every shape the scanner must flag, and the neighbouring shapes it must NOT,
 * on lines the test pins by number. The fixture directory is excluded from the
 * real scan (`SCAN_EXCLUDED`), which is exactly why it can live inside
 * `scripts/i18n/` at all.
 *
 * The exemption placements show the rule: a pragma exempts a finding when it
 * sits inside the flagged node's own span, or inside the node's NEAREST
 * enclosing JSX element — so the comment goes inside the element whose copy it
 * is about, and a pragma in an outer wrapper does NOT reach into a nested
 * element (the test pins both directions).
 */

export const ScanFixture = () => (
	<div>
		<span>
			{/* i18n: ignore the fixture pins the exemption, so this text is exempt */}
			Exempt text
		</span>
		<span>Flagged text</span>
		<span>{count} items</span>
		<span>·</span>
		<span>—</span>
		<span>42</span>
		<button type="button" aria-label="Flagged aria">
			Nested flagged text
		</button>
		<img alt="Flagged alt" src="x.png" />
		<input placeholder="Flagged placeholder" />
		<button
			type="button"
			// i18n: ignore icon-only control
			aria-label="Exempt aria"
			title="Exempt title"
		>
			Exempt ok
		</button>
		{/* i18n: ignore */}
		<span>Reasonless pragma is not an exemption</span>
		<button type="button" aria-label={choose()}>
			Flagged ok
		</button>
		<div>
			<span>Nested text</span>
			{/* i18n: ignore the outer element's pragma does not reach the nested span */}
		</div>
		<div title="Flagged title">Tail</div>
	</div>
);
