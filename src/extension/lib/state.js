// SPDX-License-Identifier: GPL-2.0-or-later
// Session state built from live timing topics.
//
// The feed first sends a full state for every subscribed topic and then
// only deltas, which are merged recursively. Lists are sometimes updated
// with an object keyed by index ({"0": {...}}).

const TRACK_STATUS = {
    '1': 'green',
    '2': 'yellow',
    '4': 'sc',
    '5': 'red',
    '6': 'vsc',
    '7': 'vsc-ending',
};

const COMPOUNDS = {SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W'};

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function deepMerge(base, update) {
    if (!isObject(update))
        return clone(update);
    if (!isObject(base) && !Array.isArray(base))
        base = {};

    for (const [key, value] of Object.entries(update)) {
        if (key === '_deleted')
            continue;
        if (Array.isArray(base)) {
            const idx = Number.parseInt(key, 10);
            if (Number.isNaN(idx))
                continue;
            while (base.length <= idx)
                base.push({});
            const current = base[idx];
            base[idx] = isObject(value) && (isObject(current) || Array.isArray(current))
                ? deepMerge(current, value) : clone(value);
            continue;
        }
        const current = base[key];
        base[key] = isObject(value) && (isObject(current) || Array.isArray(current))
            ? deepMerge(current, value) : clone(value);
    }

    if (Array.isArray(update._deleted) && isObject(base)) {
        for (const key of update._deleted)
            delete base[String(key)];
    }
    return base;
}

function item(container, index) {
    if (Array.isArray(container))
        return container[index] ?? {};
    if (isObject(container))
        return container[String(index)] ?? {};
    return {};
}

function lastItem(container) {
    if (Array.isArray(container))
        return container.length ? container[container.length - 1] : {};
    if (isObject(container)) {
        const keys = Object.keys(container).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b);
        return keys.length ? container[keys[keys.length - 1]] : {};
    }
    return {};
}

function value(obj) {
    if (isObject(obj))
        return obj.Value ?? '';
    return obj ?? '';
}

export function lapSeconds(text) {
    const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(text ?? '').trim());
    if (!m)
        return null;
    return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

function sessionCode(name, kind) {
    const n = String(name ?? '').toLowerCase();
    const map = [
        ['practice 1', 'fp1'], ['practice 2', 'fp2'], ['practice 3', 'fp3'],
        ['sprint qualifying', 'sprint-quali'], ['sprint shootout', 'sprint-quali'],
        ['sprint', 'sprint'], ['qualifying', 'quali'], ['race', 'race'],
    ];
    for (const [key, code] of map) {
        if (n.includes(key))
            return code;
    }
    return kind;
}

const FINISHED = ['Finished', 'Finalised', 'Ends'];

export class SessionState {
    constructor() {
        this.reset();
    }

    reset() {
        this.topics = {};
        // lap counts at the chequered flag; a driver has finished once his count goes up
        this._chequeredLaps = null;
        this._finishedOnLoad = false;
    }

    apply(topic, data, snapshot = false) {
        topic = String(topic);
        if (topic.endsWith('.z'))
            return;
        if (snapshot || !(topic in this.topics) || !isObject(data))
            this.topics[topic] = clone(data);
        else
            this.topics[topic] = deepMerge(this.topics[topic], data);
    }

    applySnapshot(result) {
        // joined after the chequered flag: nobody can be seen crossing the line any more
        this._finishedOnLoad = FINISHED.includes(String(result?.SessionStatus?.Status ?? ''));
        if (isObject(result)) {
            for (const [topic, data] of Object.entries(result))
                this.apply(topic, data, true);
        }
    }

    get isEmpty() {
        return Object.keys(this.topics).length === 0;
    }

    kind() {
        const info = this.topics.SessionInfo ?? {};
        const type = String(info.Type ?? '').toLowerCase();
        const name = String(info.Name ?? '').toLowerCase();
        if (type.includes('qualifying') || name.includes('qualifying') || name.includes('shootout'))
            return 'quali';
        if (type === 'race' || name === 'race' || name === 'sprint')
            return 'race';
        return type ? 'practice' : '';
    }

    /** Display-independent picture of the session (codes, not labels). */
    snapshot() {
        const t = this.topics;
        const info = t.SessionInfo ?? {};
        const kind = this.kind();
        const status = isObject(t.SessionStatus) ? String(t.SessionStatus.Status ?? '') : '';
        const track = isObject(t.TrackStatus) ? String(t.TrackStatus.Status ?? '1') : '1';
        const laps = isObject(t.LapCount) ? t.LapCount : {};
        const clock = isObject(t.ExtrapolatedClock) ? t.ExtrapolatedClock : {};
        const weather = isObject(t.WeatherData) ? t.WeatherData : {};
        const timing = isObject(t.TimingData) ? t.TimingData : {};
        const part = Number.parseInt(timing.SessionPart ?? 0, 10) || 0;

        let remaining = String(clock.Remaining ?? '');
        if (remaining.startsWith('00:'))
            remaining = remaining.slice(3);

        const snap = {
            meeting: String(info.Meeting?.Name ?? '').replace(/\s*Grand Prix$/, ' GP'),
            session: sessionCode(info.Name, kind),
            kind,
            status,
            track: TRACK_STATUS[track] ?? 'green',
            lap: Number.parseInt(laps.CurrentLap ?? 0, 10) || 0,
            totalLaps: Number.parseInt(laps.TotalLaps ?? 0, 10) || 0,
            remaining,
            qualiPart: part,
            airTemp: String(weather.AirTemp ?? ''),
            trackTemp: String(weather.TrackTemp ?? ''),
            rows: [],
        };
        snap.finished = FINISHED.includes(status);
        snap.live = !snap.finished && (status === 'Started' || status === 'Aborted');

        const lines = isObject(timing.Lines) ? timing.Lines : {};
        const drivers = isObject(t.DriverList) ? t.DriverList : {};
        const appLines = isObject(t.TimingAppData?.Lines) ? t.TimingAppData.Lines : {};

        for (const [num, line] of Object.entries(lines)) {
            if (!isObject(line))
                continue;
            const d = isObject(drivers[num]) ? drivers[num] : {};
            let pos = Number.parseInt(line.Position ?? line.Line ?? 0, 10) || 0;
            if (pos <= 0)
                pos = Number.parseInt(d.Line ?? 99, 10) || 99;
            const name = `${d.FirstName ?? ''} ${d.LastName ?? ''}`.trim() || d.FullName || num;
            const last = isObject(line.LastLapTime) ? line.LastLapTime : {};
            const row = {
                number: num,
                tla: d.Tla || num,
                name,
                colour: `#${String(d.TeamColour ?? '888888').replace('#', '')}`,
                position: pos,
                gap: '',
                interval: '',
                best: '',
                last: value(last),
                lastPersonalBest: !!last.PersonalFastest,
                fastest: false,
                pits: Number.parseInt(line.NumberOfPitStops ?? 0, 10) || 0,
                inPit: !!line.InPit,
                out: !!line.Retired || !!line.Stopped,
                knockedOut: !!line.KnockedOut,
                laps: String(line.NumberOfLaps ?? ''),
                qTimes: ['', '', ''],
                outSegment: 0,
                tyre: '',
                tyreAge: '',
                posChange: 0,
                chequered: false,
            };

            if (kind === 'race') {
                row.gap = String(line.GapToLeader ?? '');
                row.interval = String(value(line.IntervalToPositionAhead));
                row.best = value(line.BestLapTime);
            } else if (kind === 'quali') {
                const bests = line.BestLapTimes;
                const stats = line.Stats;
                row.qTimes = [0, 1, 2].map(i => value(item(bests, i)));
                let seg = part || 1;
                if (row.knockedOut) {
                    const done = [1, 2, 3].filter(i => row.qTimes[i - 1]);
                    row.outSegment = done.length ? Math.max(...done) : Math.max(seg - 1, 1);
                    seg = row.outSegment;
                }
                row.best = row.qTimes[seg - 1] ?? '';
                const st = item(stats, seg - 1);
                row.gap = String(st.TimeDiffToFastest ?? '');
                row.interval = String(st.TimeDifftoPositionAhead ?? '');
                if (!row.best && !row.knockedOut)
                    row.gap = '';
            } else {
                row.best = value(line.BestLapTime);
                row.gap = String(line.TimeDiffToFastest ?? '');
                row.interval = String(line.TimeDiffToPositionAhead ?? '');
            }

            const app = appLines[num];
            if (isObject(app)) {
                const stint = lastItem(app.Stints);
                if (isObject(stint)) {
                    row.tyre = COMPOUNDS[String(stint.Compound ?? '').toUpperCase()] ?? '';
                    if (stint.TotalLaps !== undefined && stint.TotalLaps !== null)
                        row.tyreAge = String(stint.TotalLaps);
                }
                const grid = Number.parseInt(app.GridPos ?? 0, 10) || 0;
                if (kind === 'race' && grid > 0)
                    row.posChange = grid - pos;
            }
            snap.rows.push(row);
        }

        snap.rows.sort((a, b) => a.position - b.position || a.number.localeCompare(b.number));
        if (kind === 'race' && snap.finished)
            this._markChequered(snap.rows, snap.totalLaps);
        let fastest = null;
        for (const r of snap.rows) {
            const s = lapSeconds(r.best);
            if (s && !r.outSegment && (!fastest || s < fastest.s))
                fastest = {s, r};
        }
        if (fastest)
            fastest.r.fastest = true;
        return snap;
    }

    _markChequered(rows, totalLaps) {
        if (!this._chequeredLaps) {
            this._chequeredLaps = {};
            for (const r of rows)
                this._chequeredLaps[r.number] = Number.parseInt(r.laps, 10) || 0;
        }
        for (const r of rows) {
            const laps = Number.parseInt(r.laps, 10) || 0;
            r.chequered = !r.out && (this._finishedOnLoad || r.position === 1 ||
                (totalLaps > 0 && laps >= totalLaps) ||
                laps > (this._chequeredLaps[r.number] ?? laps));
        }
    }
}
