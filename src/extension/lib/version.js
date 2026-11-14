// SPDX-License-Identifier: GPL-2.0-or-later
// Version of the extension: the one GNOME Shell loaded at login vs the one installed on disk now.
// GNOME Shell keeps an extension's code in memory until the next login (on Wayland it cannot reload it),
// so after a package update the menu offers to log out.

/** "version-name" from the text of a metadata.json, or '' */
export function versionFromMetadata(text) {
    try {
        const v = JSON.parse(text)['version-name'];
        return typeof v === 'string' ? v : '';
    } catch {
        return '';
    }
}

/** true when `installed` is a different, non-empty version than `running` */
export function isUpdateInstalled(running, installed) {
    return !!installed && !!running && installed !== running;
}
