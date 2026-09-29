# -*- coding: utf-8 -*-
"""稳定性/性能基线测量（计划阶段 0 第 4 步；重构前后对照，不做 CI 断言）。

用法：python tools/baseline_perf.py [--draws 500] [--imgs 200] [--label dev基线]
输出：耗时/内存摘要打印 + 以 JSON 行追加写入 build/baseline_perf.jsonl
（build/ 不入库，报告由人工引用其数字）。

口径：
- 500 次连续 POST /api/draw（CSV1C sv5，固定种子序列）经 Flask test_client；
- 200 次 GET /img 代理请求：预置本地缓存命中（不回源、不依赖外网）；
- 内存用 tracemalloc 峰值（Python 堆口径，进程 RSS 不引入额外依赖）。
"""
import argparse
import json
import random
import sys
import time
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app  # noqa: E402

# 1x1 透明 PNG（缓存预置用，/img 命中后 send_file 直出）
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082")


def bench_draws(client, n: int) -> dict:
    lat = []
    tracemalloc.start()
    t0 = time.perf_counter()
    for i in range(n):
        random.seed(i)
        r = client.post("/api/draw", json={"set": "CSV1C", "spec": "sv5", "packs": 1})
        assert r.status_code == 200, r.status_code
        lat.append(time.perf_counter() - t0)
    wall = time.perf_counter() - t0
    cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {"n": n, "wall_s": round(wall, 3), "req_per_s": round(n / wall, 1),
            "avg_ms": round(wall * 1000 / n, 2), "tracemalloc_peak_mb": round(peak / 1048576, 2)}


def bench_imgs(client, n: int) -> dict:
    """预置 n 张缓存图（专用代码 BASELINE，跑完清理），测量缓存命中直出路径。"""
    code = "BASELINE"
    cache_dir = app.IMG_CACHE / code
    cache_dir.mkdir(parents=True, exist_ok=True)
    made = []
    try:
        for i in range(n):
            p = cache_dir / f"{i:03d}.png"
            if not p.exists():
                p.write_bytes(TINY_PNG)
            made.append(p)
        lat = []
        tracemalloc.start()
        t0 = time.perf_counter()
        for i in range(n):
            r = client.get(f"/img/{code}/{i:03d}")
            assert r.status_code == 200, f"/img {i}: {r.status_code}"
            lat.append(time.perf_counter() - t0)
        wall = time.perf_counter() - t0
        cur, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return {"n": n, "wall_s": round(wall, 3), "req_per_s": round(n / wall, 1),
                "avg_ms": round(wall * 1000 / n, 2), "tracemalloc_peak_mb": round(peak / 1048576, 2)}
    finally:
        for p in made:
            try:
                p.unlink()
            except OSError:
                pass
        try:
            cache_dir.rmdir()
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--draws", type=int, default=500)
    ap.add_argument("--imgs", type=int, default=200)
    ap.add_argument("--label", default="baseline")
    args = ap.parse_args()

    client = app.app.test_client()
    # 预热：首请求含索引/卡表加载
    assert client.get("/api/sets").status_code == 200

    draw_res = bench_draws(client, args.draws)
    img_res = bench_imgs(client, args.imgs)
    result = {"label": args.label, "ts": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
              "draw": draw_res, "img": img_res}
    print(json.dumps(result, ensure_ascii=False, indent=1))

    out = ROOT / "build" / "baseline_perf.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(result, ensure_ascii=False) + "\n")
    print(f"已追加到 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
