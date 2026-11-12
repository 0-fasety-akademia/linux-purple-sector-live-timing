"""Generates extension/data/demo-race.jsonl – a synthetic race for demo mode.

Fictional drivers and teams, same message format as the live timing feed:
leader change, Safety Car, pit stop, retirement, finish.
Run: python3 tools/make_demo.py
"""
import json
import random
from pathlib import Path

random.seed(7)
OUT = Path(__file__).resolve().parent.parent / "extension" / "data" / "demo-race.jsonl"

GRID = [  # fictional drivers and teams – demo only
    ("7", "ALV", "Mateo", "Alvarez", "Azure Racing", "3B82F6", "MEDIUM"),
    ("21", "KOW", "Jan", "Kowal", "Crimson Works", "DC2626", "MEDIUM"),
    ("4", "NAK", "Ren", "Nakamura", "Orange Arrow", "F97316", "HARD"),
    ("33", "BER", "Luca", "Bertoni", "Crimson Works", "DC2626", "MEDIUM"),
    ("12", "OKA", "Femi", "Okafor", "Orange Arrow", "F97316", "HARD"),
    ("9", "LIN", "Erik", "Lindqvist", "Silver Comet", "2DD4BF", "MEDIUM"),
    ("15", "DUP", "Hugo", "Dupont", "Silver Comet", "2DD4BF", "MEDIUM"),
    ("28", "SAN", "Diego", "Santos", "Emerald GP", "16A34A", "HARD"),
    ("5", "MUL", "Max", "Muller", "Azure Racing", "3B82F6", "MEDIUM"),
    ("19", "ROS", "Theo", "Rossi", "Sky Motorsport", "0EA5E9", "HARD"),
    ("63", "PAT", "Arjun", "Patel", "Lagoon Racing", "7DD3FC", "MEDIUM"),
    ("11", "NOV", "Pavel", "Novak", "Lagoon Racing", "7DD3FC", "MEDIUM"),
    ("44", "HAR", "Sam", "Harper", "Steel Team", "A1A1AA", "HARD"),
    ("2", "KIM", "Joon", "Kim", "Violet Bulls", "8B5CF6", "MEDIUM"),
    ("27", "VOS", "Lars", "Vos", "Ruby Engineering", "BE123C", "HARD"),
    ("31", "MOR", "Leo", "Moreau", "Steel Team", "A1A1AA", "HARD"),
    ("18", "COH", "Ari", "Cohen", "Emerald GP", "16A34A", "MEDIUM"),
    ("50", "SIL", "Rafa", "Silva", "Ruby Engineering", "BE123C", "SOFT"),
    ("41", "BAK", "Owen", "Baker", "Violet Bulls", "8B5CF6", "HARD"),
    ("43", "GAR", "Tomas", "Garcia", "Sky Motorsport", "0EA5E9", "MEDIUM"),
    ("8", "WEB", "Noah", "Weber", "Gold Line", "CA8A04", "HARD"),
    ("77", "FOX", "Ian", "Fox", "Gold Line", "CA8A04", "HARD"),
]
GRID_POS = [2, 1, 4, 3, 7, 5, 6, 11, 9, 8, 12, 10, 17, 14, 13, 18, 15, 16, 20, 19, 22, 21]


def fmt_lap(sec):
    return f"{int(sec // 60)}:{sec % 60:06.3f}"


def main():
    t = 1_700_000_000.0
    out = []

    def emit(kind, payload, dt=0.0):
        nonlocal t
        t += dt
        out.append({"t": round(t, 3), "kind": kind, "payload": payload})

    lap, total = 30, 71
    order = [g[0] for g in GRID]
    gaps = {g[0]: i * 2.1 + random.random() for i, g in enumerate(GRID)}
    best = {g[0]: 73.4 + random.random() * 1.3 for g in GRID}
    tyre_age = {g[0]: 10 + random.randint(0, 15) for g in GRID}

    lines = {}
    for i, num in enumerate(order):
        lines[num] = {
            "Position": str(i + 1), "Line": i + 1,
            "GapToLeader": f"LAP {lap}" if i == 0 else f"+{gaps[num] - gaps[order[0]]:.3f}",
            "IntervalToPositionAhead": {"Value": "" if i == 0 else f"+{gaps[num] - gaps[order[i - 1]]:.3f}"},
            "BestLapTime": {"Value": fmt_lap(best[num])},
            "LastLapTime": {"Value": fmt_lap(best[num] + 0.4), "PersonalFastest": False},
            "NumberOfPitStops": 1, "InPit": False, "Retired": False, "Stopped": False, "NumberOfLaps": lap,
        }
    snapshot = {
        "SessionInfo": {"Meeting": {"Name": "Demo Grand Prix", "Location": "Demo"},
                        "Type": "Race", "Name": "Race"},
        "SessionStatus": {"Status": "Started"},
        "TrackStatus": {"Status": "1", "Message": "AllClear"},
        "LapCount": {"CurrentLap": lap, "TotalLaps": total},
        "WeatherData": {"AirTemp": "24.0", "TrackTemp": "41.0"},
        "DriverList": {g[0]: {"RacingNumber": g[0], "Tla": g[1], "FirstName": g[2], "LastName": g[3],
                              "TeamName": g[4], "TeamColour": g[5], "Line": i + 1}
                       for i, g in enumerate(GRID)},
        "TimingData": {"Lines": lines},
        "TimingAppData": {"Lines": {g[0]: {"GridPos": str(GRID_POS[i]),
                                           "Stints": [{"Compound": "SOFT", "TotalLaps": 18},
                                                      {"Compound": g[6], "TotalLaps": tyre_age[g[0]]}]}
                                    for i, g in enumerate(GRID)}},
    }
    emit("snapshot", snapshot)

    track = "1"
    tick = 0
    while lap < total:
        tick += 1
        delta_lines = {}
        # zmiany odstępów
        for num in order[1:]:
            drift = random.uniform(-0.15, 0.45) if tick > 42 else random.uniform(-0.25, 0.3)
            gaps[num] += drift * (0.2 if track == "4" else 1) * (1 + order.index(num) / 10)
        if tick == 18:   # LEC wyprzedza VER
            order[0], order[1] = order[1], order[0]
            gaps[order[0]], gaps[order[1]] = gaps[order[1]] - 0.4, gaps[order[0]] + 0.4
        if tick == 30:   # Safety Car
            track = "4"
            emit("feed", ["TrackStatus", {"Status": "4", "Message": "SCDeployed"}], 0.5)
        if 30 <= tick < 42:  # zbijanie stawki
            lead = gaps[order[0]]
            for i, num in enumerate(order):
                target = lead + i * 0.8
                gaps[num] = gaps[num] - (gaps[num] - target) * 0.35
        if tick == 33:   # BOR zjeżdża do boksu
            delta_lines["50"] = {"InPit": True, "NumberOfPitStops": 2}
        if tick == 35:
            delta_lines["50"] = {"InPit": False}
            tyre_age["50"] = 0
            emit("feed", ["TimingAppData", {"Lines": {"50": {"Stints": {"2": {"Compound": "SOFT", "TotalLaps": 0}}}}}])
        if tick == 42:
            track = "1"
            emit("feed", ["TrackStatus", {"Status": "1", "Message": "AllClear"}], 0.5)
        if tick == 55:   # awaria BOT
            delta_lines["77"] = {"Retired": True, "Stopped": True}
            lines["77"]["Retired"] = True
        # sortowanie wg odstępu (pozycje)
        order.sort(key=lambda n: (lines[n].get("Retired", False), gaps[n]))
        new_lap = tick % 3 == 0
        if new_lap and lap + 1 == total:
            break   # the last lap is played out below, car by car
        if new_lap:
            lap += 1
            emit("feed", ["LapCount", {"CurrentLap": lap}], 0.3)
        for i, num in enumerate(order):
            d = delta_lines.setdefault(num, {})
            d["Position"] = str(i + 1)
            d["Line"] = i + 1
            d["GapToLeader"] = f"LAP {lap}" if i == 0 else f"+{gaps[num] - gaps[order[0]]:.3f}"
            d["IntervalToPositionAhead"] = {"Value": "" if i == 0 else f"+{gaps[num] - gaps[order[i - 1]]:.3f}"}
            if new_lap and not lines[num].get("Retired"):
                lt = best[num] + random.uniform(-0.25, 1.0) + (14 if track == "4" else 0)
                pb = lt < best[num]
                if pb:
                    best[num] = lt
                    d["BestLapTime"] = {"Value": fmt_lap(lt)}
                d["LastLapTime"] = {"Value": fmt_lap(lt), "PersonalFastest": pb}
                d["NumberOfLaps"] = lap
            lines[num].update({k: v for k, v in d.items() if k in ("Retired",)})
        emit("feed", ["TimingData", {"Lines": delta_lines}], 2.0)
        if new_lap:
            emit("feed", ["TimingAppData", {"Lines": {n: {"Stints": {"1": {"TotalLaps": tyre_age[n] + tick // 3}}}
                                                       for n in order if n != "50"}}])
    # chequered flag: the leader crosses the line, then the others one by one
    order.sort(key=lambda n: (lines[n].get("Retired", False), gaps[n]))
    leader = order[0]
    emit("feed", ["LapCount", {"CurrentLap": total}], 2.0)
    emit("feed", ["TimingData", {"Lines": {leader: {"NumberOfLaps": total, "GapToLeader": f"LAP {total}"}}}])
    emit("feed", ["SessionStatus", {"Status": "Finished"}])
    prev_gap = gaps[leader]
    for num in order[1:]:
        if lines[num].get("Retired"):
            continue
        emit("feed", ["TimingData", {"Lines": {num: {"NumberOfLaps": total}}}],
             max(0.4, (gaps[num] - prev_gap) * 0.5))
        prev_gap = gaps[num]
    emit("feed", ["SessionStatus", {"Status": "Finalised"}], 15.0)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for rec in out:
            f.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{OUT}: {len(out)} records, {out[-1]['t'] - out[0]['t']:.0f} s")


if __name__ == "__main__":
    main()
