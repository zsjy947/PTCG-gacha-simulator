@echo off
chcp 65001 >nul
cd /d %~dp0
echo == 正在打包 宝可梦卡牌模拟抽卡.exe ...
python -m PyInstaller --noconfirm --onefile --noconsole ^
  --name "宝可梦卡牌模拟抽卡" ^
  --add-data "static;static" ^
  --add-data "data\sets_index.json;data" ^
  --add-data "data\cards;data\cards" ^
  --collect-all webview ^
  --collect-all PIL ^
  app.py
if errorlevel 1 (
  echo 打包失败，请先 pip install pyinstaller
  pause
  exit /b 1
)
echo.
echo 打包完成: dist\宝可梦卡牌模拟抽卡.exe （双击即可运行）
pause
