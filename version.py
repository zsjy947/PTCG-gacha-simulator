# 应用版本号：发版时唯一需要修改的地方
# exe：由 app.py 读取并提供 /api/version；APK：build_assets.py 注入前端、
# build_apk.py 经 aapt2 link 传参注入包内版本（badging 守卫校验）
APP_VERSION = "1.3.1"
