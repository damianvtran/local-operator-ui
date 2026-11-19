/*
 * Fixture for `scripts/i18n/check-strings.test.mjs` - NOT product code.
 *
 * The prose-carrying PROPS the scanner counts beyond the four native attributes
 * (`COPY_ATTRIBUTES`). Section one carries a literal on every one of them and
 * must be flagged, one finding per attribute; section two carries the keyed
 * spelling (`t("ui.x")`) of every one and must produce nothing; section three
 * pins the expression forms (conditional arm, template span, `??` fallback,
 * `+` concatenation) and the shapes that are NOT prose (a call, an identifier,
 * a numeric-only string, a pragma-exempt token). The test pins findings by
 * attribute name, not by line, so adding a case here does not renumber it.
 */

declare const Widget: (props: Record<string, unknown>) => unknown;
declare const t: (key: string, values?: Record<string, unknown>) => string;
declare const name: string;
declare const flag: boolean;
declare const maybe: string | undefined;

/* Section one: a literal on each counted prop. */
export const Literals = () => (
	<>
		<Widget label="Literal label" />
		<Widget content="Literal content" />
		<Widget description="Literal description" />
		<Widget closeLabel="Literal closeLabel" />
		<Widget busyLabel="Literal busyLabel" />
		<Widget titleText="Literal titleText" />
		<Widget helperText="Literal helperText" />
		<Widget saveLabel="Literal saveLabel" />
		<Widget dirtyHint="Literal dirtyHint" />
		<Widget text="Literal text" />
		<Widget verb="Literal verb" />
		<Widget summary="Literal summary" />
		<Widget ariaLabel="Literal ariaLabel" />
		<Widget actionLabel="Literal actionLabel" />
		<Widget pendingLabel="Literal pendingLabel" />
		<Widget blockedReason="Literal blockedReason" />
		<Widget empty="Literal empty" />
		<Widget emptyText="Literal emptyText" />
		<Widget header="Literal header" />
		<Widget hint="Literal hint" />
		<Widget listNotice="Literal listNotice" />
		<Widget meaning="Literal meaning" />
		<Widget what="Literal what" />
		<Widget srLabel="Literal srLabel" />
		<Widget triggerLabel="Literal triggerLabel" />
	</>
);

/* Section two: the keyed spelling of each - nothing to report. */
export const Keyed = () => (
	<>
		<Widget label={t("ui.fixture.label")} />
		<Widget content={t("ui.fixture.content")} />
		<Widget description={t("ui.fixture.description")} />
		<Widget closeLabel={t("ui.fixture.closeLabel")} />
		<Widget busyLabel={t("ui.fixture.busyLabel")} />
		<Widget titleText={t("ui.fixture.titleText")} />
		<Widget helperText={t("ui.fixture.helperText")} />
		<Widget saveLabel={t("ui.fixture.saveLabel")} />
		<Widget dirtyHint={t("ui.fixture.dirtyHint")} />
		<Widget text={t("ui.fixture.text")} />
		<Widget verb={t("ui.fixture.verb")} />
		<Widget summary={t("ui.fixture.summary")} />
		<Widget ariaLabel={t("ui.fixture.ariaLabel")} />
		<Widget actionLabel={t("ui.fixture.actionLabel")} />
		<Widget pendingLabel={t("ui.fixture.pendingLabel")} />
		<Widget blockedReason={t("ui.fixture.blockedReason")} />
		<Widget empty={t("ui.fixture.empty")} />
		<Widget emptyText={t("ui.fixture.emptyText")} />
		<Widget header={t("ui.fixture.header")} />
		<Widget hint={t("ui.fixture.hint")} />
		<Widget listNotice={t("ui.fixture.listNotice")} />
		<Widget meaning={t("ui.fixture.meaning")} />
		<Widget what={t("ui.fixture.what")} />
		<Widget srLabel={t("ui.fixture.srLabel")} />
		<Widget triggerLabel={t("ui.fixture.triggerLabel")} />
	</>
);

/* Section three: expression forms and non-prose. */
export const Expressions = () => (
	<>
		<Widget label={flag ? "Conditional arm A" : "Conditional arm B"} />
		<Widget content={`Template span ${name}`} />
		<Widget description={maybe ?? "Fallback prose"} />
		{/* biome-ignore lint/style/useTemplate: the fixture pins the `+` operand form */}
		<Widget summary={"Concatenated " + name} />
		<Widget verb={flag && "Guarded prose"} />
		<Widget label={name} />
		<Widget label={t("ui.fixture.expression")} />
		<Widget label={flag ? t("ui.fixture.a") : t("ui.fixture.b")} />
		<Widget text="42" />
		<Widget header="..." />
		<Widget
			// i18n: ignore a stable test hook, not copy
			label="exempt-token"
		/>
	</>
);
