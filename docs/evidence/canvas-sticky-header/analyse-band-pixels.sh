#!/usr/bin/env bash
#
# MEASURE the band, in pixels, for every before/after frame.
#
# The claim under test is not "the band got darker" - a darker band proves
# nothing about whether a file name is still READABLE through it. The claim is
# "content passing under the band is blurred and dimmed, never readable through
# it", and the number that answers it is the HIGH-FREQUENCY ENERGY in the
# band: text and thumbnail edges are high-frequency, and a blur removes them.
#
# THE MEASUREMENT, PER FRAME:
#
#   band_sd    the band strip's pixel standard deviation. Its mean tells the
#              story of the DIM (how much light the band takes away).
#   band_detail  the band strip's standard deviation AFTER a 3px blur, which
#              isolates the high-frequency content: a sharp file name keeps a
#              high value here, a blurred one loses it. This is the
#              "is it still legible" number.
#   control_*  the same two numbers for the strip immediately BELOW the band.
#              The control is the content at full sharpness, so
#              band_detail / control_detail is the RATIO of what survives
#              into the band. A ratio near 1 means the band is showing
#              content; a ratio well under 1 means it is not.
#
# The strips are taken in the FILES PANE's own x-range (the pane starts at
# x=1568 device pixels at 2x), so the sidebar's text cannot pollute the
# measurement.
set -euo pipefail

RIG="${1:?usage: analyse-band-pixels.sh <rig-dir>}"
BEFORE="$RIG/frames-before"
AFTER="$RIG/frames-after"
MAGICK=/opt/homebrew/bin/magick

# The Files pane's x-range in the 2760px-wide frame, and the band's y-range
# (the header is CSS 152..184 at 2x, so device 304..368), plus the control
# strip immediately below it.
#
# THE STRIP IS LABEL-FREE ON PURPOSE. The band's own "Images 86" label is
# sharp text, so a strip that includes it measures the LABEL's detail, not the
# content behind the band. The strip therefore starts at device x=2100, which
# is past the end of the label (it ends at ~1955) and inside the pane (which
# ends at 2640), so what it measures is the thumbnail that passes under.
XPAN="540x64+2100+304"
XCTL="540x64+2100+400"

measure() {
	local file="$1"
	local band_sd band_detail ctl_sd ctl_detail band_sat ctl_sat
	band_sd=$("$MAGICK" "$file" -crop "$XPAN" +repage -colorspace Gray -format "%[fx:standard_deviation]" info:)
	band_detail=$("$MAGICK" "$file" -crop "$XPAN" +repage -colorspace Gray -blur 0x3 -format "%[fx:standard_deviation]" info:)
	ctl_sd=$("$MAGICK" "$file" -crop "$XCTL" +repage -colorspace Gray -format "%[fx:standard_deviation]" info:)
	ctl_detail=$("$MAGICK" "$file" -crop "$XCTL" +repage -colorspace Gray -blur 0x3 -format "%[fx:standard_deviation]" info:)
	# SATURATION: the defect the operator photographed is a thumbnail's GREEN
	# filling the band, so the band's colourfulness against the control's is
	# the most direct number for it.
	band_sat=$("$MAGICK" "$file" -crop "$XPAN" +repage -colorspace HSL -channel G -separate +channel -format "%[fx:standard_deviation]" info:)
	ctl_sat=$("$MAGICK" "$file" -crop "$XCTL" +repage -colorspace HSL -channel G -separate +channel -format "%[fx:standard_deviation]" info:)
	python3 - "$band_sd" "$band_detail" "$ctl_sd" "$ctl_detail" "$band_sat" "$ctl_sat" <<'PY'
import sys
band_sd, band_detail, ctl_sd, ctl_detail, band_sat, ctl_sat = (float(v) for v in sys.argv[1:7])
ratio = band_detail / ctl_detail if ctl_detail else float("nan")
print(
    f"band_sd={band_sd:.4f} band_detail={band_detail:.4f} "
    f"control_sd={ctl_sd:.4f} control_detail={ctl_detail:.4f} "
    f"survives_into_band={ratio:.3f} band_sat={band_sat:.4f} control_sat={ctl_sat:.4f}"
)
PY
}

printf "%-28s %s\n" "FRAME" "MEASUREMENT"
for dir in "$BEFORE" "$AFTER"; do
	[ -d "$dir" ] || continue
	for f in "$dir"/*.png; do
		[ -e "$f" ] || continue
		name=$(basename "$f")
		printf "%-28s %s\n" "$name" "$(measure "$f")"
	done
done
