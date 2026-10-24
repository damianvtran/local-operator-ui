/**
 * Fixture: a second counted corpus for `--init`'s three-way summary.
 *
 * `--init` classifies a missing entry, a raised ceiling and a lowered ceiling
 * in one run, and each needs its own file. The product tree is fully extracted
 * (zero findings by design), so the classification is exercised on fixtures;
 * this one carries exactly the two shapes the scanner counts - an attribute and
 * JSX text.
 */
export function FixtureCopyNarrow() {
	return (
		<button type="button" title="Fixture tooltip">
			Fixture action
		</button>
	);
}
