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
 * ONE CLAIM THIS FILE DOES NOT CARRY (round-1 review, R1-4): that swapping the
 * overloads for a conditional-tuple variant would fail this file. The swap was
 * re-measured and rejected all four cases anyway, so this fixture pins only
 * the SHIPPED shape's four rejections; the two-overload choice rests on §2.4's
 * spike, not on a reproducer here.
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
