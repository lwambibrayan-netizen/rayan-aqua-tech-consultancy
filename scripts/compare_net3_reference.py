#!/usr/bin/env python3
"""Independent Net3 reference run using USEPA WNTR's bundled EPANET 2.2 toolkit."""
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
    delta = abs(float(actual) - float(expected))
    require(math.isfinite(float(actual)), f"{label}: JS result is not finite: {actual}")
    require(math.isfinite(float(expected)), f"{label}: reference result is not finite: {expected}")
    require(delta <= tolerance, f"{label}: mismatch JS={actual}, WNTR/EPANET={expected}, delta={delta}, tolerance={tolerance}")
    return delta

require(INP.exists(), f"Missing app-exported INP: {INP}")
require(JS_RESULTS.exists(), f"Missing EPANET-JS samples: {JS_RESULTS}")
js = json.loads(JS_RESULTS.read_text())
js_samples = {int(round(row["timeHours"])): row for row in js["hourlySamples"]}
require(len(js_samples) >= 169, f"Expected at least 169 hourly JS samples, got {len(js_samples)}")

wn = wntr.network.WaterNetworkModel(str(INP))
require(wn.options.time.duration == 168 * 3600, f"Reference model duration is {wn.options.time.duration}, not 168 hours")
require(wn.options.time.hydraulic_timestep == 3600, "Unexpected hydraulic timestep")
require(wn.options.time.quality_timestep == 300, "Unexpected quality timestep")
require(wn.options.quality.parameter == "TRACE", f"Expected TRACE quality mode, got {wn.options.quality.parameter}")
require(wn.options.quality.trace_node == "Lake", f"Expected Lake trace node, got {wn.options.quality.trace_node}")

sim = wntr.sim.EpanetSimulator(wn)
ref = sim.run_sim(version=2.2, convergence_error=True)
node_pressure = ref.node["pressure"]
link_flow = ref.link["flowrate"]
link_velocity = ref.link["velocity"]
node_head = ref.node["head"]
node_quality = ref.node["quality"]
max_errors = {"pressure_m": 0.0, "flow_lps": 0.0, "velocity_mps": 0.0, "tank_level_m": 0.0}
compared = 0
tank_elevation = float(wn.get_node("1").elevation)

for hour in range(169):
    require(hour in js_samples, f"EPANET-JS benchmark did not capture hour {hour}")
    timestamp = hour * 3600
    require(timestamp in node_pressure.index, f"Independent reference has no hydraulic result at hour {hour}")
    row = js_samples[hour]
    errors = {
        "pressure_m": close_enough(f"hour {hour} node 101 pressure (m)", row["pressureAt101M"], node_pressure.loc[timestamp, "101"], 0.03),
        "flow_lps": close_enough(f"hour {hour} pipe 60 flow (L/s)", row["pipe60FlowLps"], link_flow.loc[timestamp, "60"] * 1000.0, 0.03),
        "velocity_mps": close_enough(f"hour {hour} pipe 60 velocity (m/s)", row["pipe60VelocityMps"], link_velocity.loc[timestamp, "60"], 0.003),
        "tank_level_m": close_enough(f"hour {hour} tank 1 level (m)", row["tank1LevelM"], node_head.loc[timestamp, "1"] - tank_elevation, 0.03),
    }
    for key, value in errors.items():
        max_errors[key] = max(max_errors[key], value)
    compared += 1

final_trace = float(node_quality.loc[168 * 3600, "Lake"])
require(abs(final_trace - 100.0) <= 0.001, f"WNTR reference Lake trace expected 100%, got {final_trace}")
print(json.dumps({
    "reference_engine": "USEPA WNTR EpanetSimulator / EPANET 2.2",
    "input": "app-exported Net3-roundtrip.inp",
    "duration_hours": 168,
    "hourly_comparison_points": compared,
    "max_absolute_difference": max_errors,
    "final_lake_trace_percent": final_trace,
    "result": "PASS"
}, indent=2))
