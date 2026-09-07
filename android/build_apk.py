# -*- coding: utf-8 -*-
"""不依赖 Gradle 的安卓 APK 构建脚本（aapt2 + javac + d8 + zipalign + apksigner）。

用法：
    python android/build_assets.py   # 先生成 WebView 资产
    python android/build_apk.py      # 构建 dist/宝可梦卡牌抽卡.apk

依赖：android/sdk/ 下已解压 JDK 17、build-tools 34、platform-34（见 README）。
"""
import subprocess
import sys
from pathlib import Path

ANDROID = Path(__file__).resolve().parent
ROOT = ANDROID.parent
SDK = ANDROID / "sdk"
BUILD_TOOLS = SDK / "android-14"          # build-tools r34 zip 内的目录名
PLATFORM_JAR = SDK / "android-34" / "android.jar"
JDK = SDK / "jdk-17.0.20.1+1"

APP_MAIN = ANDROID / "app" / "src" / "main"
OUT = ANDROID / "build"
APK_NAME = "PTCG模拟拆卡.apk"

ENV = {
    **__import__("os").environ,
    "JAVA_HOME": str(JDK),
    "PATH": f"{JDK / 'bin'};" + __import__("os").environ.get("PATH", ""),
}


def run(cmd, **kw):
    print(">>", " ".join(str(c) for c in cmd))
    r = subprocess.run([str(c) for c in cmd], env=ENV, **kw)
    if r.returncode != 0:
        raise SystemExit(f"命令失败: {cmd[0]} (exit {r.returncode})")
    return r


def main():
    for tool in (BUILD_TOOLS / "aapt2.exe", PLATFORM_JAR, JDK / "bin" / "javac.exe"):
        if not tool.exists():
            raise SystemExit(f"缺少 {tool}，请先解压 SDK 组件到 android/sdk/")
    if not (APP_MAIN / "assets" / "www" / "index.html").exists():
        raise SystemExit("缺少 WebView 资产，请先运行 android/build_assets.py")

    OUT.mkdir(exist_ok=True)
    gen = OUT / "gen"
    if gen.exists():
        subprocess.run(["rmdir", "/s", "/q", str(gen)], shell=True)
    gen.mkdir(parents=True)

    # 1) aapt2 编译资源
    run([BUILD_TOOLS / "aapt2.exe", "compile", "--dir",
         APP_MAIN / "res", "-o", OUT / "res.zip"])

    # 2) aapt2 链接（清单+资源+android.jar）
    run([BUILD_TOOLS / "aapt2.exe", "link",
         "-o", OUT / "base.apk",
         "-I", PLATFORM_JAR,
         "--manifest", APP_MAIN / "AndroidManifest.xml",
         "--java", gen,
         "--auto-add-overlay",
         OUT / "res.zip"])

    # 3) javac 编译
    java_files = list((APP_MAIN / "java").rglob("*.java")) + list(gen.rglob("*.java"))
    classes = OUT / "classes"
    if classes.exists():
        subprocess.run(["rmdir", "/s", "/q", str(classes)], shell=True)
    classes.mkdir()
    run([JDK / "bin" / "javac.exe",
         "--release", "8", "-nowarn", "-encoding", "UTF-8",
         "-classpath", PLATFORM_JAR,
         "-d", classes] + java_files)

    # 4) d8 转 dex
    run([BUILD_TOOLS / "d8.bat", "--release",
         "--lib", PLATFORM_JAR, "--min-api", "24",
         "--output", OUT, *classes.rglob("*.class")])
    if not (OUT / "classes.dex").exists():
        raise SystemExit("classes.dex 未生成")

    # 5) 向 APK 追加 dex 与资产
    import zipfile
    with zipfile.ZipFile(OUT / "base.apk", "a", zipfile.ZIP_DEFLATED) as z:
        z.write(OUT / "classes.dex", "classes.dex")
        assets = APP_MAIN / "assets"
        for f in assets.rglob("*"):
            if f.is_file():
                z.write(f, f"assets/{f.relative_to(assets).as_posix()}")

    # 6) zipalign
    run([BUILD_TOOLS / "zipalign.exe", "-f", "4",
         OUT / "base.apk", OUT / "aligned.apk"])

    # 7) 签名密钥：本地生成、绝不入库（.gitignore 已排除）。
    #    口令优先取环境变量 PTCG_KEYSTORE_PASS，其次 android/keystore.properties
    #    （同样是本地文件），都没有则生成随机口令并写入该文件。
    import os
    import secrets
    keystore = ANDROID / "gacha.keystore"
    props = ANDROID / "keystore.properties"
    store_pass = os.environ.get("PTCG_KEYSTORE_PASS", "")
    if not store_pass and props.exists():
        for line in props.read_text(encoding="utf-8").splitlines():
            if line.startswith("PTCG_KEYSTORE_PASS="):
                store_pass = line.split("=", 1)[1].strip()
    if not keystore.exists():
        if not store_pass:
            store_pass = secrets.token_urlsafe(24)
        run([JDK / "bin" / "keytool.exe", "-genkeypair",
             "-keystore", keystore, "-alias", "gacha",
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-storepass", store_pass, "-keypass", store_pass,
             "-dname", "CN=PTCC Gacha, OU=Personal, O=ptcc, C=CN"])
    if not store_pass:
        raise SystemExit(f"签名口令缺失：请设置 PTCG_KEYSTORE_PASS 或写入 {props}")
    if not props.exists():
        props.write_text(
            "# 本地签名口令（勿提交，已在 .gitignore 中排除）\n"
            f"PTCG_KEYSTORE_PASS={store_pass}\n", encoding="utf-8")
        print(">> 已生成签名密钥与本地口令文件 keystore.properties（勿外传）")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    apk = dist / APK_NAME
    run([BUILD_TOOLS / "apksigner.bat", "sign",
         "--ks", keystore, "--ks-pass", f"pass:{store_pass}",
         "--key-pass", f"pass:{store_pass}",
         "--out", apk, OUT / "aligned.apk"])

    # 8) 校验
    run([BUILD_TOOLS / "apksigner.bat", "verify", "--print-certs", apk])
    size = apk.stat().st_size / 1024 / 1024
    print(f"\n✅ APK 构建完成: {apk} ({size:.1f} MB)")
    print("   安装：把 APK 传到手机直接打开（允许安装未知来源应用），或 adb install")
    return 0


if __name__ == "__main__":
    sys.exit(main())
