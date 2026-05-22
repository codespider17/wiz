@echo off
REM 编译 launcher.exe 为 Windows GUI 应用程序（零窗口启动）
REM 需要 .NET SDK 或 Visual Studio 构建工具

where csc >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 找不到 csc 编译器。请确保已安装 .NET SDK 或 Visual Studio 构建工具。
    echo.
    echo 解决方法:
    echo   1. 安装 .NET SDK: https://dotnet.microsoft.com/download
    echo   2. 或在 VS 开发者命令提示符中运行此脚本
    echo.
    pause
    exit /b 1
)

echo [编译] 正在编译 launcher.exe (GUI mode)...
csc /target:winexe launcher.cs /out:launcher.exe
if %ERRORLEVEL% EQU 0 (
    echo [成功] launcher.exe 已编译为 Windows GUI 应用程序
    echo [验证] PE类型:
    for %%i in (launcher.exe) do echo         大小: %%~zi 字节
) else (
    echo [失败] 编译出错，请检查错误信息
    pause
    exit /b 1
)
