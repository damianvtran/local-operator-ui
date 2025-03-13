/**
 * Installation Scripts
 *
 * This module exports installation scripts for different operating systems.
 * Scripts are imported as raw strings from .sh files.
 */

import macosInstallScriptRaw from "./macos-install-script.sh?raw";
import linuxInstallScriptRaw from "./linux-install-script.sh?raw";
import windowsInstallScriptRaw from "./windows-install-script.ps1?raw";

export const macosInstallScript = macosInstallScriptRaw;
export const linuxInstallScript = linuxInstallScriptRaw;
export const windowsInstallScript = windowsInstallScriptRaw;
