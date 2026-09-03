"""Measure warm, read-only API responses on a local production journal.

Run against the same data before and after a change. No records are created or modified.
Example: python3 scripts/benchmark-journal.py --base-url http://127.0.0.1:3002 --account ACCOUNT_ID
"""
import argparse
import json
import statistics
import time
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base-url", required=True)
parser.add_argument("--account", default="")
parser.add_argument("--samples", type=int, default=6)
args = parser.parse_args()
target = urllib.parse.urlparse(args.base_url)
if target.scheme != "http" or target.hostname != "127.0.0.1" or not target.port or target.path not in ("", "/") or target.username or target.password or target.query or target.fragment:
    parser.error("Choose a loopback HTTP server with an explicit port.")
if not 1 <= args.samples <= 30:
    parser.error("Use between 1 and 30 samples.")
query = urllib.parse.urlencode({"accounts": args.account}) if args.account else ""
routes = {
    "dashboard": "/api/stats?" + query,
    "cross_analysis": "/api/analysis?primary=symbol&secondary=weekday&" + query,
    "adherence": "/api/adherence?" + query,
    "trade_list": "/api/trades?view=list&" + query,
}
results = {}
for name, route in routes.items():
    samples = []
    for attempt in range(args.samples + 1):
        start = time.perf_counter()
        with urllib.request.urlopen(args.base_url.rstrip("/") + route, timeout=60) as response:
            payload = response.read()
        elapsed = (time.perf_counter() - start) * 1000
        if attempt:
            samples.append(elapsed)
    results[name] = {
        "median_ms": round(statistics.median(samples), 1),
        "response_bytes": len(payload),
        "samples_ms": [round(value, 1) for value in samples],
    }
print(json.dumps(results, indent=2))
