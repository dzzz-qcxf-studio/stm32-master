# 嵌入式工作流-③代码实现大师

> STM32 全流程开发工具链：编译、烧录、调试、监控、安全检查一站式完成

---

## 它做什么

将接线方案转化为可运行的固件。自动检测项目类型，一键编译烧录，实时串口监控，GPIO 安全检查防止硬件损坏。

```
接线方案确认
        ↓
┌─────────────────────────────────────┐
│  Build    编译项目，报告固件大小      │
│  Flash    SWD 烧录到芯片             │
│  Monitor  串口实时监控（Web UI）      │
│  Debug    GDB / RTT / 串口 Shell     │
│  Format   clang-format 代码格式化    │
│  Lint     cppcheck 静态检查          │
│  Safety   GPIO 引脚冲突检查 ⚠️       │
└─────────────────────────────────────┘
```

## 七大功能

### 1. Build — 编译

自动检测 CMake/Ninja 或 Keil MDK 项目，编译并报告固件大小。

```powershell
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project"
```

```
✅ 编译成功
📊 固件大小：
   text    data     bss     dec     hex filename
  45678    1234    5678   52590    cd6e build/Debug/test2.elf

💾 Flash 占用: 46912 / 524288 bytes (8.9%)
📦 RAM 占用:   6912 / 131072 bytes (5.3%)
```

编译失败时自动诊断：

```
📍 错误 1: Core/Src/main.c:45
   undefined reference to 'HAL_TIM_PWM_Start'
   💡 分析: CubeMX 中可能没有启用 TIM PWM 功能
   🔧 建议: 在 CubeMX 中启用对应的 TIM 外设
```

### 2. Flash — 烧录

通过 STM32CubeProgrammer CLI（SWD）烧录，支持自动验证。

```powershell
# 一键编译+烧录
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project"

# 仅烧录
.\scripts\build_flash.ps1 -ProjectDir "F:\path\to\project" -SkipBuild
```

### 3. Monitor — 串口监控

三种模式，按需选择：

| 模式 | 启动方式 | 特点 |
|------|---------|------|
| **MCP 工具** | AI 直接调用 | `serial_connect()` / `serial_send()` / `serial_history()` |
| **Web UI** | `node monitors/serial_monitor_ai.js` | 浏览器可视化，实时推送，过滤搜索，日志下载 |
| **命令行** | `.\monitors\monitor_serial.ps1` | 轻量级，正则过滤，文件日志 |

### 4. Debug — 调试

```powershell
# GDB 调试
.\scripts\start_debug.ps1 -ProjectDir "<path>"

# RTT Viewer（需 J-Link）
.\scripts\start_debug.ps1 -ProjectDir "<path>" -RTT

# 串口 Shell
.\scripts\start_debug.ps1 -ProjectDir "<path>" -Shell
```

支持 VS Code F5 一键调试（自动生成 `launch.json`）。

### 5. Format — 代码格式化

```powershell
clang-format -i Core/Src/main.c
```

仅格式化业务层代码（fal/, pal/, common/），不动 HAL/CMSIS。

### 6. Lint — 静态检查

```powershell
cppcheck --enable=warning,style,performance,portability fal/ common/
```

内置嵌入式误报过滤（硬件寄存器写入、ISR 共享变量、HAL 回调等）。

### 7. Safety — GPIO 安全检查 ⚠️

**烧录前必查**，防止硬件损坏：

| 检查项 | 风险等级 |
|--------|----------|
| 输入/输出引脚冲突 | 🔴 严重 |
| 复用功能冲突 | 🔴 严重 |
| I2C/SPI/UART 引脚配置错误 | 🔴 严重 |
| 3.3V MCU 连接 5V 模块 | 🔴 严重 |
| 浮空输入无上拉/下拉 | 🟡 中等 |
| 时钟未使能 | 🟡 中等 |

```powershell
.\scripts\check_gpio_safety.ps1 -ProjectDir "F:\path\to\project"
```

```
📦 检测到外置模块 (2)
   [i2c.c] 检测到外置 I2C 模块: MPU6050
   [spi.c] 检测到外置 SPI 模块: ST7789

❌ 严重错误 (1)
   [i2c.c] I2C 引脚 GPIO_PIN_6 配置为输出 - 会损坏 I2C 设备!

🔴 请勿烧录 - 请先修复严重错误!
```

## 代码模板

内置 11 个驱动模板，支持占位符自动替换：

| 模板 | 外设 |
|------|------|
| `device_gpio.c` | GPIO 读写 |
| `device_uart.c` | UART 通信 |
| `device_spi.c` | SPI 驱动 |
| `device_iic.c` | I2C 驱动 |
| `device_adc.c` | ADC 采集 |
| `device_tim.c` | 定时器/PWM |
| `device_can.c` | CAN 总线 |
| `fal_module.c/h` | FreeRTOS 任务框架 |

## 支持的项目类型

| 类型 | 检测方式 |
|------|---------|
| **Keil MDK** | `Projects/MDK-ARM/*.uvprojx` |
| **CMake/Ninja** | 根目录 `CMakeLists.txt` |

## 工具依赖（自动检测）

| 工具 | 用途 |
|------|------|
| CMake / Keil UV4 | 编译 |
| STM32CubeProgrammer CLI | 烧录 |
| arm-none-eabi-gdb | GDB 调试 |
| ST-LINK GDB Server | 调试服务 |
| clang-format | 代码格式化 |
| cppcheck | 静态检查 |
| PowerShell 5.0+ | 脚本执行 |

## 目录结构

```
stm32-master/
├── scripts/
│   ├── build_flash.ps1           # 一键编译+烧录
│   ├── start_debug.ps1           # 调试会话启动
│   └── check_gpio_safety.ps1     # GPIO 安全检查
├── monitors/
│   ├── monitor_web.ps1           # Web UI 启动
│   ├── monitor_serial.ps1        # 命令行监控
│   ├── serial_monitor_ai.js      # AI 增强版 Web UI
│   └── serial_mcp.js             # MCP 服务器
├── templates/                    # 11 个代码模板
└── SKILL.md                      # 完整文档
```

## 工作流位置

```
①需求分析大师 → ②效果呈现大师 → ③代码实现大师
 需求文档         接线图/架构图       (当前位置)
                                   编译/烧录/调试/监控
```

接收 ② 确认的接线方案，生成驱动代码，编译烧录到硬件，串口监控验证功能。
