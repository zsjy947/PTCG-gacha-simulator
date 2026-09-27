# -*- coding: utf-8 -*-
"""API golden 快照测试 —— 重构安全网（docs/重构与全量审查计划.md 阶段 0）。

对确定性端点做完整 JSON 快照断言（契约 R1：JSON 形状、错误码、{"error":...} 文案逐字不变）；
/api/draw 用固定随机种子做确定性输出断言 + packs 钳制边界（0/1/40/41）。

快照存于 tests/golden/*.json。重新生成（仅当有意变更契约时）：
    PTCG_UPDATE_GOLDEN=1 python -m unittest tests.test_api_golden

注意：
- /api/health 含 time.time()、/api/cache/info 依赖运行时缓存体积，只断言形状不快照；
- /api/card/<set>/<idx> 走上游网络，不进 golden（阶段 4 边界矩阵用桩客户端覆盖）。
"""
import hashlib
import json
import os
import random
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app  # noqa: E402 （导入即完成 Flask app 与数据目录初始化，不启动服务）

GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE_GOLDEN = os.environ.get("PTCG_UPDATE_GOLDEN") == "1"

# golden 绑定的真实数据弹（data/cards 内确定存在）
SET_SV = "CSV1C"        # 朱&紫 补充包：5/20张装
SET_GEM = "CBB1C"       # 宝石包 VOL.1：4张装全闪（boxPacks 覆盖 15）
SET_THEME = "CSVL1C"    # 专题包：不开放拆卡


def _load_golden(name: str):
    path = GOLDEN_DIR / f"{name}.json"
    if UPDATE_GOLDEN:
        return None, path
    if not path.exists():
        raise AssertionError(f"golden 快照缺失：{path}（PTCG_UPDATE_GOLDEN=1 生成）")
    return json.loads(path.read_text(encoding="utf-8")), path


def _save_golden(path: Path, payload) -> None:
    GOLDEN_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def _assert_golden(test: unittest.TestCase, name: str, status: int, body):
    """status + 解析后 JSON 与快照整体相等（jsonify 键序稳定，等价逐字节）。"""
    golden, path = _load_golden(name)
    actual = {"status": status, "body": body}
    if UPDATE_GOLDEN:
        _save_golden(path, actual)
        return
    test.assertEqual(golden, actual, f"golden 快照不一致：{name}")


def _draw_body(set_id, spec=None, packs=None):
    body = {"set": set_id}
    if spec is not None:
        body["spec"] = spec
    if packs is not None:
        body["packs"] = packs
    return body


def _post_draw(client, set_id, spec=None, packs=None, seed=42):
    """固定种子 POST /api/draw：同进程同种子 → 输出确定。"""
    random.seed(seed)
    r = client.post("/api/draw", json=_draw_body(set_id, spec, packs))
    return r.status_code, r.get_json()


def _project_pack(resp_body) -> list:
    """卡包投影（减小 golden 体积，仍覆盖逐卡字段）。"""
    return [[{"i": c.get("cardIndex"), "r": c.get("rarity"), "s": c.get("slotName"),
              "k": c.get("slotKind"), "img": c.get("image")} for c in pack]
            for pack in (resp_body or {}).get("packs", [])]


class TestGoldenEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.app.test_client()

    def test_01_index_page(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"PTCG", r.data)

    def test_02_api_sets(self):
        r = self.client.get("/api/sets")
        self.assertEqual(r.status_code, 200)
        _assert_golden(self, "api_sets", r.status_code, r.get_json())

    def test_03_set_cards(self):
        r = self.client.get(f"/api/sets/{SET_SV}/cards")
        self.assertEqual(r.status_code, 200)
        _assert_golden(self, "set_cards_sv", r.status_code, r.get_json())

    def test_04_set_probabilities(self):
        for set_id, name in ((SET_SV, "sv"), (SET_GEM, "gem"), ("30THC", "fest")):
            r = self.client.get(f"/api/sets/{set_id}/probabilities")
            self.assertEqual(r.status_code, 200, set_id)
            _assert_golden(self, f"probabilities_{name}", r.status_code, r.get_json())

    def test_05_draw_deterministic(self):
        status, body = _post_draw(self.client, SET_SV, spec="sv5", packs=1, seed=20260928)
        self.assertEqual(status, 200)
        self.assertEqual(body.get("mode"), "pack")
        _assert_golden(self, "draw_sv5_seed", status, {
            "mode": body.get("mode"), "spec": body.get("spec"),
            "packs": _project_pack(body),
        })

    def test_06_draw_variant_deterministic(self):
        """太晶盛聚封入变体（7+3/6+4 每包随机落位）固定种子确定性。"""
        status, body = _post_draw(self.client, "CSV9.5C", spec="tera10", packs=3, seed=7)
        self.assertEqual(status, 200)
        _assert_golden(self, "draw_tera10_seed", status, _project_pack(body))

    def test_07_draw_packs_clamp(self):
        """packs 钳制边界 0/1/40/41：包数与全量输出（sha256）双重断言。"""
        cases = {"0": 1, "1": 1, "40": 40, "41": 40}
        for raw, expect_n in cases.items():
            with self.subTest(packs=raw):
                status, body = _post_draw(self.client, SET_SV, spec="sv5", packs=raw, seed=99)
                self.assertEqual(status, 200)
                self.assertEqual(len(body["packs"]), expect_n)
                digest = hashlib.sha256(
                    json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")
                ).hexdigest()
                _assert_golden(self, f"draw_clamp_{raw}", status,
                               {"packs": len(body["packs"]), "sha256": digest})
        # 缺省 packs（不传）等价 1
        status, body = _post_draw(self.client, SET_SV, spec="sv5", packs=None, seed=99)
        self.assertEqual(status, 200)
        self.assertEqual(len(body["packs"]), 1)

    def test_08_health_shape(self):
        import time
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["ok"], True)
        self.assertIsInstance(body["time"], float)
        self.assertLess(abs(body["time"] - time.time()), 60)

    def test_09_version(self):
        r = self.client.get("/api/version")
        from version import APP_VERSION
        self.assertEqual(r.get_json(), {"version": APP_VERSION})

    def test_10_data_manifest(self):
        r = self.client.get("/api/data-manifest")
        self.assertEqual(r.status_code, 200)
        _assert_golden(self, "data_manifest", r.status_code, r.get_json())

    def test_11_prices(self):
        r = self.client.get("/api/prices")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertIsInstance(body.get("prices"), dict)
        _assert_golden(self, "prices_meta", r.status_code,
                       {"generated": body.get("generated"), "count": body.get("count"),
                        "keys_sample": sorted(body["prices"])[:5]})

    def test_12_store_roundtrip(self):
        """store 读写往返（写入临时文件，不碰真实 user_store.json）。"""
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "user_store.json"
            patched = []
            for mod_name in ("server.store", "app"):
                mod = sys.modules.get(mod_name)
                if mod is not None and hasattr(mod, "USER_STORE"):
                    patched.append((mod, mod.USER_STORE))
                    mod.USER_STORE = target
            try:
                r = self.client.get("/api/store/get")
                self.assertEqual(r.get_json(), {"data": {}})
                r = self.client.post("/api/store/set",
                                     json={"data": {"ptcg_stats": "{\"CSV1C\":{}}"}})
                self.assertEqual(r.get_json(), {"ok": True})
                r = self.client.get("/api/store/get")
                _assert_golden(self, "store_roundtrip", r.status_code, r.get_json())
                self.assertTrue(target.exists())
            finally:
                for mod, old in patched:
                    mod.USER_STORE = old

    def test_13_store_set_invalid(self):
        r = self.client.post("/api/store/set", json={"data": "not-a-dict"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json(), {"error": "非法参数"})
        r = self.client.post("/api/store/set", json={"nodata": 1})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json(), {"error": "非法参数"})

    def test_14_cache_info_shape(self):
        r = self.client.get("/api/cache/info")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertIsInstance(body["total_bytes"], int)
        self.assertRegex(body["label"], r"^(\d+(\.\d+)? (MB|KB))$")


class TestGoldenErrors(unittest.TestCase):
    """错误码与 {"error":...} 文案逐字快照。"""

    @classmethod
    def setUpClass(cls):
        cls.client = app.app.test_client()

    def test_sets_cards_errors(self):
        for path, name in (
            ("/api/sets/../etc/cards", None),  # Flask 404 路由不匹配，不入 golden
            ("/api/sets/BAD~SET/cards", "err_bad_set_id"),
            ("/api/sets/NOSUCH/cards", "err_missing_set"),
            ("/api/sets/CSVL1C/probabilities", None),  # 专题包无规格 → {"specs": []}
        ):
            r = self.client.get(path)
            self.assertIn(r.status_code, (200, 400, 404), path)
            if name:
                _assert_golden(self, name, r.status_code, r.get_json())

    def test_draw_errors(self):
        cases = [
            (_draw_body("../evil"), "err_draw_bad_set", 400),
            (_draw_body(SET_THEME), "err_draw_no_spec", 400),
            (_draw_body(SET_SV, spec="nonexistent"), "err_draw_bad_spec", 404),
            # 不存在的弹无规格 → 基线走「无公开随机包规格」400 分支
            (_draw_body("NOSUCH"), "err_draw_missing_set", 400),
        ]
        for body, name, expect in cases:
            r = self.client.post("/api/draw", json=body)
            self.assertEqual(r.status_code, expect, f"{body} → {expect}")
            _assert_golden(self, name, r.status_code, r.get_json())

    def test_img_guard(self):
        r = self.client.get("/img/BAD~/001")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json(), {"error": "非法参数"})

    def test_card_detail_guard(self):
        r = self.client.get("/api/card/BAD~/001")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json(), {"error": "非法参数"})

    def test_draw_packs_non_numeric_baseline(self):
        """BE-001 基线行为记录：packs 非数字当前 500（阶段 1 修复为 400）。
        修复本条时同步更新本断言并在台账闭环。"""
        r = self.client.post("/api/draw", json=_draw_body(SET_SV, spec="sv5", packs="abc"))
        self.assertEqual(r.status_code, 500)  # 基线：未捕获 ValueError


if __name__ == "__main__":
    unittest.main()
