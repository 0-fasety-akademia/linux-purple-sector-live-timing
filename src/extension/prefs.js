// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function comboRow(settings, key, title, choices, subtitle = '') {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });
    const sync = () => {
        const index = choices.findIndex(([value]) => value === settings.get_string(key));
        row.selected = Math.max(index, 0);
    };
    sync();
    row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper) {
    const row = Adw.SpinRow.new_with_range(lower, upper, 1);
    row.title = title;
    row.subtitle = subtitle;
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function infoRow(title, value) {
    const row = new Adw.ActionRow({title});
    row.add_suffix(new Gtk.Label({label: value, css_classes: ['dim-label']}));
    return row;
}

export default class PurpleSectorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            name: 'settings',
            title: _('Settings'),
            icon_name: 'emblem-system-symbolic',
        });
        window.add(page);

        const panel = new Adw.PreferencesGroup({title: _('Top bar')});
        panel.add(spinRow(settings, 'panel-drivers', _('Drivers next to the icon'),
            _('0 shows the icon only'), 0, 3));
        panel.add(comboRow(settings, 'race-mode', _('Race and sprint'), [
            ['leader', _('Gap to leader')], ['interval', _('Gap to the car ahead')], ['both', _('Both')],
        ]));
        panel.add(comboRow(settings, 'practice-mode', _('Practice and qualifying'), [
            ['times', _('Lap times')], ['gap', _('Gap to P1')],
        ]));
        panel.add(switchRow(settings, 'show-panel-status', _('Show lap or remaining time')));
        panel.add(switchRow(settings, 'show-next-session', _('Show the next session when nothing is live')));
        page.add(panel);

        const timing = new Adw.PreferencesGroup({title: _('Timing')});
        timing.add(spinRow(settings, 'delay-seconds', _('Delay (seconds)'),
            _('Hold results back to stay in sync with the TV broadcast'), 0, 60));
        timing.add(switchRow(settings, 'demo-mode', _('Demo race'),
            _('Play a recorded race with fictional drivers instead of the live feed')));
        page.add(timing);

        const notifications = new Adw.PreferencesGroup({title: _('Notifications')});
        notifications.add(switchRow(settings, 'notifications', _('Show notifications')));
        const details = [
            ['notify-session-start', _('Session start')],
            ['notify-leader-change', _('New race leader')],
            ['notify-flags', _('Safety Car, VSC and red flag')],
            ['notify-finish', _('Finish with the top three')],
        ];
        for (const [key, title] of details) {
            const row = switchRow(settings, key, title);
            settings.bind('notifications', row, 'sensitive', Gio.SettingsBindFlags.GET);
            notifications.add(row);
        }
        page.add(notifications);

        const look = new Adw.PreferencesGroup({title: _('Appearance')});
        look.add(comboRow(settings, 'theme', _('Menu style'), [
            ['auto', _('Follow system')], ['light', _('Light')], ['dark', _('Dark')],
        ]));
        page.add(look);

        const aboutPage = new Adw.PreferencesPage({name: 'about', title: _('About'), icon_name: 'help-about-symbolic'});
        window.add(aboutPage);
        const header = new Adw.PreferencesGroup();
        const headerBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 12});
        headerBox.append(new Gtk.Image({
            file: this.dir.get_child('icons').get_child('psl-app-light.svg').get_path(),
            pixel_size: 96,
        }));
        headerBox.append(new Gtk.Label({label: this.metadata.name, css_classes: ['title-1']}));
        header.add(headerBox);
        aboutPage.add(header);

        const credits = new Adw.PreferencesGroup();
        credits.add(infoRow(_('Created by:'), 'JGu'));
        credits.add(infoRow(_('Supported by'), 'Claude'));
        const link = new Adw.ActionRow({title: _('Source code and issues'), activatable: true});
        link.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        link.connect('activated', () => new Gtk.UriLauncher({uri: this.metadata.url}).launch(window, null, null));
        credits.add(link);
        aboutPage.add(credits);

        const note = new Adw.PreferencesGroup({
            description: _('Unofficial project, not affiliated with any racing series or its organisers. ' +
                'Results come from the public live timing feed, the session calendar from the Jolpica API. ' +
                'The demo race uses fictional drivers and teams.'),
        });
        aboutPage.add(note);
    }
}
