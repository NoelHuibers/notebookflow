"""Benchmark 2 — DataBus intermediate-DataFrame handling.

WHAT: ``DataBus`` (engine/notebookflow/core/databus.py) stores the intermediate
outputs (mostly pandas DataFrames) that flow between pipeline nodes. The merged
optimization keeps DataFrames whose deep memory is at or below
``NOTEBOOKFLOW_SPILL_THRESHOLD_BYTES`` (default 8 MB) resident in memory (a
put-time deep copy), and spills only larger frames to Parquet. Setting the
threshold to 0 forces every frame to spill — this restores the previous
"always spill to Parquet" behaviour and is our in-one-run naive BASELINE.

WHY IT MATTERS: a realistic pipeline produces many small-to-medium intermediates
and reads each one back at least once. The Parquet write+read round-trip costs
~150-200 ms for a 50k-row frame; the in-memory deep-copy path costs a fraction
of a millisecond. So the optimization turns hundreds of intermediates from
seconds of I/O into milliseconds, while still spilling genuinely large frames
(the 500k-row case below) so memory stays bounded.

HOW: two modes measured in the SAME run:
  * forced-spill  (NOTEBOOKFLOW_SPILL_THRESHOLD_BYTES=0)      -> naive baseline
  * default       (threshold = 8 MB, env unset)              -> the optimization

Two scenarios:
  A) Single put+get latency, median of REPS (after WARMUPS), for row counts
     [1k, 50k, 500k] x ~8 mixed-dtype columns, in both modes. Reports the
     stored size and whether the frame spilled, so the 500k-row frame is shown
     to still spill under the default threshold.
  B) Sequential pipeline: N x (put+get) at 50k rows for N in [50, 100, 300], in
     both modes -- the "hundreds of intermediate DataFrames" case. Reports total
     wall time, peak Python memory (tracemalloc), and on-disk spill bytes.

Timing uses time.perf_counter(). numpy is seeded deterministically. Each
DataBus uses a fresh temp spill dir, cleaned up afterwards.

Run:  uv --project engine run python bench/databus_bench.py
      (uv sync --extra dev may be needed once for deps; pandas/pyarrow are in
      the engine's main dependency group.)
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import tracemalloc
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import pandas as pd

# Import the product code under test WITHOUT modifying it.
from notebookflow.core.databus import (  # noqa: E402
    _SPILL_THRESHOLD_ENV,
    DataBus,
)

SEED = 12_345
LATENCY_ROWS = [1_000, 50_000, 500_000]
SEQUENTIAL_N = [50, 100, 300]
SEQUENTIAL_ROWS = 50_000
WARMUPS = 3
REPS = 9  # odd, >= 7 measured repetitions -> a true median
# Scenario B measures a whole N-intermediate pipeline as one wall time; we repeat
# it SEQ_TRIALS times and report the median wall to damp run-to-run I/O noise.
# Peak RAM and disk are data-deterministic, so we report their max across trials.
SEQ_TRIALS = 3

_CATEGORIES = np.array(["alpha", "beta", "gamma", "delta", "epsilon"])


def make_dataframe(n_rows: int, seed: int = SEED) -> pd.DataFrame:
    """A deterministic ~8-column mixed-dtype DataFrame of ``n_rows`` rows.

    Columns: int64, int32, float64 x2, float32, bool, and two string columns
    (one low-cardinality categorical-like, one high-cardinality label). The
    schema is fixed so a given row count always yields the same bytes, and so
    50k rows sits below the 8 MB default threshold (stays in memory) while 500k
    rows sits above it (spills) -- exercising both code paths.
    """
    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        {
            "id": np.arange(n_rows, dtype="int64"),
            "code": rng.integers(0, 1000, n_rows).astype("int32"),
            "v1": rng.standard_normal(n_rows),
            "v2": rng.standard_normal(n_rows),
            "v3": rng.random(n_rows).astype("float32"),
            "flag": rng.integers(0, 2, n_rows).astype(bool),
            "cat": _CATEGORIES[rng.integers(0, len(_CATEGORIES), n_rows)],
            "label": [f"row_{i:08d}" for i in range(n_rows)],
        }
    )


@contextmanager
def spill_threshold(value: int | None) -> Iterator[None]:
    """Set (or clear) the spill-threshold env var for the duration of the block.

    ``value=0`` forces every frame to spill (naive baseline); ``value=None``
    clears the override so the DataBus default (8 MB) applies. The threshold is
    snapshotted per DataBus at construction, so a bus must be created INSIDE the
    block for the setting to take effect.
    """
    previous = os.environ.get(_SPILL_THRESHOLD_ENV)
    if value is None:
        os.environ.pop(_SPILL_THRESHOLD_ENV, None)
    else:
        os.environ[_SPILL_THRESHOLD_ENV] = str(value)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(_SPILL_THRESHOLD_ENV, None)
        else:
            os.environ[_SPILL_THRESHOLD_ENV] = previous


def _dir_bytes(root: Path) -> int:
    """Total bytes of all files under ``root`` (0 if it does not exist)."""
    if not root.exists():
        return 0
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file())


def _new_bus() -> tuple[DataBus, Path]:
    spill_dir = Path(tempfile.mkdtemp(prefix="nbf-bench-"))
    return DataBus(spill_dir=spill_dir, pipeline_run_id="bench"), spill_dir


def measure_latency(n_rows: int, mode: str) -> dict[str, Any]:
    """Median put+get round-trip latency for one row count in one mode."""
    df = make_dataframe(n_rows)
    size_bytes = int(df.memory_usage(deep=True).sum())
    threshold = 0 if mode == "forced_spill" else None

    with spill_threshold(threshold):
        bus, spill_dir = _new_bus()
        try:
            # Warmups (own keys, discarded).
            for w in range(WARMUPS):
                bus.put(f"warm{w}", "out", df)
                bus.get(f"warm{w}", "out")

            put_samples: list[float] = []
            get_samples: list[float] = []
            roundtrip_samples: list[float] = []
            for r in range(REPS):
                node = f"n{r}"  # unique key per rep: a fresh intermediate
                t0 = time.perf_counter()
                bus.put(node, "out", df)
                t1 = time.perf_counter()
                bus.get(node, "out")
                t2 = time.perf_counter()
                put_samples.append((t1 - t0) * 1e3)
                get_samples.append((t2 - t1) * 1e3)
                roundtrip_samples.append((t2 - t0) * 1e3)

            # Determine whether the default-threshold path spilled this frame,
            # by inspecting the actual on-disk spill directory.
            spilled = _dir_bytes(spill_dir) > 0
        finally:
            bus.clear_run()
            shutil.rmtree(spill_dir, ignore_errors=True)

    return {
        "rows": n_rows,
        "mode": mode,
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / 1e6, 3),
        "spilled": spilled,
        "put_median_ms": round(statistics.median(put_samples), 4),
        "get_median_ms": round(statistics.median(get_samples), 4),
        "putget_median_ms": round(statistics.median(roundtrip_samples), 4),
        "putget_min_ms": round(min(roundtrip_samples), 4),
        "putget_max_ms": round(max(roundtrip_samples), 4),
    }


def _sequential_trial(
    df: pd.DataFrame, n_intermediates: int, threshold: int | None
) -> tuple[float, int, int]:
    """One trial: returns (wall_seconds, peak_bytes, disk_bytes)."""
    with spill_threshold(threshold):
        bus, spill_dir = _new_bus()
        try:
            # One warmup round-trip so first-touch import/JIT costs are excluded.
            bus.put("warm", "out", df)
            bus.get("warm", "out")
            bus.clear_node("warm")

            tracemalloc.start()
            tracemalloc.reset_peak()
            t0 = time.perf_counter()
            for i in range(n_intermediates):
                node = f"node{i}"  # every intermediate retained (fan-through)
                bus.put(node, "out", df)
                bus.get(node, "out")
            wall_s = time.perf_counter() - t0
            _current, peak_bytes = tracemalloc.get_traced_memory()
            tracemalloc.stop()

            disk_bytes = _dir_bytes(spill_dir)
        finally:
            bus.clear_run()
            shutil.rmtree(spill_dir, ignore_errors=True)
    return wall_s, peak_bytes, disk_bytes


def measure_sequential(n_intermediates: int, mode: str) -> dict[str, Any]:
    """N x (put+get) at 50k rows: median-of-trials wall time, peak RAM, disk.

    The pipeline is a single timed unit, so we repeat it SEQ_TRIALS times and
    report the median wall time (I/O-noise robust). Peak RAM and disk are
    data-deterministic, so their max across trials is reported.
    """
    df = make_dataframe(SEQUENTIAL_ROWS)
    threshold = 0 if mode == "forced_spill" else None

    walls: list[float] = []
    peaks: list[int] = []
    disks: list[int] = []
    for _ in range(SEQ_TRIALS):
        wall_s, peak_bytes, disk_bytes = _sequential_trial(df, n_intermediates, threshold)
        walls.append(wall_s)
        peaks.append(peak_bytes)
        disks.append(disk_bytes)

    wall_s = statistics.median(walls)
    peak_bytes = max(peaks)
    disk_bytes = max(disks)
    return {
        "n_intermediates": n_intermediates,
        "rows": SEQUENTIAL_ROWS,
        "mode": mode,
        "trials": SEQ_TRIALS,
        "total_wall_ms": round(wall_s * 1e3, 3),
        "total_wall_min_ms": round(min(walls) * 1e3, 3),
        "total_wall_max_ms": round(max(walls) * 1e3, 3),
        "per_intermediate_ms": round(wall_s * 1e3 / n_intermediates, 4),
        "peak_tracemalloc_mib": round(peak_bytes / 1024**2, 2),
        "disk_used_mib": round(disk_bytes / 1024**2, 2),
    }


def _git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True
        ).strip()
    except Exception:
        return "unknown"


def _ram_gib() -> float | None:
    """Best-effort total RAM in GiB (Windows via ctypes, POSIX via sysconf)."""
    try:
        if sys.platform.startswith("win"):
            import ctypes

            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = _MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return round(stat.ullTotalPhys / 1024**3, 2)
        pages = os.sysconf("SC_PHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        return round(pages * page_size / 1024**3, 2)
    except Exception:
        return None


def capture_machine() -> dict[str, Any]:
    return {
        "os": platform.system(),
        "os_release": platform.release(),
        "os_version": platform.version(),
        "platform": platform.platform(),
        "arch": platform.machine(),
        "cpu_model": platform.processor() or "unknown",
        "logical_cores": os.cpu_count(),
        "ram_gib": _ram_gib(),
        "python_version": platform.python_version(),
        "pandas_version": pd.__version__,
        "numpy_version": np.__version__,
        "git_commit": _git_commit(),
        "captured_at_iso": datetime.now(timezone.utc).isoformat(),
        "hostname": platform.node(),
    }


def _speedup_table(latency: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """forced-spill / default putget ratio per row count (the speedup)."""
    by_key: dict[tuple[int, str], dict[str, Any]] = {
        (r["rows"], r["mode"]): r for r in latency
    }
    out: list[dict[str, Any]] = []
    for rows in LATENCY_ROWS:
        spill = by_key[(rows, "forced_spill")]
        default = by_key[(rows, "default")]
        d = default["putget_median_ms"]
        out.append(
            {
                "rows": rows,
                "forced_spill_ms": spill["putget_median_ms"],
                "default_ms": d,
                "speedup_x": round(spill["putget_median_ms"] / d, 1) if d > 0 else None,
                "default_spilled": default["spilled"],
            }
        )
    return out


def main() -> None:
    np.random.seed(SEED)  # belt-and-suspenders global seed
    machine = capture_machine()

    latency: list[dict[str, Any]] = []
    for rows in LATENCY_ROWS:
        for mode in ("forced_spill", "default"):
            res = measure_latency(rows, mode)
            latency.append(res)
            print(
                f"[latency] rows={res['rows']:>7} mode={res['mode']:<12} "
                f"size={res['size_mb']:>7.2f}MB spilled={res['spilled']!s:<5} "
                f"put+get median={res['putget_median_ms']:.4f}ms"
            )

    sequential: list[dict[str, Any]] = []
    for n in SEQUENTIAL_N:
        for mode in ("forced_spill", "default"):
            res = measure_sequential(n, mode)
            sequential.append(res)
            print(
                f"[sequential] N={res['n_intermediates']:>4} mode={res['mode']:<12} "
                f"wall={res['total_wall_ms']:>9.2f}ms "
                f"peakRAM={res['peak_tracemalloc_mib']:>7.2f}MiB "
                f"disk={res['disk_used_mib']:>7.2f}MiB"
            )

    speedups = _speedup_table(latency)
    for s in speedups:
        print(
            f"[speedup] rows={s['rows']:>7} forced={s['forced_spill_ms']:.4f}ms "
            f"default={s['default_ms']:.4f}ms -> {s['speedup_x']}x "
            f"(default spilled={s['default_spilled']})"
        )

    fragment = {
        "benchmark": "databus_dataframe",
        "machine": machine,
        "config": {
            "seed": SEED,
            "latency_rows": LATENCY_ROWS,
            "sequential_n": SEQUENTIAL_N,
            "sequential_rows": SEQUENTIAL_ROWS,
            "sequential_trials": SEQ_TRIALS,
            "warmups": WARMUPS,
            "reps": REPS,
            "default_threshold_bytes": 8_000_000,
        },
        "latency": latency,
        "sequential": sequential,
        "speedups": speedups,
    }

    out_path = os.environ.get("BENCH_OUT")
    if not out_path:
        results_dir = Path(__file__).resolve().parent / "results"
        results_dir.mkdir(parents=True, exist_ok=True)
        date = datetime.now().strftime("%Y-%m-%d")
        host = "".join(
            c if c.isalnum() or c in "-_" else "-"
            for c in platform.node().lower()
        )
        out_path = str(results_dir / f"{date}-{host}-databus.fragment.json")

    Path(out_path).write_text(json.dumps(fragment, indent=2) + "\n", encoding="utf-8")
    print(f"\n[databus bench] wrote fragment -> {out_path}")


if __name__ == "__main__":
    main()
