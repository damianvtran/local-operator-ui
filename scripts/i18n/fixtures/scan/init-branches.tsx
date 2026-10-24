/**
 * Fixture: one literal of each shape `--init`'s summary can classify.
 *
 * The extraction programme localizes the product's copy, so `pnpm check-i18n`
 * legitimately has no findings left to count in `src/`. `--init` and
 * `--update` still need a corpus that HAS counts to exercise their branches;
 * this file is it. It is never loaded by the app - the scanner only reads it
 * when a test names it in `extraScan`.
 */
export function InitBranches() {
	return (
		<div>
			<span aria-label="Fixture label">Fixture text</span>
			<input placeholder="Fixture placeholder" />
		</div>
	);
}
