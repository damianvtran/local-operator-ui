/*
 * Fixture for `scripts/i18n/typed-keys.test.mjs` — NOT product code.
 *
 * The four negative cases RFC §2.4 proved for the two-overload shape. Each
 * `@ts-expect-error` is the assertion: the directive FAILS THE BUILD when the
 * next line does NOT error (TS2578), so a green compile of this file means all
 * four were rejected. The test ALSO strips the directives into a control file
 * and requires that compile to fail, which is what proves the four errors are
 * real rather than the directives being merely tolerated.
 *
 * If a future edit replaces the overloads with the conditional-tuple variant
 * §2.4 rejects (`...args: Params extends undefined ? [] : [p: Params]`), case 3
 * (missing parameters) stops erroring: its directive becomes unused and this
 * file stops compiling — the regression the spike measured, pinned.
 */

import { t } from "./messages";

// @ts-expect-error not a key: neither overload's constraint accepts it
t("demo.words.nope");

// @ts-expect-error wrong parameter type: plural arguments are numbers
t("demo.words.files", { count: "three" });

// @ts-expect-error missing required parameters
t("demo.words.files");

// @ts-expect-error params on a key whose message has none
t("demo.words.plain", { count: 1 });
