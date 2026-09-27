@echo off
chcp 65001 >nul
cd /d %~dp0
rem 卡价快照缺失时（如全新 clone 未跑过 sync）生成空快照，保证打包不中断
if not exist "data\prices\index.json" (
  echo == 未找到卡价快照，生成空快照（运行 python -m pricetool sync --min-cny 5 可拉取行情）
  python -c "from pricetool.sync import write_cny_index; write_cny_index(5)"
)
echo == 正在打包 PTCG拆卡模拟器.exe ...
python -m PyInstaller --noconfirm --onefile --noconsole ^
  --name "PTCG拆卡模拟器" ^
  --add-data "static;static" ^
  --add-data "shared;shared" ^
  --add-data "data\sets_index.json;data" ^
  --add-data "data\manifest.json;data" ^
  --add-data "data\cards;data\cards" ^
  --add-data "data\prices\index.json;data\prices" ^
  --collect-all webview ^
  --collect-all PIL --icon icon.ico ^
  app.py
if errorlevel 1 (
  echo 打包失败，请先 pip install pyinstaller
  pause
  exit /b 1
)
echo.
echo 打包完成: dist\PTCG拆卡模拟器.exe （双击即可运行）
pause
