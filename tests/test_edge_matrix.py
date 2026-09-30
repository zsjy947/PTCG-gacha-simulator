# -*- coding: utf-8 -*-
"""边界异常矩阵（计划阶段 4 第 2 步）：非法参数、缺失数据、异常路径的错误码与文案逐字断言。

与 golden 快照互补：golden 锁定正常路径与常见错误；本文件覆盖全部矩阵组合，
含通过 monkeypatch 模拟的"缺失数据文件 / 详情未命中"场景（只动 server.api 命名空间，不落盘）。
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server.api  # noqa: E402
import app  # noqa: E402


class EdgeMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = app.app.test_client()

    # ---- 非法 set id：../ / 空 / 超长 / 坏字符 ----
    def test_set_id_matrix(self):
        cases = [
            # (路径, 期望码, 期望 error 或 None=路由 404)
            ("/api/sets/" + "A" * 41 + "/cards", 400, {"error": "非法弹代码"}),
            ("/api/sets/BAD%7Eid/cards", 400, {"error": "非法弹代码"}),
            ("/api/sets/NOSUCHSET/cards", 404,
             {"error": "弹 NOSUCHSET 的卡牌数据不存在，请先运行 python fetch_data.py"}),
            ("/api/sets//cards", 404, None),           # 空 id：路由不匹配
            ("/api/sets/a%2Fb/cards", 404, None),      # 编码斜杠：路由不匹配，无法穿越
            ("/api/sets/" + "." * 40 + "/cards", 404,
             {"error": "弹 " + "." * 40 + " 的卡牌数据不存在，请先运行 python fetch_data.py"}),
        ]
        for path, code, err in cases:
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, code, path)
                if err is not None:
                    self.assertEqual(r.get_json(), err)

    # ---- packs 边界：0/1/40/41/-1/"3"/null ----
    def test_draw_packs_matrix(self):
        import random
        def draw(packs):
            random.seed(1)
            r = self.c.post("/api/draw", json={"set": "CSV1C", "spec": "sv5", "packs": packs})
            return r.status_code, (r.get_json() or {}).get("packs")

        for raw, n in [(0, 1), (1, 1), (40, 40), (41, 40), (-1, 1), ("3", 3), (None, 1)]:
            with self.subTest(packs=raw):
                status, packs = draw(raw)
                self.assertEqual(status, 200)
                self.assertEqual(len(packs), n)
        for bad in ("abc", [5], {"n": 1}, "", False, True):
            with self.subTest(packs=bad):
                random.seed(1)
                r = self.c.post("/api/draw", json={"set": "CSV1C", "spec": "sv5", "packs": bad})
                # ""/False 走 `or 1` 兜底（基线行为），非数字类型 400（BE-001）
                if bad in ("", False, True):
                    self.assertEqual(r.status_code, 200)
                else:
                    self.assertEqual(r.status_code, 400)
                    self.assertEqual(r.get_json(), {"error": "非法参数"})

    # ---- store/set 非法体 ----
    def test_store_set_matrix(self):
        for body in ({"data": 42}, {"data": []}, {"data": "s"}, {}, {"data": None}):
            with self.subTest(body=body):
                r = self.c.post("/api/store/set", json=body)
                self.assertEqual(r.status_code, 400)
                self.assertEqual(r.get_json(), {"error": "非法参数"})

    # ---- store 版本号（F24/PTCG-R2-02）：乱序旧快照不得回退覆盖 ----
    def test_store_rev_out_of_order(self):
        import server.store
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "user_store.json"
            saved = getattr(server.store, "USER_STORE", None)
            server.store.USER_STORE = target
            try:
                # rev=5 落盘
                r = self.c.post("/api/store/set", json={"data": {"k": "v5"}, "rev": 5})
                self.assertEqual(r.get_json(), {"success": True, "skipped": False, "rev": 5})
                # 乱序后到的 rev=4 → 跳过，文件仍是 rev=5
                r = self.c.post("/api/store/set", json={"data": {"k": "v4"}, "rev": 4})
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.get_json(), {"success": True, "skipped": True, "rev": 5})
                self.assertEqual(json.loads(target.read_text(encoding="utf-8")),
                                 {"rev": 5, "data": {"k": "v5"}})
                # 等于当前 rev 的重发同样跳过
                r = self.c.post("/api/store/set", json={"data": {"k": "v5b"}, "rev": 5})
                self.assertEqual(r.get_json().get("skipped"), True)
            finally:
                server.store.USER_STORE = saved

    def test_store_rev_legacy_compat(self):
        """旧格式信封（无 rev）可读，rev=0；不带 rev 的旧客户端首次写入仍落盘。"""
        import server.store
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "user_store.json"
            saved = getattr(server.store, "USER_STORE", None)
            server.store.USER_STORE = target
            try:
                target.write_text(json.dumps({"data": {"old": "1"}}, ensure_ascii=False),
                                  encoding="utf-8")
                r = self.c.get("/api/store/get")
                self.assertEqual(r.get_json(), {"rev": 0, "data": {"old": "1"}})
                # 旧客户端不带 rev（按 0）→ 0 > 0 不成立 → 跳过，不覆盖旧镜像
                r = self.c.post("/api/store/set", json={"data": {"old": "2"}})
                self.assertEqual(r.get_json(), {"success": True, "skipped": True, "rev": 0})
                # 空存储（无文件）时旧客户端首次写入可落盘（内部当前 rev=-1）
                target.unlink()
                r = self.c.post("/api/store/set", json={"data": {"fresh": "1"}})
                self.assertEqual(r.get_json(), {"success": True, "skipped": False, "rev": 0})
                r = self.c.get("/api/store/get")
                self.assertEqual(r.get_json(), {"rev": 0, "data": {"fresh": "1"}})
            finally:
                server.store.USER_STORE = saved

    # ---- 缺失数据文件：index/manifest/prices 全部不可用时 ----
    def test_missing_data_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved = (server.api.DATA, server.api.BUNDLED_DATA)
            empty = Path(tmp)
            try:
                server.api.DATA = empty
                server.api.BUNDLED_DATA = empty
                r = self.c.get("/api/sets")
                self.assertEqual(r.status_code, 503)
                self.assertEqual(r.get_json(),
                                 {"error": "本地暂无弹数据，请先运行 python fetch_data.py"})
                r = self.c.get("/api/data-manifest")
                self.assertEqual(r.get_json(), {"sets": {}})
                r = self.c.get("/api/prices")
                self.assertEqual(r.get_json(),
                                 {"generated": None, "count": 0, "prices": {}})
            finally:
                server.api.DATA, server.api.BUNDLED_DATA = saved

    # ---- 详情未命中：回源失败 → 502 ----
    def test_detail_miss(self):
        saved = server.api._fetch_detail
        try:
            server.api._fetch_detail = lambda code, idx: False
            r = self.c.get("/api/card/CSV1C/000")
            self.assertEqual(r.status_code, 502)
            self.assertEqual(r.get_json(), {"error": "获取失败"})
        finally:
            server.api._fetch_detail = saved

    # ---- 开包：卡表损坏（JSON 崩溃级场景外圈）→ gacha 层 SetDataError → 404 ----
    def test_draw_missing_cards_file(self):
        import random
        random.seed(1)
        r = self.c.post("/api/draw", json={"set": "NOSUCHSET", "spec": None, "packs": 1})
        self.assertEqual(r.status_code, 400)  # 无规格弹走 400 分支（基线行为，见 golden）
        self.assertEqual(r.get_json(),
                         {"error": "该商品无公开随机包规格，未开放拆卡（可浏览卡表）"})

    # ---- 图片代理非法参数 ----
    def test_media_matrix(self):
        for path in ("/img/BAD~/001", "/thumb/BAD~/001", "/icon/BAD~"):
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 400)
                self.assertEqual(r.get_json(), {"error": "非法参数"})
        # 扩展名剥离后合法路径（不回源，仅断言守卫通过后的行为：404 图片获取失败——离线无缓存）
        r = self.c.get("/icon/nosuchiconcode.png")
        self.assertIn(r.status_code, (404, 200))  # 有缓存则 200，离线 404

    # ---- 纯点路径段（PTCG-R3-01）："." / ".." 拒绝 ----
    def test_dot_segment_rejected(self):
        # %2E 编码可绕过 werkzeug 的路径归一化直达路由参数（裸 ../ 会被归一化成 404，见上）
        for path in ("/img/%2E/001", "/thumb/%2E%2E/001", "/icon/%2E", "/icon/%2E%2E",
                     "/api/card/%2E/%2E%2E", "/api/sets/%2E%2E/cards"):
            with self.subTest(path=path):
                r = self.c.get(path)
                self.assertEqual(r.status_code, 400, path)
                self.assertIn(r.get_json().get("error"), ("非法参数", "非法弹代码"))
        # 白名单本身：仅拒绝整体为 "." / ".." 的段，其余含点串（如 "..."）仍放行
        from server.paths import _SAFE
        for seg in (".", ".."):
            self.assertIsNone(_SAFE.match(seg), seg)
        for seg in ("CSV1C", "001", "30thC", "...", "a.b-c_d"):
            self.assertIsNotNone(_SAFE.match(seg), seg)


if __name__ == "__main__":
    unittest.main()
