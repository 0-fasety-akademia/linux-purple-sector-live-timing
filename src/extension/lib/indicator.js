// SPDX-License-Identifier: GPL-2.0-or-later
// Panel button: icon (optionally with the top drivers) and the timing menu.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as View from './view.js';
import {versionFromMetadata, isUpdateInstalled} from './version.js';

const MAX_PANEL_ITEMS = 3;

function box(vertical, params = {}) {
    const b = new St.BoxLayout(params);
    if (vertical) {
        // St.BoxLayout:vertical was replaced by :orientation in GNOME 48 and removed in 51
        if ('orientation' in b)
            b.orientation = Clutter.Orientation.VERTICAL;
        else
            b.vertical = true;
    }
    return b;
}

function label(text, styleClass = '', params = {}) {
    return new St.Label({
        text: text ?? '',
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
        ...params,
    });
}

function colourStyle(colour) {
    const c = /^#[0-9a-fA-F]{6}$/.test(colour ?? '') ? colour : '#888888';
    return `background-color: ${c};`;
}

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension, service, settings) {
        super._init(0.0, extension.metadata.name, false);
        this._extension = extension;
        this._service = service;
        this._settings = settings;
        this._iconsDir = extension.dir.get_child('icons');
        this._model = null;
        this._modelKey = '';
        this._renderedKey = '';
        this._newVersion = '';

        this._buildPanel();

        this.menu.actor.add_style_class_name('psl-menu');
        this._root = box(true, {style_class: 'psl-popup'});
        this.menu.box.add_child(this._root);
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._checkInstalledVersion();
                this._renderMenu(true);
            }
        });

        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interfaceSettingsId = this._interfaceSettings.connect('changed::color-scheme',
            () => this.refresh());
        this._settingsId = this._settings.connect('changed', () => this.refresh());
    }

    _buildPanel() {
        this._panelBox = box(false, {style_class: 'psl-panel'});
        this._icon = new St.Icon({style_class: 'system-status-icon psl-panel-icon'});
        this._panelBox.add_child(this._icon);
        this._chip = label('', 'psl-panel-chip', {visible: false});
        this._panelBox.add_child(this._chip);
        this._items = [];
        for (let i = 0; i < MAX_PANEL_ITEMS; i++) {
            const item = box(false, {style_class: 'psl-panel-item', visible: false});
            const widgets = {
                item,
                pos: label('', 'psl-panel-pos'),
                bar: new St.Widget({style_class: 'psl-panel-bar', y_align: Clutter.ActorAlign.CENTER}),
                tla: label('', 'psl-panel-tla'),
                value: label('', 'psl-panel-value'),
                flag: this._flagIcon('psl-panel-flag'),
            };
            item.add_child(widgets.pos);
            item.add_child(widgets.bar);
            item.add_child(widgets.tla);
            item.add_child(widgets.value);
            item.add_child(widgets.flag);
            this._panelBox.add_child(item);
            this._items.push(widgets);
        }
        this._idle = label('', 'psl-panel-idle', {visible: false});
        this._panelBox.add_child(this._idle);
        this.add_child(this._panelBox);
        this._panelBox.connect('style-changed', () => this._updateIcon());
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._interfaceSettings.disconnect(this._interfaceSettingsId);
        this._interfaceSettings = null;
        super.destroy();
    }

    // ------------------------------------------------------------- model
    _options() {
        return {
            panelDrivers: this._settings.get_int('panel-drivers'),
            raceMode: this._settings.get_string('race-mode'),
            practiceMode: this._settings.get_string('practice-mode'),
            showPanelStatus: this._settings.get_boolean('show-panel-status'),
            delay: this._settings.get_int('delay-seconds'),
            replay: this._service.replaying,
            idleText: this._idleText(),
        };
    }

    _idleText() {
        const s = this._service;
        if (s.replaying)
            return _('Loading demo…');
        if (s.connection === 'connecting')
            return _('Connecting…');
        if (s.connection === 'connected') {
            const active = s.activeSession();
            if (!active)
                return _('No live session');
            const name = View.sessionLabel(active.code, _);
            return GLib.get_real_time() / 1e6 < active.start
                ? View.sprintf(_('Starting soon: %s'), name)
                : View.sprintf(_('Waiting for data: %s'), name);
        }
        const next = s.nextSession();
        if (!next)
            return '';
        const when = GLib.DateTime.new_from_unix_local(next.start);
        const days = (next.start - GLib.get_real_time() / 1e6) / 86400;
        return View.sprintf(_('Next: %s · %s'), View.sessionLabel(next.code, _),
            when.format(days < 6 ? '%a %H:%M' : '%e %b %H:%M').trim());
    }

    get dark() {
        const theme = this._settings.get_string('theme');
        if (theme === 'light' || theme === 'dark')
            return theme === 'dark';
        return this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
    }

    /** Rebuilds the view model; repaints the panel, and the menu when it is open. */
    refresh() {
        const model = View.build(this._service.displaySnapshot(), this._options(), _);
        model.dark = this.dark;
        model.expanded = this._settings.get_boolean('expanded');
        model.settings = {
            panelDrivers: this._settings.get_int('panel-drivers'),
            raceMode: this._settings.get_string('race-mode'),
            practiceMode: this._settings.get_string('practice-mode'),
        };
        const key = JSON.stringify(model);
        if (key === this._modelKey)
            return;
        this._modelKey = key;
        this._model = model;
        this._renderPanel();
        if (this.menu.isOpen)
            this._renderMenu(false);
    }

    // ------------------------------------------------------------- panel
    _updateIcon() {
        // pick the light or dark glyph by the panel's text colour
        const c = this._panelBox.get_theme_node().get_foreground_color();
        const lightText = 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue > 128;
        const live = !!this._model?.live;
        const name = `psl-panel-${lightText ? 'light' : 'dark'}${live ? '-live' : ''}.svg`;
        if (name !== this._iconName) {
            this._iconName = name;
            this._icon.gicon = new Gio.FileIcon({file: this._iconsDir.get_child(name)});
        }
    }

    _renderPanel() {
        const m = this._model;
        this._updateIcon();
        const items = m.mode === 'session' ? m.panel.items : [];
        this._items.forEach((w, i) => {
            const it = items[i];
            w.item.visible = !!it;
            if (!it)
                return;
            w.pos.text = String(it.pos);
            w.bar.style = colourStyle(it.colour);
            w.tla.text = it.tla;
            w.value.text = it.value;
            w.value.visible = !!it.value;
            w.flag.visible = it.chequered;
        });
        const chip = m.mode === 'session' ? m.panel.chip : null;
        this._chip.visible = !!chip;
        if (chip) {
            this._chip.text = chip.text;
            this._chip.style_class = `psl-panel-chip chip-${chip.kind}`;
        }
        const showIdle = m.mode === 'idle' && m.settings.panelDrivers > 0 &&
            this._settings.get_boolean('show-next-session');
        this._idle.text = showIdle ? m.idleText : '';
        this._idle.visible = showIdle && !!m.idleText;
    }

    // ------------------------------------------------------------- menu
    _renderMenu(force) {
        if (!force && this._renderedKey === this._modelKey)
            return;
        this._renderedKey = this._modelKey;
        const m = this._model;
        this._root.destroy_all_children();
        const aurora = this._settings.get_string('theme') === 'aurora' ? ' psl-aurora' : '';
        this._root.style_class = `psl-popup ${m.dark ? 'psl-dark' : 'psl-light'}${aurora}${m.expanded ? ' expanded' : ''}`;

        if (m.mode === 'session')
            this._renderSession(m);
        else
            this._renderIdle(m);

        this._root.add_child(this._separator());
        this._root.add_child(label(_('Next to the panel icon'), 'psl-caption psl-muted'));
        this._root.add_child(this._segmented(
            [[0, _('Icon only')], [1, '1'], [2, '2'], [3, '3']], m.settings.panelDrivers,
            v => this._settings.set_int('panel-drivers', v)));
        if (m.settings.panelDrivers > 0 && m.mode === 'session') {
            if (m.kind === 'race') {
                this._root.add_child(this._segmented(
                    [['leader', _('Gap to leader')], ['interval', _('Gap ahead')], ['both', _('Both')]],
                    m.settings.raceMode, v => this._settings.set_string('race-mode', v)));
            } else {
                this._root.add_child(this._segmented(
                    [['times', _('Lap times')], ['gap', _('Gap to P1')]],
                    m.settings.practiceMode, v => this._settings.set_string('practice-mode', v)));
            }
        }

        if (m.mode === 'session') {
            this._root.add_child(this._item(m.expanded ? _('Collapse table') : _('Expand table'),
                m.expanded ? 'pan-up-symbolic' : 'pan-down-symbolic',
                () => this._settings.set_boolean('expanded', !m.expanded), false));
        }
        if (m.replay) {
            this._root.add_child(this._item(_('Back to live timing'), 'media-playback-stop-symbolic',
                () => this._settings.set_boolean('demo-mode', false)));
        } else {
            if (m.mode !== 'session') {
                this._root.add_child(this._item(_('Connect now'), 'view-refresh-symbolic',
                    () => this._service.connectNow()));
            }
            this._root.add_child(this._item(_('Play demo race'), 'media-playback-start-symbolic',
                () => this._settings.set_boolean('demo-mode', true)));
        }
        this._root.add_child(this._item(_('Settings'), 'emblem-system-symbolic',
            () => this._extension.openPreferences()));
        if (!m.replay) {
            this._root.add_child(this._item(_('Refresh'), 'view-refresh-symbolic',
                () => this._service.refresh()));
        }
        if (this._newVersion) {
            // a newer package is installed, but GNOME Shell runs the old code until the next login
            this._root.add_child(this._item(View.sprintf(_('Version %s installed – log out to load it'), this._newVersion),
                'system-log-out-symbolic', () => this._logOut()));
        }
        this._root.add_child(this._item(_('Quit'), 'system-shutdown-symbolic', () => this._quit()));
    }

    _checkInstalledVersion() {
        const running = this._extension.metadata['version-name'] ?? '';
        let installed = '';
        try {
            const [ok, bytes] = this._extension.dir.get_child('metadata.json').load_contents(null);
            if (ok)
                installed = versionFromMetadata(new TextDecoder().decode(bytes));
        } catch {
            // file gone (package being replaced): nothing to offer
        }
        this._newVersion = isUpdateInstalled(running, installed) ? installed : '';
    }

    _logOut() {
        try {
            Gio.Subprocess.new(['gnome-session-quit', '--logout'], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'Purple Sector: log out');
        }
    }

    // Quit = switch the extension off (like the switch in the Extensions app); it stays off until switched on there
    _quit() {
        const uuid = this._extension.uuid;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            Main.extensionManager.disableExtension(uuid);
            return GLib.SOURCE_REMOVE;
        });
    }

    _renderIdle(m) {
        const head = box(true, {style_class: 'psl-head'});
        head.add_child(label(this._extension.metadata.name, 'psl-title'));
        head.add_child(label(m.idleText || _('No live session'), 'psl-muted'));
        this._root.add_child(head);
    }

    _renderSession(m) {
        const head = box(true, {style_class: 'psl-head'});
        const top = box(false);
        top.add_child(label(m.title, 'psl-title', {x_expand: true}));
        if (m.replay)
            top.add_child(label(_('DEMO'), 'psl-live'));
        else if (m.live)
            top.add_child(label(`● ${_('LIVE')}`, 'psl-live'));
        head.add_child(top);
        const sub = box(false, {style_class: 'psl-subrow'});
        sub.add_child(label(m.track.text, `psl-chip chip-${m.track.kind}`));
        sub.add_child(label(m.info, 'psl-info psl-muted'));
        head.add_child(sub);
        this._root.add_child(head);
        this._root.add_child(this._separator());

        const cols = box(false, {style_class: 'psl-cols psl-muted'});
        cols.add_child(label('P', 'psl-pos'));
        cols.add_child(label(_('Driver').toUpperCase(), '', {x_expand: true}));
        cols.add_child(label(m.columns.main[0].toUpperCase(), 'psl-c1'));
        cols.add_child(label(m.columns.main[1].toUpperCase(), 'psl-c2'));
        if (m.expanded) {
            const sample = m.sections[0]?.rows[0]?.ext ?? [];
            m.columns.ext.forEach((title, i) => {
                const cell = sample[i] ?? {};
                const cls = cell.tyre ? 'psl-tyrecell' : `psl-ext${cell.narrow ? ' narrow' : ''}`;
                cols.add_child(label(title.toUpperCase(), cls));
            });
        }
        this._root.add_child(cols);

        const list = box(true);
        let n = 0;
        for (const section of m.sections) {
            if (section.title)
                list.add_child(this._divider(section.title, section.style));
            for (const r of section.rows)
                list.add_child(this._row(r, section.style, n++, m.expanded));
        }
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        scroll.set_child(list);
        const monitor = Main.layoutManager.primaryMonitor;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const maxHeight = Math.max(240, Math.floor((monitor?.height ?? 900) / scale) - 360);
        scroll.style = `max-height: ${maxHeight}px;`;
        this._root.add_child(scroll);

        const legend = box(false, {style_class: 'psl-legend psl-muted'});
        legend.add_child(label('■', 'purple'));
        legend.add_child(label(m.kind === 'race' ? _('fastest lap') : _('best time'), 'psl-muted'));
        if (m.expanded) {
            legend.add_child(label('■', 'green'));
            legend.add_child(label(_('personal best'), 'psl-muted'));
        }
        legend.add_child(label(m.footer, 'psl-muted', {x_expand: true, x_align: Clutter.ActorAlign.END}));
        this._root.add_child(legend);
    }

    _flagIcon(styleClass) {
        return new St.Icon({
            gicon: new Gio.FileIcon({file: this._iconsDir.get_child('psl-chequered.svg')}),
            style_class: styleClass,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _separator() {
        return new St.Widget({style_class: 'psl-separator'});
    }

    _divider(title, style) {
        const d = box(false, {style_class: `psl-divider ${style}`});
        const line = () => new St.Widget({
            style_class: 'psl-divider-line',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        d.add_child(line());
        d.add_child(label(title.toUpperCase()));
        d.add_child(line());
        return d;
    }

    _tyreCell(tyre) {
        const cell = box(false, {style_class: 'psl-tyrecell'});
        if (tyre.text) {
            cell.add_child(label(tyre.text, `psl-tyre ${tyre.style}`));
            cell.add_child(label(tyre.age, 'psl-muted'));
        }
        return cell;
    }

    _row(r, sectionStyle, index, expanded) {
        let cls = 'psl-row';
        if (sectionStyle === 'danger')
            cls += ' danger';
        else if (expanded && index % 2 === 1)
            cls += ' alt';
        if (r.dim)
            cls += ' dim';
        const row = box(false, {style_class: cls});
        row.add_child(label(String(r.pos), 'psl-pos psl-muted'));
        const driver = box(false, {x_expand: true, style_class: 'psl-driver'});
        driver.add_child(new St.Widget({style_class: 'psl-bar', style: colourStyle(r.colour),
            y_align: Clutter.ActorAlign.CENTER}));
        driver.add_child(label(r.tla, 'psl-tla'));
        if (r.chequered)
            driver.add_child(this._flagIcon('psl-flag'));
        if (expanded)
            driver.add_child(label(r.name, 'psl-name psl-muted'));
        for (const tag of r.tags)
            driver.add_child(label(tag.text, `psl-tag ${tag.style}`));
        row.add_child(driver);
        row.add_child(label(r.c1, `psl-c1 ${r.c1Style}`));
        row.add_child(label(r.c2, 'psl-c2 psl-muted'));
        if (expanded) {
            for (const cell of r.ext) {
                if (cell.tyre)
                    row.add_child(this._tyreCell(cell.tyre));
                else
                    row.add_child(label(cell.text, `psl-ext${cell.narrow ? ' narrow' : ''} ${cell.style}`));
            }
        }
        return row;
    }

    _segmented(options, current, onPick) {
        const seg = box(false, {style_class: 'psl-segmented'});
        for (const [key, text] of options) {
            const button = new St.Button({
                label: text,
                style_class: 'psl-segment',
                toggle_mode: true,
                checked: key === current,
                x_expand: true,
                can_focus: true,
            });
            button.connect('clicked', () => onPick(key));
            seg.add_child(button);
        }
        return seg;
    }

    _item(text, iconName, onClick, closeMenu = true) {
        const button = new St.Button({style_class: 'psl-item', can_focus: true, x_expand: true});
        const content = box(false, {style_class: 'psl-item-box', x_expand: true});
        content.add_child(label(text, '', {x_expand: true}));
        content.add_child(new St.Icon({icon_name: iconName, icon_size: 14, y_align: Clutter.ActorAlign.CENTER}));
        button.set_child(content);
        button.connect('clicked', () => {
            if (closeMenu)
                this.menu.close();
            onClick();
        });
        return button;
    }
});
