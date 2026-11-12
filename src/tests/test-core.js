// SPDX-License-Identifier: GPL-2.0-or-later
// Logic tests, run with:  gjs -m tests/test-core.js
import GLib from 'gi://GLib';
import System from 'system';

import {SessionState, deepMerge} from '../extension/lib/state.js';
import {build, diffEvents, normGap} from '../extension/lib/view.js';
import {parseCalendar, activeSession, nextSession} from '../extension/lib/schedule.js';

const _ = s => s;
let failures = 0;
function check(name, cond, detail = '') {
    if (!cond) {
        failures++;
        print(`FAIL ${name} ${detail}`);
    } else {
        print(`ok   ${name}`);
    }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const opts = (o = {}) => ({panelDrivers: 0, raceMode: 'leader', practiceMode: 'gap', showPanelStatus: false, delay: 0, ...o});

// --- merge
{
    const base = {Lines: {1: {Stints: [{Compound: 'SOFT'}], Gap: '+1'}}};
    deepMerge(base, {Lines: {1: {Stints: {0: {TotalLaps: 5}, 1: {Compound: 'HARD'}}}}});
    check('merge indexed lists', eq(base.Lines[1].Stints, [{Compound: 'SOFT', TotalLaps: 5}, {Compound: 'HARD'}]));
    const d = {a: 1, b: 2};
    deepMerge(d, {_deleted: ['a']});
    check('merge _deleted', eq(d, {b: 2}));
}

// --- qualifying Q3 / Q2 sections
const TLAS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK',
    'LLL', 'MMM', 'NNN', 'OOO', 'PPP', 'QQQ', 'RRR', 'SSS', 'TTT', 'UUU', 'VVV'];
function quali(part) {
    const lines = {}, drivers = {};
    TLAS.forEach((tla, i) => {
        const num = String(i + 1);
        drivers[num] = {Tla: tla, FirstName: 'X', LastName: tla, TeamColour: 'FF8000'};
        lines[num] = {
            Position: String(i + 1),
            BestLapTimes: [{Value: `1:31.${100 + i}`}, {Value: i < 16 ? `1:29.${100 + i}` : ''},
                {Value: i < 10 ? `1:27.${470 + i * 10}` : ''}],
            Stats: [{TimeDiffToFastest: `+${i}.0`}, {TimeDiffToFastest: `+${i}.1`},
                {TimeDiffToFastest: i === 0 ? '' : `+0.${i}04`}],
            InPit: i >= 10,
            KnockedOut: part === 3 ? i >= 10 : i >= 16,
        };
    });
    const s = new SessionState();
    s.applySnapshot({
        SessionInfo: {Meeting: {Name: 'Test Grand Prix'}, Type: 'Qualifying', Name: 'Qualifying'},
        SessionStatus: {Status: 'Started'}, ExtrapolatedClock: {Remaining: '00:08:09'},
        DriverList: drivers, TimingData: {SessionPart: part, Lines: lines},
    });
    return s.snapshot();
}
{
    const v = build(quali(3), opts({panelDrivers: 3, practiceMode: 'times'}), _);
    check('Q3 section titles', eq(v.sections.map(s => s.title), ['', 'Knocked out in Q2', 'Knocked out in Q1']));
    check('Q3 section sizes', eq(v.sections.map(s => s.rows.length), [10, 6, 6]));
    const q2 = v.sections[1].rows[0];
    check('Q2 knockout shows Q2 time', q2.c1 === '1:29.110', q2.c1);
    check('knocked out has no PIT tag', !q2.tags.some(t => t.text === 'PIT'));
    check('knocked out dimmed', q2.dim);
    check('P1 purple, no gap', v.sections[0].rows[0].c1Style === 'purple' && v.sections[0].rows[0].c2 === '');
    check('P2 gap', v.sections[0].rows[1].c2 === '+0.104');
    check('info line', v.info === 'Q3 · 08:09 left', v.info);
    check('title', v.title === 'Test GP · Qualifying', v.title);
    check('panel items', eq(v.panel.items.map(i => `${i.tla} ${i.value}`), ['AAA 1:27.470', 'BBB 1:27.480', 'CCC 1:27.490']));
    const v2 = build(quali(2), opts(), _);
    check('Q2 sections', eq(v2.sections.map(s => s.title), ['', 'Elimination zone', 'Knocked out in Q1']));
    check('Q2 sizes', eq(v2.sections.map(s => s.rows.length), [10, 6, 6]));
    check('icon only by default', v2.panel.items.length === 0 && v2.panel.chip === null);
}

// --- demo race replay
{
    const path = GLib.build_filenamev([GLib.path_get_dirname(System.programPath ?? ''), '..', 'extension', 'data', 'demo-race.jsonl']);
    const [, bytes] = GLib.file_get_contents(GLib.canonicalize_filename(path, null));
    const records = new TextDecoder().decode(bytes).split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const s = new SessionState();
    let prev = null;
    const events = [];
    let sawSc = false;
    let first = null;
    let atFlag = null;
    for (const rec of records) {
        if (rec.kind === 'snapshot')
            s.applySnapshot(rec.payload);
        else
            s.apply(rec.payload[0], rec.payload[1]);
        const snap = s.snapshot();
        if (snap.finished && !atFlag)
            atFlag = snap.rows.filter(r => r.chequered).map(r => r.tla);
        events.push(...diffEvents(prev, snap, _));
        const v = build(snap, opts({panelDrivers: 3}), _);
        first ??= v;
        if (v.panel.chip?.text === 'SC')
            sawSc = true;
        prev = snap;
    }
    const kinds = events.map(e => e.kind);
    check('demo: leader change', kinds.includes('leader-change'));
    check('demo: flags', kinds.includes('flags'));
    check('demo: finish', kinds.includes('finish'));
    check('demo: SC chip in panel', sawSc);
    check('demo: 22 rows', prev.rows.length === 22);
    check('demo: finished', prev.finished);
    check('demo: leader has no value', first.panel.items[0].value === '');
    const last = build(prev, opts({panelDrivers: 2}), _);
    check('demo: finish chip', last.panel.chip?.text === 'FINISH');
    check('demo: LEADER column', last.sections[0].rows[0].c1 === 'LEADER');
    const bot = prev.rows.find(r => r.tla === 'FOX');
    check('demo: retired', bot.out);
    check('demo: at the flag only the leader is chequered', atFlag.length === 1 && atFlag[0] === prev.rows[0].tla,
        JSON.stringify(atFlag));
    check('demo: at the end all running cars chequered, retired not',
        prev.rows.every(r => r.chequered === !r.out));
    check('demo: chequered in view rows', last.sections[0].rows[0].chequered && last.panel.items[0].chequered);
    events.forEach(e => print(`     event: ${e.title} — ${e.body}`));
}

// --- calendar
{
    const data = {MRData: {RaceTable: {Races: [{
        raceName: 'Sample Grand Prix', date: '2026-11-08', time: '17:00:00Z',
        FirstPractice: {date: '2026-11-06', time: '14:30:00Z'},
        Qualifying: {date: '2026-11-07', time: '18:00:00Z'},
        Sprint: {date: '2026-11-07', time: '14:00:00Z'},
        SprintQualifying: {date: '2026-11-06', time: '18:30:00Z'},
    }]}}};
    const s = parseCalendar(data);
    check('calendar order', eq(s.map(x => x.code), ['fp1', 'sprint-quali', 'sprint', 'quali', 'race']));
    const race = s[4];
    check('active 5 min before', activeSession(s, race.start - 300) === race);
    check('active 25 min after end', activeSession(s, race.end + 1500) === race);
    check('next', nextSession(s, race.start - 7200) === race);
    check('meeting short', race.meeting === 'Sample GP');
}

check('normGap', normGap('1L') === '+1L' && normGap('LAP 3') === '' && normGap('1.204') === '+1.204');

if (failures) {
    print(`${failures} FAILED`);
    System.exit(1);
}
print('ALL OK');
