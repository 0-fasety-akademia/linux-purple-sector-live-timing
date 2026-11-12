// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const SETTING_FOR = {
    'session-start': 'notify-session-start',
    'leader-change': 'notify-leader-change',
    'flags': 'notify-flags',
    'finish': 'notify-finish',
};

export class Notifier {
    constructor(settings, iconFile, title) {
        this._settings = settings;
        this._icon = new Gio.FileIcon({file: iconFile});
        this._title = title;
        this._source = null;
    }

    notify(events) {
        if (!this._settings.get_boolean('notifications'))
            return;
        for (const event of events) {
            if (!this._settings.get_boolean(SETTING_FOR[event.kind]))
                continue;
            const source = this._getSource();
            const notification = new MessageTray.Notification({
                source,
                title: event.title,
                body: event.body,
                isTransient: true,
            });
            source.addNotification(notification);
        }
    }

    _getSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: this._title, icon: this._icon});
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    destroy() {
        this._source?.destroy();
        this._source = null;
    }
}
