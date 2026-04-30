# STM32 串口监控 - MCP 工具

## 快速使用

AI 直接调用 MCP 工具即可控制串口，无需手动启动服务：

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

启动后访问 http://localhost:8080：
```bash
cd monitors
node serial_monitor_ai.js --serial COM5 --baud 115200 --port 8080
```

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