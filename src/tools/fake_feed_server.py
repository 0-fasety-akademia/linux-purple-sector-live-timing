"""Local stand-in for the live timing feed (SignalR Core), for testing without a live session.

    python3 tools/fake_feed_server.py [--legacy-only]

HTTP negotiate on 127.0.0.1:18080, WebSocket on 127.0.0.1:18081. Serves a
qualifying Q3 snapshot with fictional drivers, then a few deltas.
Requires python3-websockets.
"""
import asyncio
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import websockets

RS = "\x1e"
LEGACY_ONLY = "--legacy-only" in sys.argv
TLAS = ["ALV", "KOW", "NAK", "BER", "OKA", "LIN", "DUP", "SAN", "MUL", "ROS", "PAT",
        "NOV", "HAR", "KIM", "VOS", "MOR", "COH", "SIL", "BAK", "GAR", "WEB", "FOX"]
COLOURS = ["3B82F6", "DC2626", "F97316", "DC2626", "F97316", "2DD4BF", "2DD4BF", "16A34A", "3B82F6",
           "0EA5E9", "7DD3FC", "7DD3FC", "A1A1AA", "8B5CF6", "BE123C", "A1A1AA", "16A34A", "BE123C",
           "8B5CF6", "0EA5E9", "CA8A04", "CA8A04"]


def snapshot():
    lines, drivers, app = {}, {}, {}
    for i, tla in enumerate(TLAS):
        num = str(i + 1)
        drivers[num] = {"Tla": tla, "FirstName": "Test", "LastName": tla.title(), "TeamColour": COLOURS[i]}
        lines[num] = {
            "Position": str(i + 1),
            "BestLapTimes": [{"Value": f"1:11.{100 + i * 7:03d}"},
                             {"Value": f"1:10.{300 + i * 9:03d}" if i < 16 else ""},
                             {"Value": f"1:09.{470 + i * 31:03d}" if i < 10 else ""}],
            "Stats": [{"TimeDiffToFastest": f"+0.{i * 7:03d}"}, {"TimeDiffToFastest": f"+0.{i * 9:03d}"},
                      {"TimeDiffToFastest": "" if i == 0 else f"+0.{i * 31:03d}"}],
            "InPit": i >= 10, "KnockedOut": i >= 10, "NumberOfLaps": 12 + i % 5,
        }
        app[num] = {"Stints": [{"Compound": "SOFT" if i % 3 else "MEDIUM", "TotalLaps": 3 + i % 4}]}
    return {
        "SessionInfo": {"Meeting": {"Name": "Test Grand Prix"}, "Type": "Qualifying", "Name": "Qualifying"},
        "SessionStatus": {"Status": "Started"}, "TrackStatus": {"Status": "1"},
        "ExtrapolatedClock": {"Remaining": "00:08:09"},
        "WeatherData": {"AirTemp": "22.4", "TrackTemp": "35.1"},
        "DriverList": drivers, "TimingData": {"SessionPart": 3, "Lines": lines},
        "TimingAppData": {"Lines": app},
    }


class Negotiate(BaseHTTPRequestHandler):
    def _send(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "AWSALB=test; Path=/")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_POST(self):  # noqa: N802
        if self.path.startswith("/signalrcore/negotiate") and not LEGACY_ONLY:
            self._send(200, {"connectionToken": "tok-core", "negotiateVersion": 1})
        else:
            self._send(404, {})

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/signalr/negotiate"):
            self._send(200, {"ConnectionToken": "tok-legacy"})
        else:
            self._send(404, {})

    def log_message(self, *args):
        print("HTTP", self.command, self.path, flush=True)


async def handler(ws):
    path = ws.request.path
    print("WS", path, "cookie:", ws.request.headers.get("Cookie"), flush=True)
    if path.startswith("/signalrcore"):
        hs = await ws.recv()
        print("handshake", hs.strip(RS), flush=True)
        await ws.send("{}" + RS)
        sub = json.loads((await ws.recv()).rstrip(RS))
        print("subscribe", sub["arguments"][0][:3], "…", flush=True)
        await ws.send(json.dumps({"type": 3, "invocationId": sub["invocationId"], "result": snapshot()}) + RS)
        for remaining in ("00:08:08", "00:08:07", "00:08:06"):
            await asyncio.sleep(1)
            await ws.send(json.dumps({"type": 1, "target": "feed",
                                      "arguments": ["ExtrapolatedClock", {"Remaining": remaining}, "t"]}) + RS)
    else:
        sub = json.loads(await ws.recv())
        await ws.send(json.dumps({"R": snapshot(), "I": "1"}))
    await asyncio.sleep(3600)


async def main():
    http = HTTPServer(("127.0.0.1", 18080), Negotiate)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    async with websockets.serve(handler, "127.0.0.1", 18081, max_size=None):
        print("fake feed ready", flush=True)
        await asyncio.Future()


asyncio.run(main())
