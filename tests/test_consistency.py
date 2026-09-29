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
import gacha  # noqa: E402
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


class TestGroupOrderMirror(unittest.TestCase):
    """M-04：前端资产模式（data.js）的分组顺序硬编码副本须与 config.GROUP_ORDER 一致。"""

    def test_datajs_order_matches_config(self):
        text = (ROOT / "static" / "data.js").read_text(encoding="utf-8")
        m = re.search(r"const order = \[([^\]]+)\];", text)
        self.assertTrue(m, "data.js 未找到 order 数组")
        js_order = re.findall(r'"([^"]+)"', m.group(1))
        self.assertEqual(js_order, config.GROUP_ORDER)


class TestProfileParity(unittest.TestCase):
    """T1：确定性画像 rarityProfile / boxProfile 的 JS/Python 双实现必须完全相等。

    任取 3 个可拆弹 × 全规格：确定性函数无随机数，输出 JSON 逐字节断言
    （两侧规范化为排序键 JSON 后比较，浮点逐位一致才可能相等）。
    """

    def _js_profile(self, cards_path: Path, spec_path: Path) -> dict:
        out = subprocess.run(
            ["node", str(Path(__file__).parent / "parity_profile.js"),
             str(cards_path), str(spec_path)],
            capture_output=True, text=True, timeout=120,
        )
        if out.returncode != 0:
            raise RuntimeError(f"node 画像对拍脚本失败: {out.stderr}")
        return json.loads(out.stdout)

    @staticmethod
    def _canon(obj):
        """JSON 数字规范化为 float：JS 的整值浮点（78）经 json.loads 变 int，
        与 Python 的 78.0 仅序列化表示不同；数值统一 float 后再逐字节比较。"""
        if isinstance(obj, dict):
            return {k: TestProfileParity._canon(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [TestProfileParity._canon(v) for v in obj]
        if isinstance(obj, (int, float)) and not isinstance(obj, bool):
            return float(obj)
        return obj

    def test_rarity_and_box_profile_parity(self):
        idx = json.loads((ROOT / "data" / "sets_index.json").read_text(encoding="utf-8"))
        sids = [e["id"] for e in idx if config.set_specs(e["id"])][:3]
        self.assertEqual(len(sids), 3, f"可拆弹不足 3 个（{sids}）")
        with tempfile.TemporaryDirectory() as tmp:
            for sid in sids:
                cards_path = Path(tmp) / f"{sid}_cards.json"
                cards_path.write_text(
                    json.dumps(gacha.load_cards(sid), ensure_ascii=False), encoding="utf-8")
                for spec in config.set_specs(sid):
                    with self.subTest(set=sid, spec=spec["key"]):
                        spec_path = Path(tmp) / f"{sid}_{spec['key']}.json"
                        spec_path.write_text(
                            json.dumps(spec, ensure_ascii=False), encoding="utf-8")
                        js = self._js_profile(cards_path, spec_path)
                        py = {
                            "rarityProfile": gacha.rarity_profile(sid, spec),
                            "boxProfile": gacha.box_profile(sid, spec),
                        }
                        # 逐字节：数字规范化后两端 JSON 文本必须一致（浮点逐位一致才可能相等）
                        self.assertEqual(
                            json.dumps(self._canon(js), sort_keys=True),
                            json.dumps(self._canon(py), sort_keys=True),
                            f"{sid} {spec['key']} 画像不一致")


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


class TestRarityPaletteMirror(unittest.TestCase):
    """FE-004：style.css 的 --r-* 稀有度变量必须与前端 RARITY_COLOR 色板一致。"""

    def test_css_vars_match_js_palette(self):
        js = _js_rarity_palette()
        css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        css_vars = dict(re.findall(r"--r-([A-Za-z]+):\s*(#[0-9a-fA-F]{3,8})\s*;", css))
        self.assertTrue(css_vars, "style.css 中未找到 --r-* 变量")
        for name, color in css_vars.items():
            with self.subTest(rarity=name):
                self.assertEqual(js.get(name), color, f"--r-{name} 与 RARITY_COLOR 不一致")


def _rarity_tables(path: Path) -> dict:
    """从 JS 源码解析稀有度三表：order 列表 + color/label 两个有序键值表。"""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"const RARITY_ORDER = \[([^\]]+)\];", text)
    if not m:
        raise AssertionError(f"{path.name} 未找到 RARITY_ORDER")
    tables = {"order": re.findall(r'"([^"]*)"', m.group(1))}
    for name in ("RARITY_COLOR", "RARITY_LABEL"):
        m = re.search(rf"const {name} = \{{(.*?)\}};", text, re.S)
        if not m:
            raise AssertionError(f"{path.name} 未找到 {name}")
        pairs = re.findall(r'(?:"([^"]+)"|([A-Za-z]+))\s*:\s*"([^"]*)"', m.group(1))
        tables[name] = [(a or b, v) for a, b, v in pairs]  # 保留键序，dict 相等不比顺序
    return tables


class TestMiniprogramRarityMirror(unittest.TestCase):
    """F10/PTCG-R5-01：小程序稀有度三表由构建期从 core.js 单源生成，须与源表一致（顺序与键值）。"""

    def test_uijs_tables_match_core(self):
        core = _rarity_tables(ROOT / "static" / "core.js")
        ui = _rarity_tables(ROOT / "miniprogram" / "utils" / "ui.js")
        self.assertEqual(ui["order"], core["order"])
        self.assertEqual(ui["RARITY_COLOR"], core["RARITY_COLOR"])
        self.assertEqual(ui["RARITY_LABEL"], core["RARITY_LABEL"])
        self.assertEqual(len(core["order"]), 27, "core.js RARITY_ORDER 应为 27 项（新增稀有度须同步三处）")


def _js_rarity_palette() -> dict:
    """在 node 中以最小 DOM 桩加载 static/core.js，取 RARITY_COLOR。"""
    script = (
        'const fs = require("fs");'
        'globalThis.window = {};'
        'const src = fs.readFileSync(process.argv[1], "utf8");'
        'const exports_ = (new Function("window", "document", src + "\\n;return { RARITY_COLOR, RARITY_ORDER };"))'
        '(globalThis.window, { querySelector: () => null, querySelectorAll: () => [] });'
        'console.log(JSON.stringify(exports_.RARITY_COLOR));'
    )
    out = subprocess.run(["node", "-e", script, str(ROOT / "static" / "core.js")],
                         capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"node 加载 core.js 失败: {out.stderr}")
    return json.loads(out.stdout)


if __name__ == "__main__":
    unittest.main()
