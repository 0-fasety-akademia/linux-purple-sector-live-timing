// SPDX-License-Identifier: GPL-2.0-or-later
// Decides when to listen to the feed, applies the TV delay and keeps the
// current session state. The indicator only reads from here.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {LiveTimingClient, DEFAULT_ENDPOINTS} from './client.js';
import {SessionState} from './state.js';
import {parseCalendar, activeSession, nextSession, SCHEDULE_URL} from './schedule.js';

const PUMP_INTERVAL_MS = 250;
const SCHEDULER_INTERVAL = 20;
const SCHEDULE_REFRESH = 6 * 3600;
const PROBE_EVERY = 15 * 60;      // no calendar: look at the feed every 15 min
const PROBE_GIVE_UP = 90;         // ...and leave if nothing is live

function now() {
    return GLib.get_real_time() / 1e6;
}

function monotonic() {
    return GLib.get_monotonic_time() / 1e6;
}

class DemoPlayer {
    constructor(file, onEvent) {
        this._file = file;
        this._onEvent = onEvent;
        this._records = [];
        this._index = 0;
        this._source = 0;
        this._cancellable = new Gio.Cancellable();
    }

    start() {
        this._file.load_contents_async(this._cancellable, (file, res) => {
            try {
                const [, bytes] = file.load_contents_finish(res);
                this._records = new TextDecoder().decode(bytes).split('\n')
                    .filter(line => line.trim()).map(line => JSON.parse(line));
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`Purple Sector Live Timing: demo data: ${e.message}`);
                return;
            }
            this._onEvent('status', 'connected');
            this._next();
        });
    }

    _next() {
        if (!this._records.length)
            return;
        if (this._index >= this._records.length)
            this._index = 0;   // loop
        const rec = this._records[this._index];
        this._onEvent(rec.kind, rec.payload);
        this._index++;
        const next = this._records[this._index % this._records.length];
        const wait = this._index < this._records.length ? Math.max(0, next.t - rec.t) : 5;
        this._source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(wait * 1000), () => {
            this._source = 0;
            this._next();
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        this._cancellable.cancel();
        if (this._source) {
            GLib.source_remove(this._source);
            this._source = 0;
        }
    }
}

export class LiveService {
    /**
     * @param {object} params
     * @param {Gio.Settings} params.settings
     * @param {Gio.File} params.dir extension directory
     * @param {Function} params.onChanged called when the display should refresh
     */
    constructor({settings, dir, onChanged}) {
        this._settings = settings;
        this._dir = dir;
        this._onChanged = onChanged;
        this.endpoints = {...DEFAULT_ENDPOINTS};

        this.state = new SessionState();
        this._queue = [];
        this._newData = false;
        this.generation = 0;   // bumped on every full snapshot
        this.connection = 'idle';
        this.sessions = [];
        this._scheduleLoaded = false;
        this._scheduleFetchedAt = 0;
        this._forced = false;
        this._connectedAt = 0;
        this._lastProbe = 0;
        this._sawLive = false;
        this._running = false;
        this._demo = null;
        this._client = new LiveTimingClient((kind, payload) => this._push(kind, payload), this.endpoints);

        this._settingsId = settings.connect('changed::demo-mode', () => this._applyMode());
        this._pumpSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PUMP_INTERVAL_MS, () => {
            this._pump();
            return GLib.SOURCE_CONTINUE;
        });
        this._schedulerSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SCHEDULER_INTERVAL, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._applyMode();
    }

    get replaying() {
        return this._demo !== null;
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        GLib.source_remove(this._pumpSource);
        GLib.source_remove(this._schedulerSource);
        this._stopFeed();
        this._client.destroy();
        this._client = null;
        this._onChanged = null;
    }

    // ---------------------------------------------------------------- modes
    _applyMode() {
        this._stopFeed();
        if (this._settings.get_boolean('demo-mode')) {
            this._demo = new DemoPlayer(this._dir.get_child('data').get_child('demo-race.jsonl'),
                (kind, payload) => this._push(kind, payload));
            this._demo.start();
        } else {
            this._loadSchedule();
            this._tick();
        }
        this._changed();
    }

    _stopFeed() {
        this._demo?.stop();
        this._demo = null;
        if (this._running) {
            this._client.stop();
            this._running = false;
        }
        this.connection = 'idle';
        this.state.reset();
        this._queue = [];
        this._sawLive = false;
    }

    _startFeed() {
        this._connectedAt = now();
        this._sawLive = false;
        this._running = true;
        this._client.start();
    }

    connectNow() {
        if (this.replaying) {
            this._settings.set_boolean('demo-mode', false);
            return;
        }
        this._forced = true;
        if (!this._running)
            this._startFeed();
        this._changed();
    }

    // ---------------------------------------------------------------- data
    _push(kind, payload) {
        if (kind === 'status') {
            this.connection = payload;
            if (payload === 'connected')
                this._connectedAt = now();
            this._changed();
            return;
        }
        this._queue.push({t: monotonic(), kind, payload});
    }

    _pump() {
        const delay = this._settings.get_int('delay-seconds');
        const t = monotonic();
        let changed = false;
        while (this._queue.length && this._queue[0].t + delay <= t) {
            const {kind, payload} = this._queue.shift();
            if (kind === 'snapshot') {
                this.generation++;
                this.state.reset();
                this.state.applySnapshot(payload);
            } else if (kind === 'feed') {
                this.state.apply(payload[0], payload[1]);
            }
            changed = true;
        }
        if (changed) {
            this._newData = true;
            this._changed();
        }
    }

    _changed() {
        this._onChanged?.();
    }

    /** Snapshot to show, or null. Before a session starts the feed still holds the previous one. */
    displaySnapshot() {
        if (this.state.isEmpty)
            return null;
        const snap = this.state.snapshot();
        if (!snap.rows.length)
            return null;
        if (!this.replaying) {
            if (snap.live || this._isCurrentSession(snap))
                this._sawLive = true;
            else if (!this._sawLive)
                return null;
        }
        return snap;
    }

    /**
     * Before a session starts the feed still holds the previous one. Results that are
     * not live count as current only once the scheduled session of the same kind has
     * started (e.g. after joining just after the chequered flag).
     */
    _isCurrentSession(snap) {
        const active = this.activeSession();
        return !!active && now() >= active.start && active.code === snap.session;
    }

    takeNewData() {
        const v = this._newData;
        this._newData = false;
        return v;
    }

    // ---------------------------------------------------------------- calendar
    _loadSchedule() {
        if (now() - this._scheduleFetchedAt < SCHEDULE_REFRESH && this._scheduleLoaded)
            return;
        this._scheduleFetchedAt = now();
        this._client.fetchJson(SCHEDULE_URL).then(data => {
            this.sessions = parseCalendar(data);
        }).catch(() => {
            // offline or API down: keep what we have, fall back to probing
        }).finally(() => {
            this._scheduleLoaded = true;
            if (this._client)
                this._tick();
        });
    }

    activeSession() {
        return activeSession(this.sessions, now());
    }

    nextSession() {
        return nextSession(this.sessions, now());
    }

    _tick() {
        if (this.replaying || !this._client)
            return;
        this._loadSchedule();
        const t = now();
        const active = this.activeSession();
        const snap = this.state.isEmpty ? null : this.state.snapshot();
        const live = !!(snap?.live && snap.rows.length);
        let want = !!active || this._forced || live;

        if (!this.sessions.length && this._scheduleLoaded && !this._running &&
            t - this._lastProbe > PROBE_EVERY) {
            this._lastProbe = t;
            this._forced = true;
            want = true;
        }

        if (want && !this._running) {
            this._startFeed();
        } else if (!want && this._running) {
            this._stopFeed();
        } else if (this._running && this._forced && !active && !live &&
                   this.connection === 'connected' && t - this._connectedAt > PROBE_GIVE_UP) {
            this._forced = false;
            this._stopFeed();
        }
        this._changed();
    }
}
