// SPDX-License-Identifier: GPL-2.0-or-later
// Season calendar: when to connect to the live timing feed.

export const SCHEDULE_URL = 'https://api.jolpi.ca/ergast/f1/current.json?limit=100';

const PRE_CONNECT = 10 * 60;   // s before the scheduled start
const POST_KEEP = 30 * 60;     // s after the planned end

// planned length of each session in minutes, by calendar key
const SESSIONS = {
    FirstPractice: ['fp1', 60],
    SecondPractice: ['fp2', 60],
    ThirdPractice: ['fp3', 60],
    SprintQualifying: ['sprint-quali', 45],
    SprintShootout: ['sprint-quali', 45],
    Sprint: ['sprint', 60],
    Qualifying: ['quali', 60],
    Race: ['race', 120],
};

function parseUtc(date, time) {
    const t = (time || '00:00:00Z').replace(/Z$/, '');
    return Date.parse(`${date}T${t}Z`) / 1000;
}

/** Parses an Ergast-compatible season response into sorted sessions (UTC seconds). */
export function parseCalendar(data) {
    const sessions = [];
    for (const race of data?.MRData?.RaceTable?.Races ?? []) {
        const meeting = String(race.raceName ?? '').replace(/\s*Grand Prix$/, ' GP');
        for (const [key, [code, minutes]] of Object.entries(SESSIONS)) {
            const block = key === 'Race' ? {date: race.date, time: race.time} : race[key];
            if (!block?.date)
                continue;
            const start = parseUtc(block.date, block.time);
            if (Number.isNaN(start))
                continue;
            sessions.push({meeting, code, start, end: start + minutes * 60});
        }
    }
    return sessions.sort((a, b) => a.start - b.start);
}

export function activeSession(sessions, now) {
    return sessions.find(s => s.start - PRE_CONNECT <= now && now <= s.end + POST_KEEP) ?? null;
}

export function nextSession(sessions, now) {
    return sessions.find(s => s.start > now) ?? null;
}
