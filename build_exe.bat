@echo off
chcp 65001 >nul
cd /d %~dp0
echo == 正在打包 PTCG模拟拆卡.exe ...
python -m PyInstaller --noconfirm --onefile --noconsole ^
  --name "PTCG模拟拆卡" ^
  --add-data "static;static" ^
  --add-data "data\sets_index.json;data" ^
  --add-data "data\cards;data\cards" ^
  --collect-all webview ^
  --collect-all PIL --icon icon.ico ^
  app.py
if errorlevel 1 (
  echo 打包失败，请先 pip install pyinstaller
  pause
  exit /b 1
)
echo.
echo 打包完成: dist\PTCG模拟拆卡.exe （双击即可运行）
pause
