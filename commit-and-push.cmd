@echo off
setlocal
cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo This shortcut is not inside a Git repository.
  pause
  exit /b 1
)

git status --short
git status --porcelain | findstr . >nul
if errorlevel 1 (
  echo Nothing to commit.
  timeout /t 2 /nobreak >nul
  exit /b 0
)

echo.
set "commit_message="
set /p "commit_message=Commit message [Update MedRep app]: "
if not defined commit_message set "commit_message=Update MedRep app"

git add --all
if errorlevel 1 goto :failed

git commit -m "%commit_message%"
if errorlevel 1 goto :failed

git push
if errorlevel 1 goto :failed

echo.
echo Commit and push completed.
timeout /t 2 /nobreak >nul
exit /b 0

:failed
echo.
echo Commit or push failed. Review the message above.
pause
exit /b 1
