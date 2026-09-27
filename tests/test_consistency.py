# -*- coding: utf-8 -*-
"""跨实现一致性守卫（台账 BE-008 / BE-009 / BE-018）。

同一协议在仓库里存在多份刻意保留的实现（合并风险大于收益），
以测试锁定"同输入同输出"，任一份漂移即在此拦截：

- BE-008  atomic_write_json / _md5 双实现（fetch_data.py ↔ pricetool/store.py、sync.py）
- BE-009  spec_brief 三平台三实现（server/api.py ↔ android/build_assets.py ↔ tools/build_miniprogram.py）
- BE-018  卡号归一 normIdx 三镜像（static/app.js ↔ pricetool/store.norm_index ↔ fetch_data 拆分 zfill）
"""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config  # noqa: E402
import fetch_data  # noqa: E402
from pricetool import store as pt_store  # noqa: E402
from pricetool.sync import _md5 as sync_md5  # noqa: E402
from server.api import _spec_brief as brief_server  # noqa: E402


class TestAtomicWriteAndMd5(unittest.TestCase):
    """BE-008：两套原子写与两处 md5 必须逐字节一致。"""

    def test_atomic_write_json_identical_bytes(self):
        obj = {"b": 1, "a": ["中文", None, True, 1.5],
               "nested": {"k": "v", "n": 2}}
        with tempfile.TemporaryDirectory() as tmp:
            p1 = Path(tmp) / "a" / "via_fetch.json"
            p2 = Path(tmp) / "b" / "via_store.json"
            p1.parent.mkdir(exist_ok=True)   # fetch_data 版不自建父目录（调用方负责，两版的记录在案差异）
            fetch_data._atomic_write_json(p1, obj)
            pt_store.atomic_write_json(p2, obj)      # store 版自建父目录
            self.assertEqual(p1.read_bytes(), p2.read_bytes())

    def test_md5_dual_impl_agree(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.json"
            p.write_bytes(b"\xe4\xb8\xad\xff binary-ish")
            self.assertEqual(fetch_data._md5(p), sync_md5(p))


def _brief_build_assets(code: str) -> list:
    import android.build_assets as ba  # noqa: PLC0415
    return ba.spec_brief_full(code)


def _brief_miniprogram(code: str) -> list:
    import tools.build_miniprogram as bm  # noqa: PLC0415
    return bm.spec_brief(code)


class TestSpecBriefThreePlatforms(unittest.TestCase):
    """BE-009：spec_brief 三平台实现的公共字段必须等价（形状差异是刻意的）。"""

    def test_common_fields_equivalent_for_all_drawable_sets(self):
        idx = json.loads((ROOT / "data" / "sets_index.json").read_text(encoding="utf-8"))
        checked = 0
        for e in idx:
            if not config.set_specs(e["id"]):
                continue
            with self.subTest(set=e["id"]):
                a, b, c = (brief_server(e["id"]), _brief_build_assets(e["id"]),
                           _brief_miniprogram(e["id"]))
                self.assertEqual([s["key"] for s in a], [s["key"] for s in b])
                self.assertEqual([s["key"] for s in a], [s["key"] for s in c])
                for sa, sb, sc in zip(a, b, c):
                    common = ("id", "key", "label", "note", "price",
                              "priceCny", "boxPacks", "packSize", "default")
                    self.assertEqual({k: sa[k] for k in common}, {k: sb[k] for k in common})
                    self.assertEqual({k: sa[k] for k in common}, {k: sc[k] for k in common})
            checked += 1
        self.assertGreater(checked, 40, f"可拆弹数量异常（仅 {checked}）")


def _extract_normidx_source() -> str:
    """从静态脚本中提取前端 normIdx 函数源码（R6 冻结实现；拆分后跟随文件路径更新）。"""
    for rel in ("static/app.js", "static/core.js"):
        text = (ROOT / rel).read_text(encoding="utf-8") if (ROOT / rel).exists() else ""
        m = re.search(r"function normIdx\(v\) \{.*?\n\}", text, re.S)
        if m:
            return m.group(0)
    raise AssertionError("未找到前端 normIdx 实现（R6 镜像漂移？）")


def _js_norm_idx(values: list) -> list:
    """把前端 normIdx 源码注入 node 执行，返回对 values 逐项归一的结果。"""
    src = _extract_normidx_source()
    script = (f"{src}\nconsole.log(JSON.stringify("
              f"[{json.dumps(values).strip('[]')}].map(normIdx)));")
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"node 执行 normIdx 失败: {out.stderr}")
    return json.loads(out.stdout)


class TestNormIndexMirrors(unittest.TestCase):
    """BE-018：卡号归一三镜像一致（R6：setCode__cardIndex 三位补零）。"""

    CASES = ["1", "07", "128", "0012", "FIR", "B", " 5 ", "", 5, "12.5", "★★★"]

    def test_frontend_matches_pricetool(self):
        js = _js_norm_idx(self.CASES)
        py = [pt_store.norm_index(v) for v in self.CASES]
        self.assertEqual(js, py)

    def test_numeric_path_matches_fetch_data_zfill(self):
        for v in self.CASES:
            s = str(v).strip()
            if s.isdigit():
                self.assertEqual(pt_store.norm_index(v), s.zfill(3))


if __name__ == "__main__":
    unittest.main()
