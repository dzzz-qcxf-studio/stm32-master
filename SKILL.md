---
name: stm32-master
description: Use when compiling any STM32 project via CMake/Ninja or Keil MDK, flashing firmware via STM32CubeProgrammer CLI, debugging via ST-Link GDB Server, monitoring serial port output with Web UI, or using RTT Viewer, serial shell, code formatting, and static lint for STM32 devices.
---

# STM32 Build, Flash & Debug (Extended)

## 功能概览

| 功能 | 说明 |
|------|------|
| **Build** | CMake/Ninja 或 Keil MDK 编译，显示固件大小 |
| **Flash** | STM32CubeProgrammer CLI 烧录 |
| **Monitor** | 实时串口监控，Web UI 可视化，支持过滤/搜索 |
| **Debug** | GDB 调试、RTT Viewer、串口 Shell |
| **Format** | clang-format 代码格式化 |
| **Lint** | cppcheck 静态检查 + AI 误报过滤 |
| **Safety** | GPIO 引脚冲突检查，防止设备损坏 |

## 目录结构

```
stm32_master/
├── scripts/            # 编译、烧录、调试脚本
│   ├── build_flash.ps1       # 一键编译+烧录
│   ├── start_debug.ps1       # 启动调试会话
│   └── check_gpio_safety.ps1 # GPIO 引脚安全检查 ⚠️
├── monitors/           # 串口监控工具
│   ├── monitor_web.ps1       # Web UI 启动脚本（PowerShell）
│   ├── monitor_serial.ps1    # 命令行监控（PowerShell）
│   ├── serial_monitor.js     # 基础版 Web UI
│   ├── serial_monitor_ai.js  # AI 增强版 Web UI（主用）
│   ├── serial_mcp.js         # MCP 服务器（可选）
│   ├── package.json          # Node.js 依赖配置
│   └── node_modules/         # Node.js 依赖包
├── docs/               # 文档
│   ├── MONITOR_QUICKSTART.md # 串口监控快速入门
│   ├── MCP_CONFIG.md        # MCP 配置说明
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
```

---

## 编译+烧录（一键）

### 使用方式

```powershell
# 编译并烧录（自动检测项目类型：CMake 或 Keil MDK）
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project"

# 仅烧录（跳过编译）
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project" -SkipBuild

# 跳过 GPIO 安全检查（危险! 仅在确认安全后使用）
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project" -SkipSafetyCheck
```

> **⚠️ 安全检查:** 烧录前会自动运行 GPIO 引脚安全检查。如存在严重错误会阻止烧录，防止硬件损坏。

### 支持的项目类型

| 类型 | 检测方式 |
|------|---------|
| **Keil MDK** | `Projects/MDK-ARM/*.uvprojx` |
| **CMake/Ninja** | 根目录 `CMakeLists.txt` |

### 硬编码路径提示

> **Keil 默认路径:** `D:\keil5\UV4\UV4.exe`
> 如安装在其他位置，使用 `-UV4Path` 参数指定：
> ```powershell
> .\scripts\build_flash.ps1 -ProjectDir "..." -UV4Path "C:\Keil\UV4\UV4.exe"
> ```

### 成功输出示例

```
========================================
  STM32 Universal Build & Flash
========================================

Project: F:\path\to\project

[1/5] Detecting project type...
  Project type: Keil MDK (UVPROJX)

[2/5] Finding tools...
  Programmer: C:\Users\ROG\AppData\Local\stm32cube\bundles\programmer\2.22.0+st.1\bin\STM32_Programmer_CLI.exe
  UV4: D:\keil5\UV4\UV4.exe

[3/5] Building project...
  Project: F:\path\to\project\Projects\MDK-ARM\atk_f103.uvprojx
  Build complete (0 errors)

[4/5] Finding ELF file...
  Found: F:\path\to\project\Output\atk_f103.axf

[5/5] Flashing to device...
  ...

========================================
  SUCCESS: Flash completed!
  Firmware: 55.52 KB
========================================
```

---

## build - 单独编译项目

### CMake/Ninja

```powershell
cmake --build <project>/build --config Debug
```

### Keil MDK

```powershell
& "D:\keil5\UV4\UV4.exe" -j0 -o "<log_path>" -b "<project>.uvprojx"
```

### 成功输出示例

```
✅ 编译成功

📊 固件大小：
   text    data     bss     dec     hex filename
  45678    1234    5678   52590    cd6e build/Debug/test2.elf

💾 Flash 占用: 46912 / 524288 bytes (8.9%)
📦 RAM 占用:   6912 / 131072 bytes (5.3%)
```

### 错误诊断

```
❌ 编译失败 (2 个错误)

📍 错误 1: Core/Src/main.c:45
   undefined reference to 'HAL_TIM_PWM_Start'

   💡 分析: CubeMX 中可能没有启用 TIM PWM 功能
   🔧 建议: 在 CubeMX 中启用对应的 TIM 外设

📍 错误 2: fal/motor.c:23
   undefined reference to 'vTaskDelay'

   💡 分析: FreeRTOS 头文件未包含或配置缺失
   🔧 建议: 添加 #include "FreeRTOS.h" 和 "task.h"
```

### 常见编译错误

| 错误类型 | 原因 | 修复方法 |
|---------|------|---------|
| `undefined reference to 'HAL_XXX'` | HAL 驱动未启用 | 在 CubeMX 中启用对应外设 |
| `undefined reference to 'vTaskDelay'` | FreeRTOS 未配置 | 添加 FreeRTOSConfig.h 和 include 路径 |
| `No such file or directory` (头文件) | include 路径缺失 | 检查 CMakeLists.txt 中的 C_INCLUDES |
| `implicit declaration` | 缺少 #include | 添加对应的头文件 |
| `multiple definition` | 头文件中定义了变量 | 使用 extern 声明 |
| `region 'FLASH' overflow` | Flash 空间不足 | 优化代码或检查链接脚本 |
| `undefined reference to 'main'` | 链接脚本或启动文件错误 | 检查 LDSCRIPT 和 STARTUP 配置 |

---

## flash - 烧录固件

### 功能说明

使用 STM32CubeProgrammer CLI 烧录固件到芯片。

### 使用方式

```powershell
# 烧录 ELF/AXF
& $programmer -c port=SWD --download "<elf_path>" -v
```

### 成功输出示例

```
✅ 烧录成功

📡 调试器: ST-Link (SWD)
📦 固件: test2.elf (3.73 KB)
📍 地址: 0x08000000
⏱️  耗时: 0.28 秒
🔍 验证: 通过
```

### 常用命令

| 任务 | 命令 |
|------|------|
| 烧录 ELF | `STM32_Programmer_CLI.exe -c port=SWD --download <elf> -v` |
| 烧录 HEX | `STM32_Programmer_CLI.exe -c port=SWD --download <hex>` |
| 查看设备 | `STM32_Programmer_CLI.exe -c port=SWD` |
| 擦除芯片 | `STM32_Programmer_CLI.exe -c port=SWD -e full` |
| 复位 | `STM32_Programmer_CLI.exe -c port=SWD -rst` |

---

## monitor - 串口实时监控

### MCP 工具（推荐方式）

AI 使用 MCP 工具直接控制串口，无需手动启动服务：

| 工具 | 参数 | 说明 |
|------|------|------|
| `serial_list_ports` | - | 列出可用串口 |
| `serial_connect` | `port`, `baudRate` | 连接串口 |
| `serial_send` | `command` | 发送命令 |
| `serial_history` | - | 获取对话历史 |
| `serial_status` | - | 获取连接状态 |

**示例**：连接 COM11 并发送 "123"
```
serial_connect(port="COM11", baudRate=115200)
serial_send(command="123")
```

### Web UI（备用）

启动后访问 http://localhost:8080
```bash
node monitors/serial_monitor_ai.js --serial COM5 --baud 115200 --port 8080
```

### 命令行（备用）

```powershell
.\monitors\monitor_serial.ps1 -Port "COM5" -LogFile "debug.log"
```

### 常见问题

**Q: 串口连接不上？**

A: 检查：
1. 设备已通过 USB 连接
2. 驱动已安装（设备管理器中可见）
3. 没有其他程序占用该端口
4. 波特率设置正确

**Q: 如何识别设备串口号？**

```powershell
# PowerShell 查询
[System.IO.Ports.SerialPort]::GetPortNames()
```

**Q: Web 端口被占用？**

A: 使用 `-Port` 指定其他端口：
```powershell
.\monitors\monitor_web.ps1 -SerialPort "COM3" -Port 8081
```

---

## debug - 调试会话

### 功能说明

启动 GDB Server 进行调试，支持 RTT Viewer 和串口 Shell。

### 使用方式

```powershell
# GDB 调试（默认）
.\scripts\start_debug.ps1 -ProjectDir "<path>"

# GDB 交互模式
.\scripts\start_debug.ps1 -ProjectDir "<path>" -GDBClient

# RTT Viewer
.\scripts\start_debug.ps1 -ProjectDir "<path>" -RTT

# 串口 Shell
.\scripts\start_debug.ps1 -ProjectDir "<path>" -Shell
```

### GDB 调试模式

```
✅ GDB Server 已启动

📡 调试器: ST-Link (SWD)
🔌 GDB 端口: localhost:61234

连接方式：

方式 1 — 命令行 GDB:
   arm-none-eabi-gdb build/Debug/test2.elf
   (gdb) target remote localhost:61234
   (gdb) load
   (gdb) break main
   (gdb) continue

方式 2 — VS Code:
   按 F5 启动调试
```

### RTT Viewer 模式

> **前置条件：**
> 1. J-Link 调试器连接
> 2. 固件调用 `SEGGER_RTT_Init()`
> 3. RTT 输出通道已配置

### GDB 常用命令

| 命令 | 说明 |
|------|------|
| `target remote localhost:61234` | 连接 GDB Server |
| `file <elf>` | 加载符号文件 |
| `break main` | 在 main 设置断点 |
| `continue` | 运行到断点 |
| `next` | 单步执行（跳过函数） |
| `step` | 单步执行（进入函数） |
| `print <var>` | 打印变量值 |
| `info registers` | 显示寄存器 |
| `info locals` | 显示局部变量 |
| `x/16x <addr>` | 查看内存 |
| `where` / `bt` | 堆栈回溯 |

---

## format - 代码格式化

### 功能说明

使用 clang-format 格式化业务层代码。

### 使用方式

```powershell
# 格式化指定文件
clang-format -i Core/Src/main.c

# 格式化目录
clang-format -i fal/motor/

# 仅检查格式（CI 模式）
clang-format --dry-run --Werror Core/Src/main.c
```

### 格式化范围

| 层级 | 目录 | 默认格式化 |
|------|------|----------|
| 业务层 | fal/, pal/, common/, utilities/, drivers/ | ✅ 是 |
| 应用层 | Core/Src/, Core/Inc/ | ✅ 是 |
| HAL 层 | Drivers/STM32F1xx_HAL_Driver/ | ❌ 否 |
| CMSIS | Drivers/CMSIS/ | ❌ 否 |

---

## lint - 静态检查

### 功能说明

使用 cppcheck 进行静态代码检查。

### 使用方式

```powershell
# 检查业务层代码
cppcheck --enable=warning,style,performance,portability `
    --suppress=missingIncludeSystem `
    fal/ common/ utilities/

# 检查指定文件（需要 include 路径）
cppcheck -I Core/Inc -I Drivers/CMSIS/Core/Include fal/motor/motor.c
```

### 嵌入式常见误报（可忽略）

| 误报类型 | 说明 |
|---------|------|
| `unreadVariable` | 写入硬件寄存器后不需要读取 |
| `variableScope` | ISR 共享的 volatile 变量 |
| `unusedFunction` | HAL 回调函数由框架调用 |
| `nullPointer` | 外设基地址宏（如 GPIOA） |

---

## safety - GPIO & 外设模块安全检查 ⚠️

### 功能说明

> **高危警告：** 引脚或外设模块配置错误可能导致芯片和外设损坏！每次修改配置后建议执行此检查。

检测可能导致硬件损坏的问题：

| 检查项 | 说明 | 风险等级 |
|--------|------|----------|
| 输入/输出冲突 | 同一引脚同时配置为输入和输出 | 🔴 严重 |
| 浮空输入 | 输入引脚无上拉/下拉，可能产生噪声 | 🟡 中等 |
| 时钟未启用 | GPIO 已使用但时钟未使能 | 🟡 中等 |
| 复用功能冲突 | 同一引脚分配给多个外设 | 🔴 严重 |
| **外置模块冲突** | I2C/SPI/UART 引脚配置错误 | 🔴 严重 |
| **电压不匹配** | 3.3V MCU 连接 5V 模块 | 🔴 严重 |

### 支持的外置模块检测

| 模块类型 | 检测的设备 | 潜在风险 |
|----------|-----------|---------|
| **I2C** | BMP280, MPU6050, OLED, AHT10, ADS1115 | SCL/SDA 配置为 GPIO 输出会损坏设备 |
| **SPI** | SD卡, W25Q Flash, ST7789, nRF24L01 | MOSI 配置为输入会导致通信失败 |
| **UART** | GPS, HC-05, ESP8266, LoRa | TX 配置为输入会导致数据丢失 |
| **ADC** | Joystick, ACS712, Load Cell | 配置为输出会损坏传感器 |
| **电机驱动** | L298N, TB6612, PCA9685 | PWM 引脚过载可能损坏 MCU |

### 使用方式

```powershell
# 检查项目 GPIO 和外设模块配置
.\scripts\check_gpio_safety.ps1 -ProjectDir "F:\path\to\project"

# 详细输出
.\scripts\check_gpio_safety.ps1 -ProjectDir "F:\path\to\project" -Detailed
```

### 常见问题

| 问题 | 说明 |
|------|------|
| `GPIO_MODE_INPUT` + `GPIO_MODE_OUTPUT_PP` | 同一引脚冲突配置 |
| 输入无 `PULLUP`/`PULLDOWN` | 浮空引脚易受干扰 |
| I2C 引脚配置为 GPIO 输出 | 会损坏 I2C 设备 |
| 5V 传感器无分压电路 | 会损坏 3.3V ADC 引脚 |
| `__HAL_RCC_GPIOx_CLK_ENABLE()` 未调用 | 外设可能不工作 |

### 输出示例

```
========================================
  STM32 GPIO 与外设模块安全检查
========================================

扫描目录: F:\path\to\project

[1/4] 正在分析源文件...
[2/4] 外置模块检测完成...
[3/4] 生成报告...

========================================
  安全报告
========================================

📦 检测到外置模块 (2)
   [Core/Src/i2c.c] 检测到外置 I2C 模块: MPU6050
   [Core/Src/spi.c] 检测到外置 SPI 模块: ST7789

❌ 严重错误 (1)
   这些错误将导致硬件损坏!
   [Core/Src/i2c.c] I2C 引脚 GPIO_PIN_6 配置为输出 - 会损坏 I2C 设备!

⚠️  警告 (1)
   [Core/Src/main.c] 检测到 5V 传感器 - 请确认 ADC 引脚可承受 5V 或使用分压电路!

========================================
  建议:
  🔴 请勿烧录 - 请先修复严重错误!
     - 外置模块可能已损坏
     - 检查引脚复用配置
     - 验证电压兼容性 (3.3V vs 5V)
========================================
```

### 建议触发时机

1. **每次修改 GPIO 配置后**
2. **添加新的外置模块后**
3. **烧录固件前**（防止硬件损坏）
4. **项目移植到不同芯片时**

---

# 快速参考

## 工具路径（自动检测）

| 工具 | 默认检测位置 |
|------|-------------|
| CMake | `%LOCALAPPDATA%\stm32cube\bundles\cmake\*\bin\cmake.exe` |
| STM32_Programmer_CLI | `%LOCALAPPDATA%\stm32cube\bundles\programmer\*\bin\STM32_Programmer_CLI.exe` |
| arm-none-eabi-gdb | `%LOCALAPPDATA%\stm32cube\bundles\gnu-gdb-for-stm32\*\bin\arm-none-eabi-gdb.exe` |
| ST-LINK_gdbserver | `%LOCALAPPDATA%\stm32cube\bundles\stlink-gdbserver\*\bin\ST-LINK_gdbserver.exe` |
| **Keil UV4** | `D:\keil5\UV4\UV4.exe`（可使用 `-UV4Path` 覆盖） |

## 常用命令

| 任务 | 命令 |
|------|------|
| 编译+烧录 | `.\scripts\build_flash.ps1 -ProjectDir "<path>"` |
| GPIO 安全检查 | `.\scripts\check_gpio_safety.ps1 -ProjectDir "<path>"` ⚠️ |
| 编译 (CMake) | `cmake --build <dir>/build --config Debug` |
| 烧录 | `STM32_Programmer_CLI.exe -c port=SWD --download <elf> -v` |
| Web UI 监控 | `.\monitors\monitor_web.ps1 -SerialPort "COM3"` |
| 命令行监控 | `.\monitors\monitor_serial.ps1 -Port "COM3" -LogFile "log.txt"` |
| 启动调试 | `.\scripts\start_debug.ps1 -ProjectDir "<path>"` |
| 代码格式化 | `clang-format -i <file>` |
| 静态检查 | `cppcheck --enable=warning,style <path>` |

## 验证组件

| 组件 | 版本 |
|------|------|
| CMake | 4.2.3+st.1 |
| STM32_Programmer_CLI | 2.22.0+st.1 |
| arm-none-eabi-gdb | 14.3.1+st.2 |
| ST-LINK_gdbserver | 7.13.0+st.3 |
| Keil UV4 | 5.25.2+ |
| 芯片 | STM32F103 High-density |

---

# 常见问题

| 问题 | 解决方案 |
|------|---------|
| "No ST-Link found" | 检查 USB 连接，换一个 USB 端口 |
| "GDB Server 需要 STM32CubeProgrammer" | 使用 `-cp <programmer_bin>` 参数 |
| "ELF not found" | 先执行编译 |
| GDB 中路径有空格 | 使用短路径或复制到无空格目录 |
| RTT 无输出 | 确保固件中调用了 `SEGGER_RTT_Init()` |
| 串口端口被占用 | 关闭其他串口连接，或用 `-Port` 指定其他 Web 端口 |
| clang-format 未安装 | `winget install LLVM.LLVM` |
| cppcheck 未安装 | `winget install cppcheck.cppcheck` |
| Keil UV4 not found | 检查 `D:\keil5\UV4\UV4.exe` 是否存在，或用 `-UV4Path` 参数指定 |

---

# Templates

模板文件位于 `templates/` 目录，用于代码生成。

## 模板列表

| 模板文件 | 用途 |
|----------|------|
| `fal_module.h.tmpl` | FAL 模块头文件 |
| `fal_module.c.tmpl` | FAL 模块实现 |
| `device_uart.c.tmpl` | UART 驱动 |
| `device_iic.c.tmpl` | I2C 驱动 |
| `device_spi.c.tmpl` | SPI 驱动 |
| `device_gpio.c.tmpl` | GPIO 驱动 |
| `device_adc.c.tmpl` | ADC 驱动 |
| `device_tim.c.tmpl` | 定时器/PWM 驱动 |
| `device_can.c.tmpl` | CAN 驱动 |
| `.clang-format.tmpl` | clang-format 配置 |
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

## 使用方式

1. 复制模板到目标目录
2. 替换占位符为实际值
3. 根据项目需求修改代码