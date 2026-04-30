# CLAUDE.md

## 项目概述

STM32 Build, Flash & Debug Skill - 嵌入式 STM32 开发工作流，支持编译、烧录、调试、代码格式化和静态检查。

## 文档一致性检查

当用户要求"检查文档一致性"或类似请求时，必须执行以下检查：

### 1. 项目结构同步检查

检查 `README.md` 和 `SKILL.md` 中的目录结构是否与实际文件系统一致：

**必须检查的目录：**
- `scripts/` - 包含 `build_flash.ps1`, `start_debug.ps1`, `check_gpio_safety.ps1`
- `monitors/` - 包含 `monitor_web.ps1`, `monitor_serial.ps1`, `monitor_websocket.ps1`, `serial_monitor.js`, `package.json`, `node_modules/`
- `docs/` - 包含 `FILES_MANIFEST.md`, `MONITOR_QUICKSTART.md`, `PROJECT_SUMMARY.md`
- `templates/` - 包含模板文件

### 2. 文档更新规则

当添加、删除或重命名项目中的文件时，必须同步更新：

| 操作 | 必须更新的文档 |
|------|---------------|
| 添加新脚本 | `README.md` 项目结构、SKILL.md 目录结构 |
| 添加新文档 | `README.md` 项目结构、SKILL.md 目录结构 |
| 添加新模板 | `README.md` 模板表格、SKILL.md 模板列表 |
| 删除文件 | 从对应文档中移除该文件条目 |
| 重命名文件 | 更新对应文档中的文件名 |

### 3. 快速验证命令

```powershell
# 检查 scripts/ 目录文件
ls scripts/

# 检查 monitors/ 目录文件
ls monitors/

# 检查 docs/ 目录文件
ls docs/

# 检查 templates/ 目录文件
ls templates/
```

### 4. 修复流程

1. 运行上述命令获取实际文件列表
2. 对比 `README.md` 和 `SKILL.md` 中的目录结构部分
3. 如有差异，更新文档使其与实际文件系统一致
4. 确保两个文档中的结构描述完全相同