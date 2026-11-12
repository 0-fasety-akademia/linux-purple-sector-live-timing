// SPDX-License-Identifier: GPL-2.0-or-later
// Purple Sector Live Timing – live session results in the top bar.
// Created by: JGu · Supported by Claude

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Indicator} from './lib/indicator.js';
import {LiveService} from './lib/service.js';
import {Notifier} from './lib/notifier.js';
import {diffEvents} from './lib/view.js';

export default class PurpleSectorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._notifier = new Notifier(this._settings,
            this.dir.get_child('icons').get_child('psl-app-dark.svg'), this.metadata.name);
        this._lastSnapshot = null;
        this._lastGeneration = -1;
        this._service = new LiveService({
            settings: this._settings,
            dir: this.dir,
            onChanged: () => this._onServiceChanged(),
        });
        this._indicator = new Indicator(this, this._service, this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator.refresh();
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._service?.destroy();
        this._service = null;
        this._notifier?.destroy();
        this._notifier = null;
        this._settings = null;
        this._lastSnapshot = null;
    }

    _onServiceChanged() {
        if (!this._indicator)
            return;
        if (this._service.takeNewData()) {
            const snap = this._service.displaySnapshot();
            // compare only within one session, and stay quiet during the demo
            if (this._service.generation !== this._lastGeneration) {
                this._lastGeneration = this._service.generation;
                this._lastSnapshot = null;
            }
            if (snap && this._lastSnapshot && !this._service.replaying)
                this._notifier.notify(diffEvents(this._lastSnapshot, snap, _));
            this._lastSnapshot = snap;
        }
        this._indicator.refresh();
    }
}
