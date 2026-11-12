// SPDX-License-Identifier: GPL-2.0-or-later
// Turns a session snapshot into what the panel and the menu display.
// Pure functions: the translation function is passed in, so the module
// can be tested outside GNOME Shell.

export function sprintf(template, ...args) {
    let i = 0;
    return template.replace(/%[sd]/g, () => String(args[i++] ?? ''));
}

export function normGap(text) {
    const t = String(text ?? '').trim();
    if (!t || t.toUpperCase().startsWith('LAP'))
        return '';
    const laps = /^\+?(\d+)\s*L(?:APS?)?$/i.exec(t);
    if (laps)
        return `+${laps[1]}L`;
    if (/^\d+(?::\d+)?\.\d+$/.test(t))
        return `+${t}`;
    return t;
}

function raceValue(row, index, mode) {
    if (index === 0)
        return '';
    if (row.out)
        return 'OUT';
    const gap = normGap(row.gap);
    const interval = normGap(row.interval);
    if (mode === 'leader')
        return gap;
    if (mode === 'interval')
        return interval || gap;
    if (!interval || interval === gap)
        return gap;
    return `${gap} / ${interval}`;
}

function timedValue(row, index, mode) {
    if (mode === 'gap' && index > 0)
        return normGap(row.gap) || row.best || '—';
    return row.best || '—';
}

export function sessionLabel(code, _) {
    return {
        fp1: _('Practice 1'),
        fp2: _('Practice 2'),
        fp3: _('Practice 3'),
        practice: _('Practice'),
        'sprint-quali': _('Sprint Qualifying'),
        sprint: _('Sprint'),
        quali: _('Qualifying'),
        race: _('Race'),
    }[code] ?? '';
}

export function trackLabel(code, _) {
    return {
        green: _('Green flag'),
        yellow: _('Yellow flag'),
        sc: _('Safety Car'),
        vsc: _('Virtual Safety Car'),
        'vsc-ending': _('VSC ending'),
        red: _('Red flag'),
    }[code] ?? _('Green flag');
}

function shortSession(snap) {
    const m = /^fp(\d)$/.exec(snap.session);
    if (m)
        return `FP${m[1]}`;
    if (snap.kind === 'quali') {
        const prefix = snap.session === 'sprint-quali' ? 'SQ' : 'Q';
        return snap.qualiPart ? `${prefix}${snap.qualiPart}` : prefix;
    }
    return '';
}

function panelChip(snap, opts, _) {
    if (!opts.panelDrivers)
        return null;
    if (snap.finished)
        return {text: _('FINISH'), kind: 'neutral'};
    if (snap.track === 'sc')
        return {text: 'SC', kind: 'sc'};
    if (snap.track === 'vsc' || snap.track === 'vsc-ending')
        return {text: 'VSC', kind: 'vsc'};
    if (snap.track === 'red')
        return {text: _('RED'), kind: 'red'};
    if (!opts.showPanelStatus)
        return null;
    if (snap.kind === 'race')
        return snap.lap ? {text: `L${snap.lap}/${snap.totalLaps}`, kind: 'neutral'} : null;
    const text = `${shortSession(snap)} ${snap.remaining}`.trim();
    return text ? {text, kind: 'neutral'} : null;
}

function info(snap, _) {
    const bits = [];
    if (snap.kind === 'race' && snap.lap)
        bits.push(sprintf(_('Lap %d/%d'), snap.lap, snap.totalLaps));
    if (snap.kind === 'quali' && snap.qualiPart)
        bits.push(shortSession(snap));
    if (snap.kind !== 'race' && snap.remaining)
        bits.push(sprintf(_('%s left'), snap.remaining));
    if (snap.airTemp)
        bits.push(sprintf(_('air %s°C'), snap.airTemp.split('.')[0]));
    if (snap.trackTemp)
        bits.push(sprintf(_('track %s°C'), snap.trackTemp.split('.')[0]));
    return bits.join(' · ');
}

function tyre(r) {
    return {text: r.tyre, style: r.tyre ? `tyre-${r.tyre}` : '', age: r.tyreAge};
}

function row(snap, r, index, _) {
    const race = snap.kind === 'race';
    const tags = [];
    if (race && r.fastest)
        tags.push({text: _('FASTEST'), style: 'purple'});
    if (r.inPit && !r.out && !r.knockedOut)
        tags.push({text: 'PIT', style: 'pit'});

    let c1, c2, c1Style = '';
    if (race) {
        c1 = index === 0 ? _('LEADER') : r.out ? 'OUT' : normGap(r.gap);
        c2 = index === 0 || r.out ? '' : normGap(r.interval);
    } else {
        c1 = r.best || '—';
        c2 = r.position === 1 || !r.best ? '' : normGap(r.gap);
        c1Style = r.fastest ? 'purple' : '';
    }

    let ext;
    if (race) {
        const ch = r.posChange;
        ext = [
            {text: ch > 0 ? `▲${ch}` : ch < 0 ? `▼${-ch}` : '–',
                style: ch > 0 ? 'green' : ch < 0 ? 'red' : 'muted', narrow: true},
            {tyre: tyre(r)},
            {text: r.last || '—', style: r.lastPersonalBest ? 'green' : ''},
            {text: r.best || '—', style: r.fastest ? 'purple' : ''},
            {text: String(r.pits), style: 'muted', narrow: true},
        ];
    } else if (snap.kind === 'quali') {
        ext = [{tyre: tyre(r)}, ...r.qTimes.map(t => ({text: t || '—', style: t ? '' : 'muted'}))];
    } else {
        ext = [
            {tyre: tyre(r)},
            {text: r.last || '—', style: r.lastPersonalBest ? 'green' : ''},
            {text: r.laps || '—', style: 'muted', narrow: true},
        ];
    }

    return {
        pos: r.position, tla: r.tla, name: r.name, colour: r.colour,
        c1, c1Style, c2, tags, ext,
        chequered: !!r.chequered,
        dim: !!(r.out || r.outSegment),
    };
}

function sections(snap, _) {
    const rows = snap.rows;
    const make = list => list.map(r => row(snap, r, rows.indexOf(r), _));
    if (snap.kind !== 'quali')
        return [{title: '', style: '', rows: make(rows)}];

    // 20 cars: 5 out per segment, 22 cars: 6 out per segment.
    const elim = Math.max(Math.floor((rows.length - 10) / 2), 0);
    const part = snap.qualiPart || 1;
    const running = rows.filter(r => !r.outSegment);
    const out = [];
    const outQ2 = rows.filter(r => r.outSegment === 2);
    const outQ1 = rows.filter(r => r.outSegment === 1);
    if (outQ2.length)
        out.push({title: _('Knocked out in Q2'), style: 'out', rows: make(outQ2)});
    if (outQ1.length)
        out.push({title: _('Knocked out in Q1'), style: 'out', rows: make(outQ1)});

    if (part < 3 && elim && running.length > elim) {
        return [
            {title: '', style: '', rows: make(running.slice(0, -elim))},
            {title: _('Elimination zone'), style: 'danger', rows: make(running.slice(-elim))},
            ...out,
        ];
    }
    return [{title: '', style: '', rows: make(running)}, ...out];
}

function columns(snap, _) {
    if (snap.kind === 'race') {
        return {
            main: [_('Gap'), _('Interval')],
            ext: [_('Pos±'), _('Tyre'), _('Last'), _('Best'), _('Pit')],
        };
    }
    if (snap.kind === 'quali')
        return {main: [_('Time'), _('Gap')], ext: [_('Tyre'), 'Q1', 'Q2', 'Q3']};
    return {main: [_('Time'), _('Gap')], ext: [_('Tyre'), _('Last'), _('Laps')]};
}

function panelItems(snap, opts) {
    const count = Math.max(0, Math.min(3, opts.panelDrivers | 0));
    return snap.rows.slice(0, count).map((r, i) => ({
        pos: r.position,
        tla: r.tla,
        colour: r.colour,
        chequered: !!r.chequered,
        value: snap.kind === 'race' ? raceValue(r, i, opts.raceMode) : timedValue(r, i, opts.practiceMode),
    }));
}

/**
 * @param {object|null} snap session snapshot, null when nothing to show
 * @param {object} opts {panelDrivers, raceMode, practiceMode, showPanelStatus, delay, replay}
 * @param {Function} _ gettext
 */
export function build(snap, opts, _) {
    if (!snap) {
        return {
            mode: 'idle',
            idleText: opts.idleText ?? '',
            live: false,
        };
    }
    let footer = opts.replay ? _('Source: demo recording') : _('Source: public live timing feed');
    if (opts.delay)
        footer += ` · ${sprintf(_('delay %d s'), opts.delay)}`;
    return {
        mode: 'session',
        kind: snap.kind,
        live: snap.live,
        finished: snap.finished,
        replay: !!opts.replay,
        title: [snap.meeting, sessionLabel(snap.session, _)].filter(Boolean).join(' · '),
        track: snap.finished
            ? {text: _('Chequered flag'), kind: 'neutral'}
            : {text: trackLabel(snap.track, _), kind: snap.track === 'vsc-ending' ? 'vsc' : snap.track},
        info: info(snap, _),
        panel: {chip: panelChip(snap, opts, _), items: panelItems(snap, opts)},
        columns: columns(snap, _),
        sections: sections(snap, _),
        footer,
    };
}

/** Events worth a notification: [{kind, title, body}] */
export function diffEvents(prev, snap, _) {
    const events = [];
    if (!prev || !snap)
        return events;
    const title = [snap.meeting, sessionLabel(snap.session, _)].filter(Boolean).join(' · ');
    if (snap.status === 'Started' && prev.status && !['Started', 'Aborted'].includes(prev.status))
        events.push({kind: 'session-start', title: sprintf(_('Session started: %s'), title), body: ''});

    const leader = snap.rows[0]?.tla ?? '';
    const oldLeader = prev.rows[0]?.tla ?? '';
    if (snap.kind === 'race' && snap.status === 'Started' && snap.lap >= 1 &&
        leader && oldLeader && leader !== oldLeader) {
        events.push({
            kind: 'leader-change',
            title: _('New leader'),
            body: sprintf(_('%s passes %s · lap %d/%d'), leader, oldLeader, snap.lap, snap.totalLaps),
        });
    }

    if (snap.track !== prev.track && snap.live) {
        const where = snap.kind === 'race' && snap.lap
            ? sprintf(_('Lap %d/%d'), snap.lap, snap.totalLaps) : sessionLabel(snap.session, _);
        const body = leader ? `${where} · ${sprintf(_('%s leads'), leader)}` : where;
        if (['sc', 'vsc', 'red'].includes(snap.track))
            events.push({kind: 'flags', title: trackLabel(snap.track, _), body});
        else if (snap.track === 'green' && ['sc', 'vsc', 'vsc-ending', 'red'].includes(prev.track))
            events.push({kind: 'flags', title: trackLabel('green', _), body});
    }

    if (snap.finished && !prev.finished && snap.rows.length) {
        const top = snap.rows.slice(0, 3).map(r => `${r.position}. ${r.tla}`).join('   ');
        events.push({kind: 'finish', title: sprintf(_('Finished: %s'), title), body: top});
    }
    return events;
}
