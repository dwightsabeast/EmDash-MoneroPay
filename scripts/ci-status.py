#!/usr/bin/env python3
# CI status for one commit, from GitHub's public API (no gh CLI or token needed; the repo is public). Waits up to about
# 23 minutes for every run on the commit to finish, then prints each run, job, the race-detector step and any step that
# didn't succeed. Usage: python3 -I scripts/ci-status.py <full commit sha>
import json, sys, time, urllib.request
api = "https://api.github.com/repos/dwightsabeast/EmDash-MoneroPay"
sha = sys.argv[1]
get = lambda u: json.load(urllib.request.urlopen(urllib.request.Request(api + u, headers={"Accept": "application/vnd.github+json"})))
for _ in range(70):
    runs = get(f"/actions/runs?head_sha={sha}&per_page=5")["workflow_runs"]
    if runs and all(r["status"] == "completed" for r in runs):
        break
    time.sleep(20)
for r in runs:
    print(r["id"], r["name"], r["status"], r["conclusion"])
    for j in get(f"/actions/runs/{r['id']}/jobs")["jobs"]:
        print(" ", j["name"], j["conclusion"])
        for s in j["steps"]:
            if "race" in s["name"].lower() or s["conclusion"] not in ("success", "skipped"):
                print("   ", s["name"], s["conclusion"])
