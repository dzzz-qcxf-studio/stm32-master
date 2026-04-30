const { SerialPort } = require('serialport');
const http = require('http');
const { WebSocketServer } = require('ws');

let DEFAULT_PORT = 'COM5';
let DEFAULT_BAUD = 115200;
let DEFAULT_WEB_PORT = 8080;

// Parse command line arguments (support both positional and named styles)
// Named: --serial COM5 --baud 115200 --port 8080
// Positional: node serial_monitor.js [COM5] [115200] [8080]
// Mixed: node serial_monitor.js COM5 115200
function parseArgs() {
    const args = process.argv.slice(2);
    let i = 0;

    while (i < args.length) {
        const arg = args[i];

        if (arg === '--serial' || arg === '-s') {
            if (i + 1 < args.length) DEFAULT_PORT = args[++i];
        } else if (arg === '--baud' || arg === '-b') {
            if (i + 1 < args.length) DEFAULT_BAUD = parseInt(args[++i]) || 115200;
        } else if (arg === '--port' || arg === '-p') {
            if (i + 1 < args.length) DEFAULT_WEB_PORT = parseInt(args[++i]) || 8080;
        } else if (arg.match(/^COM\d+$/i)) {
            // Positional COM port
            DEFAULT_PORT = arg;
            // Check if next arg is baud or web port
            if (i + 1 < args.length && args[i + 1].match(/^\d{4,6}$/)) {
                const nextVal = parseInt(args[i + 1]);
                if (nextVal >= 1000) {
                    // Could be baud or web port
                    if (nextVal <= 921600) {
                        DEFAULT_BAUD = nextVal;
                    } else {
                        DEFAULT_WEB_PORT = nextVal;
                    }
                    i++;
                }
            }
            if (i + 1 < args.length && args[i + 1].match(/^\d{4,6}$/)) {
                const nextVal = parseInt(args[i + 1]);
                if (nextVal <= 921600) {
                    DEFAULT_BAUD = nextVal;
                } else {
                    DEFAULT_WEB_PORT = nextVal;
                }
                i++;
            }
        } else if (arg.match(/^\d+$/)) {
            const val = parseInt(arg);
            if (val >= 1000 && val <= 921600) {
                DEFAULT_BAUD = val;
            } else if (val >= 1024 && val <= 65535) {
                DEFAULT_WEB_PORT = val;
            }
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
STM32 Serial Monitor - Web-based serial port monitor

Usage:
  node serial_monitor.js [options]

Options:
  -s, --serial <port>   Serial port (e.g., COM5)
  -b, --baud <rate>     Baud rate (default: 115200)
  -p, --port <port>     Web server port (default: 8080)
  -h, --help            Show this help

Examples:
  node serial_monitor.js                      # Use defaults
  node serial_monitor.js COM5                 # COM5, 115200, 8080
  node serial_monitor.js COM5 9600            # COM5, 9600, 8080
  node serial_monitor.js --serial COM5 --baud 115200 --port 8081
`);
            process.exit(0);
        }
        i++;
    }
}

parseArgs();
let currentPort = DEFAULT_PORT;
let currentBaud = DEFAULT_BAUD;
let serialPort = null;
let connected = false;

// Serial port setup
function openSerialPort(port, baudRate, res) {
    if (serialPort && serialPort.isOpen) {
        serialPort.close();
    }

    serialPort = new SerialPort({
        path: port,
        baudRate: baudRate,
        autoOpen: true
    });

    serialPort.on('open', () => {
        connected = true;
        currentPort = port;
        currentBaud = baudRate;
        console.log(`\n✅ Connected to ${port} @ ${baudRate}`);
        broadcastToAll({ type: 'status', status: 'connected', port: port, baudRate: baudRate });
    });

    serialPort.on('data', (data) => {
        const text = data.toString('utf8').trim();
        const hexStr = data.toString('hex').toUpperCase();
        const hexFormatted = hexStr.match(/.{1,2}/g)?.join(' ') || '';
        if (text || hexStr) {
            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + Date.now().toString().slice(-3);
            if (text) {
                console.log(`[${timestamp}] ${text}`);
            }
            broadcastToAll({ type: 'data', message: text, hex: hexFormatted, timestamp: timestamp });
        }
    });

    serialPort.on('error', (err) => {
        console.error(`❌ Serial Error: ${err.message}`);
        broadcastToAll({ type: 'error', message: err.message });
    });

    serialPort.on('close', () => {
        connected = false;
        console.log('Serial port closed');
        broadcastToAll({ type: 'status', status: 'disconnected' });
    });
}

// WebSocket clients
const clients = new Set();

function broadcastToAll(data) {
    const json = JSON.stringify(data);
    clients.forEach(client => {
        try {
            client.send(json);
        } catch (e) {
            clients.delete(client);
        }
    });
}

// List available serial ports
function listPorts() {
    return new Promise((resolve) => {
        SerialPort.list().then(ports => {
            resolve(ports.map(p => ({ path: p.path, manufacturer: p.manufacturer })));
        }).catch(err => {
            resolve([]);
        });
    });
}

// Simple Web Server
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}/`);

    if (parsedUrl.pathname === '/ports') {
        // API endpoint to list ports
        const ports = await listPorts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ports));
        return;
    }

    if (parsedUrl.pathname === '/connect') {
        // Connect to a port
        const port = parsedUrl.searchParams.get('port');
        const baud = parseInt(parsedUrl.searchParams.get('baud')) || 115200;
        openSerialPort(port, baud);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (parsedUrl.pathname === '/disconnect') {
        // Disconnect and close serial port
        if (serialPort && serialPort.isOpen) {
            serialPort.close((err) => {
                if (err) {
                    console.error('Error closing serial port:', err);
                }
            });
        }
        connected = false;
        broadcastToAll({ type: 'status', status: 'disconnected' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (parsedUrl.pathname === '/send') {
        // Send data (plain or hex)
        if (serialPort && serialPort.isOpen) {
            let data = parsedUrl.searchParams.get('data') || '';
            const isHex = parsedUrl.searchParams.get('hex') === '1';

            let buffer;
            if (isHex) {
                // Parse hex string like "48 65 6c 6c 6f" or "48656c6c6f"
                const hexStr = data.replace(/\s+/g, '');
                const bytes = [];
                for (let i = 0; i < hexStr.length; i += 2) {
                    const byte = parseInt(hexStr.substr(i, 2), 16);
                    if (isNaN(byte)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid hex string' }));
                        return;
                    }
                    bytes.push(byte);
                }
                buffer = Buffer.from(bytes);
            } else {
                buffer = Buffer.from(data + '\n');
            }

            serialPort.write(buffer, (err) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, isHex: isHex }));
                }
            });
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not connected' }));
        }
        return;
    }

    // HTML page
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtml());
});

function getHtml() {
    return String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>STM32 Serial Monitor</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Consolas', 'Monaco', monospace;
            background: #1e1e1e;
            color: #d4d4d4;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: #2d2d2d;
            padding: 10px 20px;
            border-bottom: 1px solid #3c3c3c;
        }
        .toolbar {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        .toolbar select, .toolbar input, .toolbar button {
            background: #3c3c3c;
            color: #d4d4d4;
            border: 1px solid #555;
            padding: 6px 10px;
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
        }
        .toolbar button {
            background: #0e639c;
            cursor: pointer;
        }
        .toolbar button:hover { background: #1177bb; }
        .toolbar button.connect { background: #2d7d46; }
        .toolbar button.connect:hover { background: #3d9d56; }
        .toolbar button.disconnect { background: #c44d4d; }
        .toolbar button.disconnect:hover { background: #d45d5d; }
        .status-bar {
            display: flex;
            gap: 15px;
            font-size: 12px;
            margin-top: 8px;
            color: #808080;
        }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #f14c4c; display: inline-block; margin-right: 5px; }
        .status-dot.connected { background: #4ec9b0; }
        .console-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .console {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            font-size: 13px;
            line-height: 1.6;
        }
        .line {
            padding: 2px 5px;
            border-radius: 3px;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .line:hover { background: #2a2a2a; }
        .line .timestamp { color: #6a9955; margin-right: 10px; }
        .line.sent { color: #dcdcaa; }
        .line.error { color: #f14c4c; background: rgba(241, 76, 76, 0.1); }
        .line.warn { color: #cca700; background: rgba(204, 167, 0, 0.1); }
        .line.success { color: #4ec9b0; background: rgba(78, 201, 176, 0.1); }
        .line.info { color: #569cd6; }
        .line.debug { color: #9cdcfe; }
        .line .hex { color: #b5cea8; font-weight: bold; }
        .line .ip { color: #ce9178; }
        .line .unit { color: #4fc1ff; }
        .line .percent { color: #b5cea8; }
        .line .bracket { color: #808080; }
        .line .bracket-error { color: #f14c4c; font-weight: bold; }
        .line .bracket-warn { color: #cca700; font-weight: bold; }
        .line .bracket-success { color: #4ec9b0; font-weight: bold; }
        .line .bracket-info { color: #569cd6; font-weight: bold; }
        .line .bracket-debug { color: #9cdcfe; }
        .line.hex-mode { background: rgba(90, 90, 90, 0.2); }
        .line.hex-mode .hex-content { color: #b5cea8; font-family: 'Consolas', monospace; }
        .line .hex-tag { color: #6a9955; font-size: 11px; margin-right: 8px; }
        .send-bar {
            background: #2d2d2d;
            padding: 10px 20px;
            display: flex;
            gap: 10px;
            border-top: 1px solid #3c3c3c;
        }
        .send-bar input {
            flex: 1;
            background: #3c3c3c;
            color: #d4d4d4;
            border: 1px solid #555;
            padding: 8px 12px;
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
        }
        .send-bar input:focus { outline: none; border-color: #0e639c; }
        .send-bar button {
            background: #2d7d46;
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
        }
        .send-bar button:hover { background: #3d9d56; }
        .send-bar button:disabled { background: #555; cursor: not-allowed; }
        .send-bar .hex-mode { color: #808080; font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; }
        .send-bar .hex-mode input { cursor: pointer; }
        .send-bar .hex-mode:hover { color: #d4d4d4; }
        .footer {
            background: #2d2d2d;
            padding: 8px 20px;
            font-size: 12px;
            color: #808080;
            display: flex;
            justify-content: space-between;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="toolbar">
            <select id="portSelect">
                <option value="">选择串口...</option>
            </select>
            <select id="baudSelect">
                <option value="">选择波特率...</option>
                <option value="9600">9600</option>
                <option value="19200">19200</option>
                <option value="38400">38400</option>
                <option value="57600">57600</option>
                <option value="115200">115200</option>
                <option value="230400">230400</option>
                <option value="460800">460800</option>
                <option value="921600">921600</option>
            </select>
            <button id="connectBtn" class="connect" onclick="toggleConnect()">连接</button>
            <button onclick="refreshPorts()">刷新</button>
            <button onclick="clearConsole()">清空</button>
            <button onclick="downloadLog()">下载</button>
        </div>
        <div class="status-bar">
            <span><span class="status-dot" id="statusDot"></span><span id="statusText">未连接</span></span>
            <span>端口: <span id="portInfo">-</span></span>
            <span>波特率: <span id="baudInfo">-</span></span>
        </div>
    </div>

    <div class="console-container">
        <div class="console" id="console"></div>
    </div>

    <div class="send-bar">
        <input type="text" id="sendInput" placeholder="输入发送内容..." onkeypress="handleKeyPress(event)">
        <button id="sendBtn" onclick="sendData()" disabled>发送</button>
        <label class="hex-mode"><input type="checkbox" id="hexMode"> HEX发送</label>
        <label class="hex-mode"><input type="checkbox" id="hexDisplay" onchange="toggleHexDisplay()"> HEX显示</label>
    </div>

    <div class="footer">
        <div class="stats">
            <span>行数: <span id="lineCount">0</span></span>
            <span>字节: <span id="byteCount">0</span></span>
        </div>
        <span id="timeDisplay"></span>
    </div>

    <script>
        let ws;
        let lineCount = 0;
        let byteCount = 0;
        let logs = [];

        function connect() {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = protocol + '//' + location.host + '/ws?k=' + Date.now();

            ws = new WebSocket(wsUrl);

            ws.onopen = () => console.log('WebSocket connected');
            ws.onclose = () => {
                console.log('WebSocket disconnected, reconnecting...');
                setTimeout(connect, 2000);
            };
            ws.onerror = (err) => console.error('WebSocket error:', err);

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };
        }

        function handleMessage(data) {
            switch (data.type) {
                case 'status':
                    updateStatus(data.status, data.port, data.baudRate);
                    break;
                case 'data':
                    addLine(data.timestamp, data.message, false, null, data.hex);
                    break;
                case 'error':
                    addLine('', '[ERROR] ' + data.message, true, 'error');
                    break;
            }
        }

        function updateStatus(status, port, baudRate) {
            const dot = document.getElementById('statusDot');
            const text = document.getElementById('statusText');
            const portInfo = document.getElementById('portInfo');
            const baudInfo = document.getElementById('baudInfo');
            const connectBtn = document.getElementById('connectBtn');
            const sendBtn = document.getElementById('sendBtn');

            if (status === 'connected') {
                dot.classList.add('connected');
                text.textContent = '已连接';
                portInfo.textContent = port || currentPort;
                baudInfo.textContent = baudRate || currentBaud;
                connectBtn.textContent = '断开';
                connectBtn.classList.remove('connect');
                connectBtn.classList.add('disconnect');
                sendBtn.disabled = false;
            } else {
                dot.classList.remove('connected');
                text.textContent = '未连接';
                portInfo.textContent = '-';
                baudInfo.textContent = '-';
                connectBtn.textContent = '连接';
                connectBtn.classList.remove('disconnect');
                connectBtn.classList.add('connect');
                sendBtn.disabled = true;
            }
        }

        async function refreshPorts() {
            try {
                const res = await fetch('/ports');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const ports = await res.json();
                const select = document.getElementById('portSelect');
                select.innerHTML = '<option value="">选择串口...</option>';
                if (ports.length === 0) {
                    alert('未检测到串口，请检查设备连接');
                }
                ports.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p.path;
                    option.textContent = p.path + (p.manufacturer ? ' (' + p.manufacturer + ')' : '');
                    select.appendChild(option);
                });
            } catch (e) {
                alert('刷新串口失败: ' + e.message);
                console.error('Failed to refresh ports:', e);
            }
        }

        async function toggleConnect() {
            const btn = document.getElementById('connectBtn');
            if (btn.textContent === '连接') {
                const port = document.getElementById('portSelect').value;
                const baud = document.getElementById('baudSelect').value;
                if (!port) {
                    alert('请选择串口');
                    return;
                }
                if (!baud) {
                    alert('请选择波特率');
                    return;
                }
                await fetch('/connect?port=' + port + '&baud=' + baud);
            } else {
                await fetch('/disconnect');
            }
        }

        async function sendData() {
            const input = document.getElementById('sendInput');
            const data = input.value;
            if (!data) return;

            const isHex = document.getElementById('hexMode').checked;

            try {
                const url = '/send?data=' + encodeURIComponent(data) + (isHex ? '&hex=1' : '');
                const res = await fetch(url);
                const result = await res.json();

                const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + Date.now().toString().slice(-3);

                if (isHex) {
                    addLine(timestamp, '[HEX] ' + data.toUpperCase(), true, 'sent');
                } else {
                    addLine(timestamp, data, true, 'sent');
                }
                input.value = '';
            } catch (e) {
                console.error('Failed to send:', e);
            }
        }

        function toggleHexDisplay() {
            // Force re-render of all lines to update hex display
            const consoleEl = document.getElementById('console');
            const lines = consoleEl.querySelectorAll('.line[data-hex]');
            const showHex = document.getElementById('hexDisplay').checked;

            lines.forEach(line => {
                const hexContent = line.querySelector('.hex-content');
                if (hexContent) {
                    hexContent.style.display = showHex ? '' : 'none';
                }
            });
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendData();
            }
        }

        function addLine(timestamp, message, isSent, className, hexData) {
            const consoleEl = document.getElementById('console');
            const line = document.createElement('div');
            line.className = 'line' + (className ? ' ' + className : '');

            // Auto-detect message type and apply highlighting
            if (!className) {
                const lowerMsg = message.toLowerCase();
                const msg = message; // original case for pattern matching

                // Critical errors (highest priority)
                if (/\b(fatal|panic|crash|exception|assert|failed|failure)\b/i.test(msg)) {
                    line.classList.add('error');
                }
                // Warnings
                else if (/\b(warn|warning|caution|attention)\b/i.test(msg)) {
                    line.classList.add('warn');
                }
                // Success states
                else if (/\b(success|ok|passed|ready|initialized|done|complete|✅)\b/i.test(msg)) {
                    line.classList.add('success');
                }
                // Debug/Verbose info
                else if (/\b(debug|trace|verbose|dbg)\b/i.test(msg)) {
                    line.classList.add('debug');
                }
                // System info
                else if (/\b(info|init|start|enter|leave|exit|receive|send)\b/i.test(msg)) {
                    line.classList.add('info');
                }
            }

            // Apply syntax highlighting to message content
            let highlighted = message;

            // Highlight hex patterns: 0xABCD, AB CD EF, 0xAB
            highlighted = highlighted.replace(/(0x[0-9A-Fa-f]+|[0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})+)/g, '<span class="hex">$1</span>');

            // Highlight IP addresses
            highlighted = highlighted.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, '<span class="ip">$1</span>');

            // Highlight bracketed tags like [TAG], [INFO], [ERROR]
            highlighted = highlighted.replace(/\[([^\]]+)\]/g, (match, tag) => {
                const lowerTag = tag.toLowerCase();
                let tagClass = 'bracket';
                if (/error|fail|crit/.test(lowerTag)) tagClass = 'bracket-error';
                else if (/warn/.test(lowerTag)) tagClass = 'bracket-warn';
                else if (/success|ok|pass/.test(lowerTag)) tagClass = 'bracket-success';
                else if (/info|init/.test(lowerTag)) tagClass = 'bracket-info';
                else if (/debug|dbg|trace/.test(lowerTag)) tagClass = 'bracket-debug';
                return '<span class="' + tagClass + '">[' + escapeHtml(tag) + ']</span>';
            });

            // Highlight units and numbers: 3.3V, 100mA, 50Hz, 75%, 1024KB
            highlighted = highlighted.replace(/\b(\d+\.?\d*)\s*(V|mV|A|mA|uA|Hz|kHz|MHz|%|KB|MB|GB|ms|us|ns|s)\b/gi, '<span class="unit">$1$2</span>');

            // Highlight percentages
            highlighted = highlighted.replace(/\b(\d+\.?\d*)%\b/g, '<span class="percent">$1%</span>');

            let lineContent = '';
            if (timestamp) {
                lineContent = '<span class="timestamp">[' + timestamp + ']</span>' + highlighted;
            } else {
                lineContent = highlighted;
            }

            // Add hex data if available
            if (hexData) {
                const showHex = document.getElementById('hexDisplay')?.checked;
                line.setAttribute('data-hex', 'true');
                line.classList.add('hex-mode');
                lineContent += '<br><span class="hex-tag">[HEX]</span><span class="hex-content"' + (showHex ? '' : ' style="display:none"') + '>' + hexData + '</span>';
            }

            line.innerHTML = lineContent;

            consoleEl.appendChild(line);
            consoleEl.scrollTop = consoleEl.scrollHeight;

            // Update stats
            lineCount++;
            byteCount += message.length;
            document.getElementById('lineCount').textContent = lineCount;
            document.getElementById('byteCount').textContent = byteCount;

            // Store for log
            logs.push({ timestamp, message, isSent });

            // Limit lines
            while (consoleEl.children.length > 5000) {
                consoleEl.removeChild(consoleEl.firstChild);
            }
        }

        function clearConsole() {
            document.getElementById('console').innerHTML = '';
            lineCount = 0;
            byteCount = 0;
            logs = [];
            document.getElementById('lineCount').textContent = '0';
            document.getElementById('byteCount').textContent = '0';
        }

        function downloadLog() {
            const content = logs.map(l => (l.timestamp ? '[' + l.timestamp + '] ' : '') + (l.isSent ? '[发送] ' : '') + l.message).join('\\n');
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'serial_log_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
            a.click();
            URL.revokeObjectURL(url);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Update time
        setInterval(() => {
            document.getElementById('timeDisplay').textContent = new Date().toLocaleTimeString();
        }, 1000);

        // Initialize
        refreshPorts();
        connect();
    </script>
</body>
</html>`;
}

// Initialize with default port - but don't auto-connect
// openSerialPort(DEFAULT_PORT, DEFAULT_BAUD);  // Disabled: let user select port first

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Error: Port ${DEFAULT_WEB_PORT} is already in use.`);
        console.error(`   Please close the other application or use: node serial_monitor.js --port 8081\n`);
    } else {
        console.error(`\n❌ Server error: ${err.message}`);
    }
    process.exit(1);
});

// WebSocket server - attach to existing HTTP server
const wss = new WebSocketServer({ server: server });

// Track if server should exit when all clients disconnect
let exitOnClose = false;
let serverStarted = false;
let hasHadClient = false;  // Track if any client has ever connected

wss.on('connection', (ws) => {
    clients.add(ws);
    hasHadClient = true;  // Mark that we've had a client
    console.log('WebSocket client connected');

    // Send current status to new client
    ws.send(JSON.stringify({ type: 'status', status: connected ? 'connected' : 'disconnected', port: currentPort, baudRate: currentBaud }));

    ws.on('close', () => {
        clients.delete(ws);
        console.log('WebSocket client disconnected');
        clients.delete(ws);

        // If all clients disconnected and server was started with exitOnClose flag
        if (clients.size === 0 && exitOnClose && serverStarted) {
            console.log('\nAll clients disconnected. Shutting down...');
            if (serialPort) serialPort.close();
            process.exit(0);
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        clients.delete(ws);
    });

    // Heartbeat to detect dead connections
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat interval to detect dead connections
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection');
            clients.delete(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });

    // Check if all clients are gone - only shutdown if we've had a client before
    if (wss.clients.size === 0 && exitOnClose && serverStarted && hasHadClient) {
        // Give a small grace period for reconnection
        setTimeout(() => {
            if (wss.clients.size === 0 && exitOnClose && serverStarted && hasHadClient) {
                console.log('\nAll clients disconnected. Shutting down...');
                if (serialPort) serialPort.close();
                process.exit(0);
            }
        }, 1000);
    }
}, 30000); // Check every 30 seconds

wss.on('close', () => {
    clearInterval(heartbeat);
});

// List available serial ports
async function getAvailablePorts() {
    try {
        const ports = await SerialPort.list();
        return ports.map(p => p.path);
    } catch {
        return [];
    }
}

// Find available web port starting from requested port
function findAvailablePort(startPort, maxAttempts = 10) {
    return new Promise((resolve) => {
        const net = require('net');
        let port = startPort;
        let attempts = 0;

        function tryPort() {
            const server = net.createServer();
            server.listen(port, () => {
                server.close(() => resolve(port));
            });
            server.on('error', () => {
                attempts++;
                if (attempts < maxAttempts) {
                    port++;
                    tryPort();
                } else {
                    resolve(null); // No port available
                }
            });
        }
        tryPort();
    });
}

// Start server
async function startServer() {
    const { SerialPort } = require('serialport');

    // Show available COM ports
    const availablePorts = await getAvailablePorts();
    console.log('\n========== STM32 Serial Monitor ==========\n');

    if (availablePorts.length > 0) {
        console.log('Available COM ports:');
        availablePorts.forEach(p => console.log('  - ' + p));
        console.log('');
    } else {
        console.log('No COM ports detected.\n');
    }

    server.listen(DEFAULT_WEB_PORT, () => {
        console.log(`Web UI: http://localhost:${DEFAULT_WEB_PORT}`);
        console.log(`Serial:  ${DEFAULT_PORT} @ ${DEFAULT_BAUD}`);
        console.log(`\nPress Ctrl+C to stop (or close browser to exit)\n`);

        // Auto-open browser
        try {
            require('child_process').exec(`start http://localhost:${DEFAULT_WEB_PORT}`);
        } catch (e) {}

        // Enable auto-exit when browser closes
        exitOnClose = true;
        serverStarted = true;

        // Auto-connect to default port
        console.log(`Connecting to ${DEFAULT_PORT}...`);
        openSerialPort(DEFAULT_PORT, DEFAULT_BAUD);
    });
}

startServer();

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (serialPort) serialPort.close();
    process.exit();
});