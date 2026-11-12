// SPDX-License-Identifier: GPL-2.0-or-later
// Live timing feed client (SignalR over WebSocket, libsoup 3).
//
// The SignalR Core endpoint is tried first; if negotiation fails the
// classic SignalR endpoint is used. Both send a full state as the result
// of the Subscribe call and then "feed" messages with deltas.
//
// Events go to onEvent(kind, payload):
//   'snapshot', {topic: data, ...}
//   'feed',     [topic, data]
//   'status',   'connecting' | 'connected' | 'disconnected'

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export const TOPICS = [
    'Heartbeat', 'SessionInfo', 'SessionStatus', 'TrackStatus', 'LapCount',
    'ExtrapolatedClock', 'DriverList', 'TimingData', 'TimingAppData',
    'TimingStats', 'TopThree', 'WeatherData', 'RaceControlMessages',
];

const RS = '\x1e';
const PING_INTERVAL = 15;
const SILENCE_LIMIT = 90;
const MAX_PAYLOAD = 32 * 1024 * 1024;
const REQUEST_TIMEOUT = 20;

export const DEFAULT_ENDPOINTS = {
    http: 'https://livetiming.formula1.com',
    ws: 'wss://livetiming.formula1.com',
};

export class LiveTimingClient {
    constructor(onEvent, endpoints = DEFAULT_ENDPOINTS) {
        this._onEvent = onEvent;
        this._endpoints = endpoints;
        // no socket timeout: the WebSocket may stay quiet between sessions; HTTP requests
        // get their own timeout and the open socket is watched by _startPing()
        this._session = new Soup.Session({timeout: 0, user_agent: 'purple-sector-live-timing'});
        this._session.add_feature(new Soup.CookieJar());
        this._decoder = new TextDecoder();
        this._conn = null;
        this._connSignals = [];
        this._stopped = true;
        this._retrySource = 0;
        this._pingSource = 0;
        this._backoff = 3;
        this._lastData = 0;
        this._warned = false;
    }

    start() {
        this._stopped = false;
        this._connect();
    }

    stop() {
        this._stopped = true;
        if (this._retrySource) {
            GLib.source_remove(this._retrySource);
            this._retrySource = 0;
        }
        this._closeConnection();
        this._session.abort();
    }

    destroy() {
        this.stop();
        this._session = null;
        this._onEvent = null;
    }

    /** Plain GET of a JSON document (used for the season calendar). */
    fetchJson(url) {
        return this._request('GET', url);
    }

    _emit(kind, payload) {
        this._onEvent?.(kind, payload);
    }

    async _connect() {
        this._emit('status', 'connecting');
        try {
            try {
                await this._connectCore();
            } catch (coreError) {
                if (this._stopped)
                    return;
                await this._connectLegacy(coreError);
            }
            this._backoff = 3;
            this._warned = false;
        } catch (e) {
            if (this._stopped)
                return;
            if (!this._warned) {
                console.warn(`Purple Sector Live Timing: cannot connect: ${e.message}`);
                this._warned = true;
            }
            this._scheduleRetry();
        }
    }

    _scheduleRetry() {
        if (this._stopped || this._retrySource)
            return;
        this._emit('status', 'disconnected');
        this._retrySource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._backoff, () => {
            this._retrySource = 0;
            this._connect();
            return GLib.SOURCE_REMOVE;
        });
        this._backoff = Math.min(this._backoff * 2, 60);
    }

    _withTimeout(start) {
        const cancellable = new Gio.Cancellable();
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REQUEST_TIMEOUT, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        return new Promise((resolve, reject) => {
            start(cancellable, (finish, res) => {
                GLib.source_remove(timeoutId);
                try {
                    resolve(finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _request(method, url) {
        const msg = Soup.Message.new(method, url);
        return this._withTimeout((cancellable, done) =>
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable,
                (session, res) => done(r => {
                    const bytes = session.send_and_read_finish(r);
                    if (msg.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${msg.get_status()} for ${url}`);
                    return JSON.parse(this._decoder.decode(bytes.toArray()));
                }, res)));
    }

    _openSocket(url) {
        const msg = Soup.Message.new('GET', url);
        return this._withTimeout((cancellable, done) =>
            this._session.websocket_connect_async(msg, null, null, GLib.PRIORITY_DEFAULT, cancellable,
                (session, res) => done(r => session.websocket_connect_finish(r), res)));
    }

    async _connectCore() {
        const neg = await this._request('POST', `${this._endpoints.http}/signalrcore/negotiate?negotiateVersion=1`);
        const token = neg.connectionToken ?? neg.connectionId;
        if (!token)
            throw new Error('no connection token');
        const conn = await this._openSocket(`${this._endpoints.ws}/signalrcore?id=${encodeURIComponent(token)}`);
        this._attach(conn, text => this._onCoreText(text));
        conn.send_text(JSON.stringify({protocol: 'json', version: 1}) + RS);
        conn.send_text(JSON.stringify({type: 1, invocationId: '1', target: 'Subscribe', arguments: [TOPICS]}) + RS);
        this._startPing(() => conn.send_text(JSON.stringify({type: 6}) + RS));
    }

    async _connectLegacy() {
        const data = encodeURIComponent(JSON.stringify([{name: 'Streaming'}]));
        const neg = await this._request('GET',
            `${this._endpoints.http}/signalr/negotiate?connectionData=${data}&clientProtocol=1.5`);
        const token = encodeURIComponent(neg.ConnectionToken ?? '');
        const conn = await this._openSocket(`${this._endpoints.ws}/signalr/connect?clientProtocol=1.5` +
            `&transport=webSockets&connectionToken=${token}&connectionData=${data}`);
        this._attach(conn, text => this._onLegacyText(text));
        conn.send_text(JSON.stringify({H: 'Streaming', M: 'Subscribe', A: [TOPICS], I: 1}));
        this._startPing(null);
    }

    _attach(conn, onText) {
        if (this._stopped) {
            conn.close(Soup.WebsocketCloseCode.NORMAL, null);
            throw new Error('stopped');
        }
        conn.max_incoming_payload_size = MAX_PAYLOAD;
        this._conn = conn;
        this._lastData = GLib.get_monotonic_time() / 1e6;
        this._connSignals = [
            conn.connect('message', (_c, type, bytes) => {
                this._lastData = GLib.get_monotonic_time() / 1e6;
                if (type === Soup.WebsocketDataType.TEXT)
                    onText(this._decoder.decode(bytes.toArray()));
            }),
            conn.connect('closed', () => {
                this._closeConnection();
                this._scheduleRetry();
            }),
        ];
        this._emit('status', 'connected');
    }

    _startPing(ping) {
        this._pingSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PING_INTERVAL, () => {
            const silent = GLib.get_monotonic_time() / 1e6 - this._lastData;
            if (silent > SILENCE_LIMIT) {
                this._closeConnection();
                this._scheduleRetry();
                return GLib.SOURCE_REMOVE;
            }
            ping?.();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _closeConnection() {
        if (this._pingSource) {
            GLib.source_remove(this._pingSource);
            this._pingSource = 0;
        }
        const conn = this._conn;
        this._conn = null;
        if (!conn)
            return;
        this._connSignals.forEach(id => conn.disconnect(id));
        this._connSignals = [];
        if (conn.get_state() === Soup.WebsocketState.OPEN)
            conn.close(Soup.WebsocketCloseCode.NORMAL, null);
    }

    _onCoreText(text) {
        for (const frame of text.split(RS)) {
            if (!frame.trim())
                continue;
            let msg;
            try {
                msg = JSON.parse(frame);
            } catch {
                continue;
            }
            if (msg.type === 1 && String(msg.target).toLowerCase() === 'feed' && msg.arguments?.length >= 2)
                this._emit('feed', [msg.arguments[0], msg.arguments[1]]);
            else if (msg.type === 3 && msg.result && typeof msg.result === 'object')
                this._emit('snapshot', msg.result);
        }
    }

    _onLegacyText(text) {
        let msg;
        try {
            msg = JSON.parse(text);
        } catch {
            return;
        }
        if (msg.R && typeof msg.R === 'object')
            this._emit('snapshot', msg.R);
        for (const m of msg.M ?? []) {
            if (String(m.M).toLowerCase() === 'feed' && m.A?.length >= 2)
                this._emit('feed', [m.A[0], m.A[1]]);
        }
    }
}
