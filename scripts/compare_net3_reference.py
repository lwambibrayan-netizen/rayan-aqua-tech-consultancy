#!/usr/bin/env python3
"""Compare every Net3 junction, link and tank hourly against WNTR's EPANET 2.2 run."""
import json
import math
from pathlib import Path
import wntr

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / ".benchmark-output"
INP = ARTIFACTS / "Net3-roundtrip.inp"
JS_RESULTS = ARTIFACTS / "epanet-js-results.json"

def require(condition, message):
    if not condition:
        raise AssertionError(message)

def close_enough(label, actual, expected, tolerance):
    actual = float(actual)
    expected = float(expected)
    delta = abs(actual - expected)
    require(math.isfinite(actual), f"{label}: app result is not finite: {actual}")
    require(math.isfinite(expected), f"{label}: reference result is not finite: {expected}")
    require(delta <= tolerance, f"{label}: mismatch app={actual}, reference={expected}, delta={delta}, tolerance={tolerance}")
    return delta

require(INP.exists(), f"Missing app-exported INP: {INP}")
require(JS_RESULTS.exists(), f"Missing EPANET-JS samples: {JS_RESULTS}")
js = json.loads(JS_RESULTS.read_text())
js_samples = {int(round(row["timeHours"])): row for row in js["hourlySamples"]}
require(len(js_samples) == 169, f"Expected exactly 169 hourly app samples, got {len(js_samples)}")

wn = wntr.network.WaterNetworkModel(str(INP))
require(wn.options.time.duration == 168 * 3600, f"Reference model duration is {wn.options.time.duration}, not 168 hours")
require(wn.options.time.hydraulic_timestep == 3600, "Unexpected hydraulic timestep")
require(wn.options.time.quality_timestep == 300, "Unexpected quality timestep")
require(wn.options.quality.parameter == "TRACE", f"Expected TRACE quality mode, got {wn.options.quality.parameter}")
require(wn.options.quality.trace_node == "Lake", f"Expected Lake trace node, got {wn.options.quality.trace_node}")

ref = wntr.sim.EpanetSimulator(wn).run_sim(version=2.2, convergence_error=True)
node_pressure = ref.node["pressure"]
link_flow = ref.link["flowrate"]
link_velocity = ref.link["velocity"]
node_head = ref.node["head"]
node_quality = ref.node["quality"]

junction_ids = sorted(name for name, _node in wn.junctions())
tank_ids = sorted(name for name, _node in wn.tanks())
link_ids = sorted(name for name, _link in wn.links())
pipe_ids = sorted(l.name for l in wn.pipe_name_list)
require(len(junction_ids) == 92, f"Expected 92 junctions, got {len(junction_ids)}")
require(len(tank_ids) == 3, f"Expected 3 tanks, got {len(tank_ids)}")
require(len(link_ids) == 119, f"Expected 119 links, got {len(link_ids)}")
require(len(pipe_ids) == 117, f"Expected 117 pipes, got {len(pipe_ids)}")

max_errors = {"pressure_m": 0.0, "flow_lps": 0.0, "pipe_velocity_mps": 0.0, "tank_level_m": 0.0}
counts = {"junction_pressure": 0, "link_flow": 0, "pipe_velocity": 0, "tank_level": 0}

for hour in range(169):
    require(hour in js_samples, f"App benchmark did not capture hour {hour}")
    timestamp = hour * 3600
    require(timestamp in node_pressure.index, f"Reference has no hydraulic result at hour {hour}")
    row = js_samples[hour]
    app_nodes = {item["id"]: item for item in row["nodes"]}
    app_tanks = {item["id"]: item for item in row["tanks"]}
    app_links = {item["id"]: item for item in row["links"]}
    require(set(app_nodes) == set(junction_ids), f"Hour {hour}: app junction IDs do not match reference network")
    require(set(app_tanks) == set(tank_ids), f"Hour {hour}: app tank IDs do not match reference network")
    require(set(app_links) == set(link_ids), f"Hour {hour}: app link IDs do not match reference network")

    for node_id in junction_ids:
        error = close_enough(f"hour {hour} junction {node_id} pressure (m)", app_nodes[node_id]["pressureM"], node_pressure.loc[timestamp, node_id], 0.03)
        max_errors["pressure_m"] = max(max_errors["pressure_m"], error)
        counts["junction_pressure"] += 1

    for link_id in link_ids:
        error = close_enough(f"hour {hour} link {link_id} flow (L/s)", app_links[link_id]["flowLps"], link_flow.loc[timestamp, link_id] * 1000.0, 0.03)
        max_errors["flow_lps"] = max(max_errors["flow_lps"], error)
        counts["link_flow"] += 1

    for pipe_id in pipe_ids:
        error = close_enough(f"hour {hour} pipe {pipe_id} velocity (m/s)", app_links[pipe_id]["velocityMps"], link_velocity.loc[timestamp, pipe_id], 0.003)
        max_errors["pipe_velocity_mps"] = max(max_errors["pipe_velocity_mps"], error)
        counts["pipe_velocity"] += 1

    for tank_id in tank_ids:
        elevation = float(wn.get_node(tank_id).elevation)
        expected_level = node_head.loc[timestamp, tank_id] - elevation
        error = close_enough(f"hour {hour} tank {tank_id} level (m)", app_tanks[tank_id]["levelM"], expected_level, 0.03)
        max_errors["tank_level_m"] = max(max_errors["tank_level_m"], error)
        counts["tank_level"] += 1

final_trace = float(node_quality.loc[168 * 3600, "Lake"])
require(abs(final_trace - 100.0) <= 0.001, f"WNTR reference Lake trace expected 100%, got {final_trace}")
expected_counts = {
    "junction_pressure": 92 * 169,
    "link_flow": 119 * 169,
    "pipe_velocity": 117 * 169,
    "tank_level": 3 * 169,
}
require(counts == expected_counts, f"Unexpected comparison sample counts: {counts}")
print(json.dumps({
    "reference_engine": "USEPA WNTR EpanetSimulator / EPANET 2.2",
    "input": "app-exported Net3-roundtrip.inp",
    "duration_hours": 168,
    "network": {"junctions": len(junction_ids), "links": len(link_ids), "pipes": len(pipe_ids), "tanks": len(tank_ids)},
    "hourly_comparison_samples": counts,
    "max_absolute_difference": max_errors,
    "final_lake_trace_percent": final_trace,
    "result": "PASS"
}, indent=2))
