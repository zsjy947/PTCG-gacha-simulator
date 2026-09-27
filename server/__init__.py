# -*- coding: utf-8 -*-
"""server 包：Flask 路由与服务端支撑（自 app.py 拆出，函数体原样搬移）。

模块划分：
- paths：数据/资源目录解析（冻结环境兼容）与路径白名单；
- httpcache：出站限流、磁盘缓存 LRU、按锁并发下载、缩略图与详情回源；
- api：/api/* 只读与数据路由（弹列表/卡表/概率/开包/详情/清单/价格）；
- media：/img /thumb /icon 图片代理路由；
- store：user_store（抽卡记录/收藏册磁盘镜像）读写路由。

入口仍为仓库根 app.py（Flask app 创建与桌面窗口启动），PyInstaller 经其本地导入分析依赖。
"""
