# -*- coding: utf-8 -*-
"""缺卡清单文本（T4）双端对拍：missingListText 为纯逻辑（无 DOM/无依赖），
从 static/ui-collection.js 与 miniprogram/utils/ui.js 分别提取函数源码，
在 node 中执行并对拍三种输入（空缺卡 / 全缺 / >60 张），断言输出逐字节一致且符合格式。"""
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _extract_fn(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"function {name}\(.*?\n\}}", text, re.S)
    if not m:
        raise AssertionError(f"{path.name} 未找到 {name}（实现漂移？）")
    return m.group(0)


def _run_js(fn_src: str, cards: list) -> str:
    script = (
        f'{fn_src}\n'
        f'const cards = {json.dumps(cards, ensure_ascii=False)};\n'
        f'console.log(JSON.stringify(missingListText("测试弹名", cards, 100)));'
    )
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"node 执行 missingListText 失败: {out.stderr}")
    return json.loads(out.stdout)


def _card(i, rarity="R"):
    return {"cardIndex": f"{i:03d}", "cardName": f"测试卡{i}", "rarity": rarity}


class TestMissingListText(unittest.TestCase):
    """T4：缺卡文本清单格式与双端一致（逐字节）。"""

    def setUp(self):
        self.web = _extract_fn(ROOT / "static" / "ui-collection.js", "missingListText")
        self.mini = _extract_fn(ROOT / "miniprogram" / "utils" / "ui.js", "missingListText")

    def test_three_cases(self):
        cases = [
            [],                                # 空缺卡
            [_card(1), _card(2, "RR")],        # 少量缺卡
            [_card(i) for i in range(1, 76)],  # >60 张（文本不分页，逐行列出）
        ]
        for i, cards in enumerate(cases):
            with self.subTest(case=i):
                web = _run_js(self.web, cards)
                mini = _run_js(self.mini, cards)
                # 双端逐字节一致
                self.assertEqual(web, mini)
                expect_head = f"【PTCG拆卡模拟器】测试弹名 缺卡 {len(cards)}/100："
                self.assertTrue(web.startswith(expect_head), web[:80])
                lines = web.splitlines()
                self.assertEqual(len(lines), 1 + len(cards))
                for j, c in enumerate(cards):
                    self.assertEqual(lines[j + 1], f"{c['cardIndex']} {c['cardName']}（{c['rarity']}）")

    def test_missing_rarity_defaults_to_n(self):
        cards = [{"cardIndex": "009", "cardName": "无稀有度卡", "rarity": ""}]
        out = _run_js(self.web, cards)
        self.assertTrue(out.endswith("009 无稀有度卡（N）"), out)


if __name__ == "__main__":
    unittest.main()
