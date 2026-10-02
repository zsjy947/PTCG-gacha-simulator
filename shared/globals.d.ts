/* 前端运行时注入全局的 checkJs 环境声明（外挂，不改任何运行时文件）。
 *
 * 来源：
 *   - server 模板 / android/build_assets.py 注入（index.html 内联 script 与 assets/meta.js）：
 *     __ASSET_MODE__ / __ASSET_BASE__ / __SETS_INDEX__ / __GACHA_META__ /
 *     __CARD_FILES__ / __DATA_MANIFEST__ / __APP_VERSION__
 *   - APK WebView 原生桥（android/ MainActivity addJavascriptInterface）：PTCGNative
 *   - 引擎 UMD 挂载：PTCGGGacha（类型见 shared/gacha.d.ts）
 * 注入时机均先于前端脚本加载，声明为可选以匹配「资产模式才有值」的运行时事实。
 * 注入体为构建期 JSON/原生桥对象，跨文件形状一致性由 tests/test_consistency.py 等锁定，
 * 故除标注明确的轻量形状外按 any 处理。
 */

interface Window {
  __ASSET_MODE__?: boolean;
  __ASSET_BASE__?: string;
  __SETS_INDEX__?: any[];
  __GACHA_META__?: any;
  __CARD_FILES__?: Record<string, any[]>;
  __DATA_MANIFEST__?: any;
  __APP_VERSION__?: string;
  __imgFail?: (img: HTMLImageElement) => void;
  PTCGNative?: any;
}
