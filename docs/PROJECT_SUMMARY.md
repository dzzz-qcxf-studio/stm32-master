# STM32 Serial Monitor - 项目总结

本项目为 STM32 嵌入式开发添加了**实时串口监控功能**，支持两种使用方式。

## 项目结构

```
stm32_master/
├── monitors/
│   ├── monitor_web.ps1           # Web UI 监控脚本
│   ├── monitor_serial.ps1        # 命令行监控脚本
│   ├── monitor_websocket.ps1     # WebSocket 高性能监控
│   ├── serial_monitor.js         # Web UI 服务器（基础版）
│   ├── serial_monitor_ai.js      # Web UI 服务器（AI 增强版）
│   ├── serial_mcp.js             # MCP 服务器
│   └── package.json             # Node.js 依赖
├── docs/
│   ├── MONITOR_QUICKSTART.md    # 快速开始指南
│   └── MCP_CONFIG.md            # MCP 配置指南
└── README.md                    # 项目说明
```

## 两种使用方式

### 1️⃣ Web UI 模式（推荐）

**优点：**
- 独立浏览器界面
- 美观的 Web 设计
- 支持多客户端连接
- AI Chat 面板（serial_monitor_ai.js）

**使用：**
```powershell
.\monitors\monitor_web.ps1 -SerialPort "COM3"
# 自动打开浏览器
```

**访问：** http://localhost:8080/

### 2️⃣ 命令行模式（脚本集成）

**优点：**
- 轻量级
- 易于脚本集成
- 支持 CI/CD
- 日志文件导出

**使用：**
```powershell
.\monitors\monitor_serial.ps1 -Port "COM3" -LogFile "debug.log"
```

## AI 对话模式（Web UI + MCP）

通过 MCP 接口，AI 可以直接发送命令到串口设备。

**配置步骤：**

1. 启动 Web UI 服务器：
```powershell
cd monitors
node serial_monitor_ai.js --serial COM5 --baud 115200 --port 8080
```

2. 配置全局 MCP：
```bash
claude mcp add --scope user --transport stdio stm32-serial -- node C:/Users/ROG/.claude/skills/stm32_master/monitors/serial_mcp.js --port 8080
```

3. 重启 Claude Code

**可用 MCP 工具：**

| 工具 | 说明 |
|------|------|
| `serial_list_ports` | 列出所有可用串口 |
| `serial_connect` | 连接串口 |
| `serial_disconnect` | 断开连接 |
| `serial_send` | 发送命令 |
| `serial_status` | 获取连接状态 |
| `serial_history` | 获取对话历史 |

## 功能特性

- 端口选择、波特率选择（9600-921600）
- 手动发送、回车键发送
- 清空显示、下载日志
- AI Chat 面板（支持命令历史）
- WebSocket 实时推送
- localStorage 持久化（AI Chat 历史）
