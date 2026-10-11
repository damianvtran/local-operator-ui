#!/bin/sh
# lo-update-installer-token
#
# Why this exists: the app is about to quit so an install can replace it, and the
# installer must not be running its own check for a running instance of the app
# while one is still there - ShipIt asks that question once, as its last check
# before the swap, and an instance of the target app answers it with "abort"
# (SQRLInstallerErrorDomain Code=-9, the 2026-09-18 09:37 install). So this waits
# for the app's pid to go, and then replaces itself with the installer: one
# process, one pid for the app to record, and no shell left in the way.
while kill -0 "$1" 2>/dev/null; do
	sleep 0.2
done
exec "$LO_UPDATE_INSTALLER_SHIPIT" "$LO_UPDATE_INSTALLER_LABEL" "$LO_UPDATE_INSTALLER_STATE" >>"$LO_UPDATE_INSTALLER_LOG" 2>&1
