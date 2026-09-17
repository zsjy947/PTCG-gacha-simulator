# -*- coding: utf-8 -*-
"""mulberry32 的 Python 实现 —— 与 shared/gacha.js 逐位一致。

跨引擎对拍的关键：两侧注入同一算法、同一种子的随机源，
相同输入必须产出完全相同的卡包序列。
"""


class Mulberry32:
    def __init__(self, seed: int):
        self.a = seed & 0xFFFFFFFF

    def random(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
