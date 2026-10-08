# -*- coding: utf-8 -*-
"""不依赖 Gradle 的安卓 APK 构建脚本（aapt2 + javac + d8 + zipalign + apksigner）。

用法：
    python android/build_apk.py      # 构建 dist/PTCG拆卡模拟器_v{版本}.apk
                                     # （WebView 资产由本脚本自动重建，无需先跑 build_assets.py）

依赖：系统级工具链 —— JDK 17（JAVA_HOME，缺省 D:\Tools\jdk-17）与 Android SDK
（ANDROID_HOME，缺省 D:\Tools\android-sdk）中的 build-tools 34、platform-34。
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ANDROID = Path(__file__).resolve().parent
ROOT = ANDROID.parent
# 工具链取系统级安装（JAVA_HOME / ANDROID_HOME），未设置时回退 D:\Tools 默认位置
JDK = Path(os.environ.get("JAVA_HOME", r"D:\Tools\jdk-17"))
ANDROID_SDK = Path(os.environ.get("ANDROID_HOME", r"D:\Tools\android-sdk"))
BUILD_TOOLS = ANDROID_SDK / "build-tools" / "34.0.0"
PLATFORM_JAR = ANDROID_SDK / "platforms" / "android-34" / "android.jar"

# 版本号同步自 version.py（versionCode = 主*10000 + 次*100 + 修订，保证单调递增）
sys.path.insert(0, str(ROOT))
from version import APP_VERSION as _VER

APP_MAIN = ANDROID / "app" / "src" / "main"
OUT = ANDROID / "build"
# APK 文件名带版本号：发布/下载环节版本一目了然，拿错包（新名字旧内容）一眼可辨
APK_NAME = f"PTCG拆卡模拟器_v{_VER}.apk"

_v = [int(x) for x in _VER.split(".")]
while len(_v) < 3:
    _v.append(0)
VERSION_CODE = _v[0] * 10000 + _v[1] * 100 + _v[2]
MANIFEST = APP_MAIN / "AndroidManifest.xml"
_m = MANIFEST.read_text(encoding="utf-8")
_m = re.sub(r'android:versionCode="\d+"', f'android:versionCode="{VERSION_CODE}"', _m)
_m = re.sub(r'android:versionName="[^"]*"', f'android:versionName="{_VER}"', _m)
MANIFEST.write_text(_m, encoding="utf-8")
print(f"Manifest 版本同步: versionName={_VER} versionCode={VERSION_CODE}")

ENV = {
    **os.environ,
    "JAVA_HOME": str(JDK),
    "PATH": f"{JDK / 'bin'};" + os.environ.get("PATH", ""),
}


# 回显打码：口令参数的值不得出现在控制台（keytool 用 -storepass/-keypass，
# apksigner 用 --ks-pass/--key-pass pass:xxx，后者由 pass: 正则兜底）
_SECRET_FLAGS = ("-storepass", "-keypass", "--ks-pass", "--key-pass")


def _mask(cmd):
    out, hide_next = [], False
    for c in cmd:
        c = str(c)
        if hide_next:
            out.append("***")
            hide_next = False
        elif c in _SECRET_FLAGS:
            out.append(c)
            hide_next = True
        else:
            out.append(re.sub(r"(?<=pass:)\S+", "***", c))
    return " ".join(out)


def run(cmd, **kw):
    print(">>", _mask(cmd))
    r = subprocess.run([str(c) for c in cmd], env=ENV, **kw)
    if r.returncode != 0:
        raise SystemExit(f"命令失败: {cmd[0]} (exit {r.returncode})")
    return r


def main():
    for tool in (BUILD_TOOLS / "aapt2.exe", PLATFORM_JAR, JDK / "bin" / "javac.exe"):
        if not tool.exists():
            raise SystemExit(f"缺少 {tool}，请检查系统级工具链（JAVA_HOME / ANDROID_HOME）是否完整")

    # WebView 资产与本次构建必须同源：每次都强制重建（build_assets.py 按 version.py
    # 当前值注入 __APP_VERSION__），并在打包前后校验版本一致性——保证安装包文件名、
    # 包内 Manifest 与应用内「关于/检查更新」显示的版本三者恒等于 version.py。
    print(">> 重建 WebView 资产（android/build_assets.py）...")
    run([sys.executable, str(ANDROID / "build_assets.py")])
    meta_js = (APP_MAIN / "assets" / "www" / "assets" / "meta.js").read_text(encoding="utf-8")
    if f"window['__APP_VERSION__'] = \"{_VER}\"" not in meta_js:
        raise SystemExit(f"资产版本校验失败：meta.js 内 __APP_VERSION__ != {_VER}（资产与代码版本不一致，禁止出包）")

    if not (APP_MAIN / "assets" / "www" / "index.html").exists():
        raise SystemExit("缺少 WebView 资产，请检查 android/build_assets.py 输出")

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

    # 2.5) 版本守卫：badging 必须等于 version.py（Manifest 注入失败的包绝不外流）
    p = subprocess.run([str(BUILD_TOOLS / "aapt2.exe"), "dump", "badging", str(OUT / "base.apk")],
                       env=ENV, capture_output=True, text=True)
    badging = p.stdout.splitlines()[0] if p.stdout else ""
    if f"versionName='{_VER}'" not in badging or f"versionCode='{VERSION_CODE}'" not in badging:
        raise SystemExit(f"APK 版本校验失败：期望 {_VER}/{VERSION_CODE}，实际 badging：{badging}")
    print(f">> APK 版本校验通过: versionName={_VER} versionCode={VERSION_CODE}")

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
