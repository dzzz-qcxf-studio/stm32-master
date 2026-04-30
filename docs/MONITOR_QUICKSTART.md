# STM32 串口监控快速开始

## MCP 工具（推荐）

AI 直接调用 MCP 工具控制串口：

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

---

## Web UI（备用）

```bash
cd monitors
node serial_monitor_ai.js --serial COM5 --baud 115200 --port 8080
```
访问 http://localhost:8080

---

## 命令行（备用）

```powershell
.\monitors\monitor_serial.ps1 -Port "COM5" -LogFile "debug.log"
```

---

## 查看可用端口

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

---

## 故障排查

| 问题 | 解决方法 |
|------|---------|
| 端口列表为空 | 检查 USB 连接，安装 CH340/FTDI 驱动 |
| 连接失败 | 端口可能被占用，换一个端口试试 |
| Web UI 无数据 | 确认已连接，波特率是否匹配 |