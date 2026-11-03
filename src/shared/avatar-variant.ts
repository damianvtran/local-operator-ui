/*
 * WHICH SERVER AVATAR VARIANT A PLATE ASKS FOR (operator report 2026-11-03:
 * "The avatar images show up blurry in team bridge ... on retina displays").
 *
 * The hub stores and serves exactly two square derivatives of every account
 * and endpoint picture, 64 px and 256 px (agent-server
 * `internal/services/account_avatar_image.go`). The plates used to pick one by
 * CSS size alone (`size <= 64 ? 64 : 256`), so a 36 CSS px message row on a 2x
 * display drew the 64 px file across 72 device px and the 64 CSS px profile
 * card drew it across 128 — a 1.1x/2x upscale, which is the blur.
 *
 * The rule is therefore in DEVICE pixels: the smallest variant that covers
 * `ceil(cssPx * dpr)`, so every pixel the display paints comes from the file
 * rather than from interpolation. Above 256 device px nothing larger exists, so
 * 256 is the cap (no plate in this app is that big today; the account settings
 * photo at 64 CSS px x 3 = 192 still fits).
 *
 * Bandwidth stays sensible because the small variant is still chosen wherever
 * it suffices: a 20-28 CSS px rail/compose/mention plate on a 1x display stays
 * on 64, and only plates whose device size exceeds 64 move to 256.
 *
 * A DPR below 1 (browser zoomed out) is treated as 1: the plate never asks for
 * fewer pixels than its CSS size, and the cache keeps the variant count at two.
 */
export const AVATAR_VARIANTS = [64, 256] as const;
export type AvatarVariant = (typeof AVATAR_VARIANTS)[number];

export function pickAvatarVariant(cssPx: number, dpr: number): AvatarVariant {
	const ratio = Number.isFinite(dpr) && dpr > 1 ? dpr : 1;
	const css = Number.isFinite(cssPx) && cssPx > 0 ? cssPx : 0;
	const needed = Math.ceil(css * ratio);
	for (const variant of AVATAR_VARIANTS) if (variant >= needed) return variant;
	return AVATAR_VARIANTS[AVATAR_VARIANTS.length - 1];
}
