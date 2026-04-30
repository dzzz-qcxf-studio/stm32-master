# STM32 Build, Flash & Debug Skill

嵌入式 STM32 开发工作流，支持编译、烧录、调试、代码格式化和静态检查。

## 项目结构

```
stm32_master/
├── scripts/            # 编译、烧录、调试脚本
│   ├── build_flash.ps1       # 一键编译+烧录
│   ├── start_debug.ps1       # 启动调试会话
│   └── check_gpio_safety.ps1 # GPIO 引脚安全检查
├── monitors/           # 串口监控工具
│   ├── monitor_web.ps1       # Web UI 模式（PowerShell）
│   ├── monitor_serial.ps1    # 命令行模式（PowerShell）
│   ├── monitor_websocket.ps1 # WebSocket 模式
│   ├── serial_monitor.js     # Node.js 串口服务（Web UI）
│   ├── package.json          # Node.js 依赖配置
│   └── node_modules/         # Node.js 依赖包
├── docs/               # 文档
│   ├── FILES_MANIFEST.md     # 文件清单
│   ├── MONITOR_QUICKSTART.md # 监控快速入门
│   └── PROJECT_SUMMARY.md    # 项目概述
├── templates/          # 代码模板
│   ├── fal_module.h/.c       # FAL 模块框架
│   ├── device_uart.c         # UART 驱动
│   ├── device_iic.c          # I2C 驱动
│   ├── device_spi.c          # SPI 驱动
│   ├── device_gpio.c         # GPIO 驱动
│   ├── device_adc.c          # ADC 驱动
│   ├── device_tim.c          # 定时器/PWM 驱动
│   ├── device_can.c          # CAN 驱动
│   ├── .clang-format.tmpl    # 代码格式化配置
│   └── vscode_launch.json.tmpl # VSCode 调试配置
└── vscode-extension/   # VS Code 扩展
```

## 工作流程图

### 编译 + 烧录流程

```mermaid
flowchart TD
    A[开始] --> B{选择项目类型}
    B -->|Keil MDK| C[使用 UV4 编译]
    B -->|CMake/Ninja| D[使用 Ninja 编译]
    C --> E[生成 ELF/AXF]
    D --> E
    E --> F[Step 4.5: GPIO 安全检查]
    F -->|检查失败| G[阻止烧录<br/>显示错误]
    F -->|检查通过| H[烧录固件]
    H --> I[成功]
    G --> J[修复错误后重试]
```

### 调试流程

```mermaid
flowchart TD
    A[开始] --> B{选择调试模式}
    B -->|VS Code| C[按 F5 启动调试]
    B -->|GDB 终端| D[启动 GDB Server]
    B -->|RTT Viewer| E[启动 J-Link RTT]
    B -->|串口 Shell| F[自动检测 COM 端口]
    C --> G[连接 ST-Link]
    D --> G
    E --> G
    F --> G
    G --> H[设置断点]
    H --> I[单步调试/继续运行]
```

### 串口监控方式

```mermaid
flowchart LR
    A[STM32 设备] --> B{选择监控方式}
    B --> C[VS Code 扩展]
    B --> D[Web UI 模式]
    B --> E[WebSocket 模式]
    B --> F[命令行模式]
    C --> G[点击图标启动]
    D --> H[自动打开浏览器]
    E --> I[实时数据推送]
    F --> J[保存日志文件]
```

## 快速开始

### 编译 + 烧录
```powershell
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project"

# 跳过安全检查（危险!）
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project" -SkipSafetyCheck
```

### GPIO 安全检查（可独立运行）
```powershell
.\scripts\check_gpio_safety.ps1 -ProjectDir "F:\path\to\project"
```

### 调试
```powershell
.\scripts\start_debug.ps1 -ProjectDir "F:\path\to"           # VSCode 调试
.\scripts\start_debug.ps1 -ProjectDir "F:\path\to" -GDBClient  # GDB 终端调试
.\scripts\start_debug.ps1 -ProjectDir "F:\path\to" -RTT      # RTT Viewer
.\scripts\start_debug.ps1 -ProjectDir "F:\path\to" -Shell     # 串口 Shell
```

### 串口实时监控

#### 方式1：VS Code 扩展
```powershell
cd vscode-extension
setup.bat
```

#### 方式2：Web UI 模式
```powershell
.\monitors\monitor_web.ps1 -SerialPort "COM3"
```

Web UI 功能：端口选择、波特率选择（9600-921600）、手动发送、回车键发送、清空、下载日志。

#### 方式3：命令行模式
```powershell
.\monitors\monitor_serial.ps1 -Port "COM3" -LogFile "debug.log"
```

## 硬编码路径提示

> **Keil UV4 默认路径:** `D:\keil5\UV4\UV4.exe`
> 如安装在其他位置，使用 `-UV4Path` 参数覆盖

> **Web UI 默认端口:** `8080`
> 如被占用，使用 `-Port` 参数指定其他端口

## 工具链路径

自动检测（来自 STM32Cube bundles）：

| 工具 | 路径模式 |
|------|---------|
| CMake | `%LOCALAPPDATA%\stm32cube\bundles\cmake\*\bin\cmake.exe` |
| STM32_Programmer_CLI | `%LOCALAPPDATA%\stm32cube\bundles\programmer\*\bin\STM32_Programmer_CLI.exe` |
| arm-none-eabi-gdb | `%LOCALAPPDATA%\stm32cube\bundles\gnu-gdb-for-stm32\*\bin\arm-none-eabi-gdb.exe` |
| ST-LINK_gdbserver | `%LOCALAPPDATA%\stm32cube\bundles\stlink-gdbserver\*\bin\ST-LINK_gdbserver.exe` |
| Keil UV4 | `D:\keil5\UV4\UV4.exe`（可覆盖） |

## GDB 调试命令

```bash
target remote localhost:61234    # 连接
file build/Debug/test2.elf     # 加载符号
break main                      # 断点
continue                        # 运行
next                            # 单步
print <var>                     # 打印变量
info registers                  # 寄存器
```

## 模板文件

`templates/` 目录下包含代码生成模板：

| 模板 | 用途 |
|------|------|
| `fal_module.h/.c` | FAL 业务模块框架 |
| `device_uart.c` | UART 设备驱动 |
| `device_iic.c` | I2C 设备驱动 |
| `device_spi.c` | SPI 设备驱动 |
| `device_gpio.c` | GPIO 设备驱动 |
| `device_adc.c` | ADC 设备驱动 |
| `device_tim.c` | 定时器/PWM 驱动 |
| `device_can.c` | CAN 设备驱动 |
| `.clang-format.tmpl` | 代码格式化配置 |
| `vscode_launch.json.tmpl` | VSCode 调试配置 |

## 占位符

| 占位符 | 说明 |
|--------|------|
| `{{MODULE_NAME}}` | 模块名（小写） |
| `{{MODULE_NAME_UPPER}}` | 模块名（大写） |
| `{{DATE}}` | 当前日期 |
| `{{DEVICE}}` | 芯片型号 |
| `{{TARGET}}` | 项目名称 |
| `{{INTERFACE}}` | 调试接口（SWD/JTAG） |

## 格式化

```bash
winget install LLVM.LLVM
clang-format -i Core/Src/main.c
```

## 静态检查

```bash
winget install cppcheck.cppcheck
cppcheck --enable=warning,style fal/ common/
```

## 验证组件

| 组件 | 版本 |
|------|------|
| CMake | 4.2.3+st.1 |
| STM32_Programmer_CLI | 2.22.0+st.1 |
| arm-none-eabi-gdb | 14.3.1+st.2 |
| ST-LINK_gdbserver | 7.13.0+st.3 |
| Keil UV4 | 5.25.2+ |
| 芯片 | STM32F103 High-density |

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| "No ST-Link found" | 检查 USB 连接 |
| "ELF not found" | 先执行编译 |
| 串口端口被占用 | 关闭其他串口程序 |
| Keil UV4 not found | 检查 `D:\keil5\UV4\UV4.exe` 或用 `-UV4Path` 指定 |
| Web 端口 8080 被占用 | 用 `-Port` 指定其他端口 |