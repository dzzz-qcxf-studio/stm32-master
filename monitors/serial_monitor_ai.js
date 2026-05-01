#!/usr/bin/env node
/**
 * STM32 Serial Monitor with AI Chat Panel
 * 
 * A beautifully designed serial monitor with AI interaction support.
 * AI can read device output and send commands via WebSocket API.
 * 
 * Usage:
 *   node serial_monitor_ai.js                    # Default settings
 *   node serial_monitor_ai.js --serial COM7       # Custom serial port
 *   node serial_monitor_ai.js --port 8080         # Web UI port
 */

const { SerialPort } = require('serialport');
const http = require('http');
const { WebSocketServer } = require('ws');

let DEFAULT_PORT = 'COM5';
let DEFAULT_BAUD = 115200;
let DEFAULT_WEB_PORT = 8080;

// Parse command line arguments
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
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
STM32 Serial Monitor with AI Chat

Usage:
  node serial_monitor_ai.js [options]

Options:
  -s, --serial <port>   Serial port (default: COM5)
  -b, --baud <rate>     Baud rate (default: 115200)
  -p, --port <port>     Web server port (default: 8080)
  -h, --help            Show this help
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

// AI Chat history (for AI panel - user/ai对话式交互)
const MAX_CHAT_HISTORY = 200;
let aiChatHistory = [];
const CHAT_HISTORY_FILE = 'ai_chat_history.json';
let chatHistoryFileWatcher = null;

// Serial log buffer (for serial console - 不需要持久化)
const MAX_SERIAL_LOG = 500;
let serialLogBuffer = [];

// Load chat history from file
function loadChatHistory() {
    try {
        const fs = require('fs');
        if (fs.existsSync(CHAT_HISTORY_FILE)) {
            const data = fs.readFileSync(CHAT_HISTORY_FILE, 'utf8');
            aiChatHistory = JSON.parse(data);
            console.log(`[History] Loaded ${aiChatHistory.length} messages from file`);
        }
    } catch (err) {
        console.error('[History] Failed to load:', err.message);
        aiChatHistory = [];
    }
}

// Save chat history to file
function saveChatHistory() {
    try {
        const fs = require('fs');
        fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(aiChatHistory, null, 2));
    } catch (err) {
        console.error('[History] Failed to save:', err.message);
    }
}

// Watch chat history file for external changes (e.g., MCP modifications)
function setupChatHistoryWatcher() {
    const fs = require('fs');
    let lastModified = 0;

    try {
        const stats = fs.statSync(CHAT_HISTORY_FILE);
        lastModified = stats.mtimeMs;
    } catch {}

    chatHistoryFileWatcher = setInterval(() => {
        try {
            const stats = fs.statSync(CHAT_HISTORY_FILE);
            if (stats.mtimeMs > lastModified) {
                lastModified = stats.mtimeMs;
                console.log('[History] File changed externally, reloading...');
                loadChatHistory();
                broadcastToAll({
                    type: 'chat_history_reload',
                    history: aiChatHistory
                });
            }
        } catch {}
    }, 1000);
}

// Initialize: load existing history
loadChatHistory();
setupChatHistoryWatcher();

// Serial port setup
function openSerialPort(port, baudRate) {
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
        console.log(`\n[UI] Connected to ${port} @ ${baudRate}`);
        broadcastToAll({ type: 'status', status: 'connected', port: port, baudRate: baudRate });
    });

    serialPort.on('data', (data) => {
        const text = data.toString('utf8');
        const hexStr = data.toString('hex').toUpperCase();
        const hexFormatted = hexStr.match(/.{1,2}/g)?.join(' ') || '';
        const timestamp = new Date().toISOString();

        if (text.trim() || hexStr) {
            broadcastToAll({
                type: 'data',
                message: text,
                hex: hexFormatted,
                timestamp: timestamp,
                source: 'device'
            });

            // Add to serial log buffer (for AI context, not persisted)
            serialLogBuffer.push({
                content: text.trim(),
                timestamp: timestamp,
                type: 'received'
            });
            if (serialLogBuffer.length > MAX_SERIAL_LOG) serialLogBuffer.shift();
        }
    });

    serialPort.on('error', (err) => {
        console.error(`[UI] Serial Error: ${err.message}`);
        broadcastToAll({ type: 'error', message: err.message });
    });

    serialPort.on('close', () => {
        connected = false;
        console.log('[UI] Serial port closed');
        broadcastToAll({ type: 'status', status: 'disconnected' });
    });
}

function sendToSerial(data, isHex = false) {
    return new Promise((resolve, reject) => {
        if (!serialPort || !serialPort.isOpen) {
            reject(new Error('Not connected'));
            return;
        }

        let buffer;
        if (isHex) {
            const hexStr = data.replace(/\s+/g, '');
            const bytes = [];
            for (let i = 0; i < hexStr.length; i += 2) {
                const byte = parseInt(hexStr.substr(i, 2), 16);
                if (isNaN(byte)) {
                    reject(new Error('Invalid hex string'));
                    return;
                }
                bytes.push(byte);
            }
            buffer = Buffer.from(bytes);
        } else {
            buffer = Buffer.from(data + '\n');
        }

        serialPort.write(buffer, (err) => {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
}

// WebSocket clients
const clients = new Set();

function broadcastToAll(data) {
    const json = JSON.stringify(data);
    console.log('[DEBUG broadcastToAll] type:', data.type, '| clients.size:', clients.size);
    if (clients.size === 0) {
        console.log('[DEBUG broadcastToAll] NO CLIENTS - skipping');
        return;
    }
    clients.forEach(client => {
        console.log('[DEBUG broadcastToAll] client._closing:', client._closing, 'readyState:', client.readyState);
        if (client._closing) {
            console.log('[DEBUG broadcastToAll] skipping closing client');
            return;
        }
        try {
            client.send(json);
            console.log('[DEBUG broadcastToAll] send() called successfully on one client');
        } catch (e) {
            console.error('[DEBUG broadcastToAll] Error:', e.message);
        }
    });
    console.log('[DEBUG broadcastToAll] done');
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

// HTTP Server
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}/`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (parsedUrl.pathname === '/api/ports') {
        const ports = await listPorts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ports));
        return;
    }

    if (parsedUrl.pathname === '/api/connect') {
        const port = parsedUrl.searchParams.get('port');
        const baud = parseInt(parsedUrl.searchParams.get('baud')) || 115200;
        openSerialPort(port, baud);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (parsedUrl.pathname === '/api/disconnect') {
        if (serialPort && serialPort.isOpen) {
            serialPort.close();
        }
        connected = false;
        broadcastToAll({ type: 'status', status: 'disconnected' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (parsedUrl.pathname === '/api/send') {
        let data;
        let isHex;
        let from;
        try {
            data = parsedUrl.searchParams.get('data') || '';
            isHex = parsedUrl.searchParams.get('hex') === '1';
            from = parsedUrl.searchParams.get('from') || 'user';
            console.log('[DEBUG /api/send] === RECEIVED ===');
            console.log('[DEBUG /api/send] data:', JSON.stringify(data));
            console.log('[DEBUG /api/send] from:', from);
            console.log('[DEBUG /api/send] clients.size BEFORE:', clients.size);
            console.log('[DEBUG /api/send] clients:', Array.from(clients).map(c => ({
                _closing: c._closing,
                readyState: c.readyState,
                url: c.protocol
            })));
        } catch (err) {
            console.error('[DEBUG /api/send] parse error:', err);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
        }

        const timestamp = new Date().toISOString();
        const msgType = from === 'ai' ? 'ai_message' : 'user_message';

        const chatEntry = {
            role: from,
            content: data,
            timestamp: timestamp,
            type: 'sent',
            isHex
        };

        aiChatHistory.push(chatEntry);
        if (aiChatHistory.length > MAX_CHAT_HISTORY) aiChatHistory.shift();
        saveChatHistory();
        console.log('[DEBUG /api/send] history now has', aiChatHistory.length, 'entries');
        console.log('[DEBUG /api/send] calling broadcastToAll...');
        broadcastToAll({ type: msgType, ...chatEntry });
        console.log('[DEBUG /api/send] broadcastToAll returned');
        console.log('[DEBUG /api/send] === DONE ===');

        // Send to serial port asynchronously (don't hold up the response)
        sendToSerial(data, isHex).catch(err => {
            console.error('[/api/send] Serial write error:', err.message);
            broadcastToAll({ type: 'error', message: 'Serial write failed: ' + err.message, timestamp });
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, timestamp }));
        return;
    }

    if (parsedUrl.pathname === '/api/chat/history') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(aiChatHistory));
        return;
    }

    if (parsedUrl.pathname === '/api/chat/clear') {
        aiChatHistory = [];
        saveChatHistory();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // POST /api/chat/ai-message - AI sends message via MCP
    if (parsedUrl.pathname === '/api/chat/ai-message' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { content } = JSON.parse(body);
                const timestamp = new Date().toISOString();

                // Add AI message to chat history (for AI panel)
                aiChatHistory.push({
                    role: 'ai',
                    content: content,
                    timestamp: timestamp,
                    type: 'ai_message'
                });
                if (aiChatHistory.length > MAX_CHAT_HISTORY) aiChatHistory.shift();

                // Save to file and broadcast
                saveChatHistory();
                broadcastToAll({
                    type: 'ai_message',
                    role: 'ai',
                    content: content,
                    timestamp: timestamp
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (parsedUrl.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            connected,
            port: currentPort,
            baudRate: currentBaud
        }));
        return;
    }

    // HTML page
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtml());
});

function getHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>STM32 AI 串口监视器</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            /* Color System - Slate + Cyan */
            --bg-base: #0a0e14;
            --bg-surface: #0f172a;
            --bg-elevated: #1e293b;
            --bg-hover: #334155;
            --border: #334155;
            --border-subtle: #1e293b;
            
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            
            --accent: #22d3ee;
            --accent-dim: rgba(34, 211, 238, 0.15);
            --accent-glow: rgba(34, 211, 238, 0.4);
            
            --success: #4ade80;
            --success-dim: rgba(74, 222, 128, 0.15);
            
            --error: #f87171;
            --error-dim: rgba(248, 113, 113, 0.15);
            
            --warning: #fbbf24;
            --warning-dim: rgba(251, 191, 36, 0.15);
            
            /* Typography */
            --font-ui: 'Plus Jakarta Sans', system-ui, sans-serif;
            --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
            
            /* Spacing */
            --space-1: 4px;
            --space-2: 8px;
            --space-3: 12px;
            --space-4: 16px;
            --space-5: 20px;
            --space-6: 24px;
            --space-8: 32px;
            
            /* Radius */
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-full: 9999px;
            
            /* Transitions */
            --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
            --duration-fast: 150ms;
            --duration-normal: 200ms;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
            height: 100%;
            font-family: var(--font-ui);
            background: var(--bg-base);
            color: var(--text-primary);
            -webkit-font-smoothing: antialiased;
        }

        /* Layout */
        .app {
            display: grid;
            grid-template-rows: auto 1fr auto;
            height: 100vh;
            overflow: hidden;
        }

        /* Header */
        .header {
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border-subtle);
            padding: var(--space-4) var(--space-6);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-6);
        }

        .logo {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            font-weight: 700;
            font-size: 18px;
            color: var(--text-primary);
        }

        .logo-mark {
            width: 36px;
            height: 36px;
            background: linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%);
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 20px var(--accent-glow);
        }

        .logo-mark svg {
            width: 20px;
            height: 20px;
            color: var(--bg-base);
        }

        .controls {
            display: flex;
            align-items: center;
            gap: var(--space-3);
        }

        .control-group {
            display: flex;
            align-items: center;
            background: var(--bg-elevated);
            border-radius: var(--radius-md);
            padding: var(--space-1);
            gap: var(--space-1);
        }

        select {
            background: transparent;
            color: var(--text-primary);
            border: none;
            padding: var(--space-2) var(--space-3);
            font-family: var(--font-ui);
            font-size: 13px;
            cursor: pointer;
            outline: none;
            border-radius: var(--radius-sm);
            transition: background var(--duration-fast);
        }

        select:hover {
            background: var(--bg-hover);
        }

        select:focus {
            background: var(--bg-hover);
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-4);
            font-family: var(--font-ui);
            font-size: 13px;
            font-weight: 500;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--duration-normal) var(--ease-out);
            outline: none;
        }

        .btn-ghost {
            background: transparent;
            color: var(--text-secondary);
        }

        .btn-ghost:hover {
            background: var(--bg-elevated);
            color: var(--text-primary);
        }

        .btn-primary {
            background: var(--accent);
            color: var(--bg-base);
        }

        .btn-primary:hover {
            background: #06b6d4;
            box-shadow: 0 0 20px var(--accent-glow);
        }

        .btn-danger {
            background: var(--error);
            color: white;
        }

        .btn-danger:hover {
            background: #ef4444;
            box-shadow: 0 0 20px rgba(248, 113, 113, 0.4);
        }

        .status-badge {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            background: var(--bg-elevated);
            border-radius: var(--radius-full);
            font-size: 12px;
            font-weight: 500;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--text-muted);
            transition: all var(--duration-normal);
        }

        .status-badge.connected .status-dot {
            background: var(--success);
            box-shadow: 0 0 8px var(--success);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* Main Content */
        .main {
            display: grid;
            grid-template-columns: 1fr 400px;
            overflow: hidden;
        }

        /* Console Panel */
        .panel {
            display: flex;
            flex-direction: column;
            background: var(--bg-surface);
            border-right: 1px solid var(--border-subtle);
            overflow: hidden;
        }

        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-3) var(--space-4);
            border-bottom: 1px solid var(--border-subtle);
            background: var(--bg-elevated);
            flex-shrink: 0;
        }

        .panel-title {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
        }

        .panel-title svg {
            width: 14px;
            height: 14px;
            opacity: 0.7;
        }

        .panel-stats {
            font-size: 11px;
            color: var(--text-muted);
            font-family: var(--font-mono);
        }

        .console-scroll {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-4);
        }

        .console-scroll::-webkit-scrollbar {
            width: 6px;
        }

        .console-scroll::-webkit-scrollbar-track {
            background: transparent;
        }

        .console-scroll::-webkit-scrollbar-thumb {
            background: var(--bg-hover);
            border-radius: 3px;
        }

        .log-entry {
            font-family: var(--font-mono);
            font-size: 13px;
            line-height: 1.6;
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-sm);
            margin-bottom: var(--space-1);
            border-left: 2px solid transparent;
            transition: background var(--duration-fast);
        }

        .log-entry:hover {
            background: var(--bg-elevated);
        }

        .log-entry .time {
            color: var(--text-muted);
            font-size: 11px;
            margin-right: var(--space-3);
        }

        .log-entry.received {
            border-left-color: var(--success);
            background: var(--success-dim);
        }

        .log-entry.sent {
            border-left-color: var(--warning);
            color: var(--warning);
        }

        .log-entry.error {
            border-left-color: var(--error);
            background: var(--error-dim);
            color: var(--error);
        }

        .log-entry .label {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            margin-right: var(--space-2);
            text-transform: uppercase;
        }

        .label-device { background: var(--success-dim); color: var(--success); }
        .label-sent { background: var(--warning-dim); color: var(--warning); }
        .label-error { background: var(--error-dim); color: var(--error); }

        /* Empty State */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            color: var(--text-muted);
        }

        .empty-icon {
            width: 64px;
            height: 64px;
            margin-bottom: var(--space-4);
            opacity: 0.3;
        }

        .empty-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: var(--space-2);
        }

        .empty-desc {
            font-size: 13px;
        }

        /* Send Bar */
        .send-bar {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-4);
            background: var(--bg-elevated);
            border-top: 1px solid var(--border-subtle);
        }

        .input-wrapper {
            flex: 1;
            position: relative;
        }

        .input-wrapper input {
            width: 100%;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: var(--space-3) var(--space-4);
            font-family: var(--font-mono);
            font-size: 13px;
            border-radius: var(--radius-md);
            outline: none;
            transition: all var(--duration-normal) var(--ease-out);
        }

        .input-wrapper input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-dim);
        }

        .input-wrapper input::placeholder {
            color: var(--text-muted);
        }

        .input-wrapper input:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toggle {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            background: var(--bg-surface);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 12px;
            color: var(--text-secondary);
            transition: all var(--duration-fast);
        }

        .toggle:hover {
            background: var(--bg-hover);
        }

        .toggle.active {
            background: var(--accent-dim);
            color: var(--accent);
        }

        .toggle input {
            display: none;
        }

        /* AI Panel */
        .ai-panel {
            display: flex;
            flex-direction: column;
            background: var(--bg-base);
            overflow: hidden;
            position: relative;
        }

        .ai-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-3) var(--space-4);
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border-subtle);
            flex-shrink: 0;
        }

        .ai-title {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
        }

        .ai-badge {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-1) var(--space-2);
            background: var(--accent-dim);
            color: var(--accent);
            border-radius: var(--radius-sm);
            font-size: 10px;
            font-weight: 600;
        }

        .chat-scroll {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-4);
        }

        .chat-scroll::-webkit-scrollbar {
            width: 6px;
        }

        .chat-scroll::-webkit-scrollbar-track {
            background: transparent;
        }

        .chat-scroll::-webkit-scrollbar-thumb {
            background: var(--bg-hover);
            border-radius: 3px;
        }

        .message {
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-lg);
            margin-bottom: var(--space-3);
            font-size: 13px;
            line-height: 1.5;
            animation: slideIn 0.3s var(--ease-out);
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message.user {
            background: linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%);
            color: var(--bg-base);
            margin-left: var(--space-8);
            border-bottom-right-radius: var(--radius-sm);
        }

        .message.ai {
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            color: #fff;
            margin-left: var(--space-8);
            border-bottom-right-radius: var(--radius-sm);
        }

        .message.device {
            background: var(--bg-elevated);
            border: 1px solid var(--border-subtle);
            border-bottom-left-radius: var(--radius-sm);
            font-family: var(--font-mono);
            font-size: 12px;
        }

        .message-time {
            font-size: 10px;
            opacity: 0.6;
            margin-top: var(--space-1);
        }

        /* API Info Card */
        .api-card {
            margin: var(--space-4);
            padding: var(--space-4);
            background: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-lg);
        }

        .api-card-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--accent);
            margin-bottom: var(--space-3);
        }

        .api-endpoint {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) 0;
            font-size: 12px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-subtle);
        }

        .api-endpoint:last-child {
            border-bottom: none;
        }

        .api-method {
            font-family: var(--font-mono);
            font-size: 10px;
            font-weight: 600;
            padding: 2px 6px;
            background: var(--bg-elevated);
            border-radius: 3px;
            color: var(--text-muted);
        }

        .api-method.get { color: var(--success); }
        .api-method.ws { color: var(--warning); }

        .api-path {
            font-family: var(--font-mono);
            color: var(--text-primary);
        }

        /* Footer */
        .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-2) var(--space-6);
            background: var(--bg-surface);
            border-top: 1px solid var(--border-subtle);
            font-size: 11px;
            color: var(--text-muted);
        }

        .footer-info {
            display: flex;
            gap: var(--space-6);
        }

        /* Tweaks Panel */
        .tweaks-toggle {
            position: fixed;
            bottom: 48px;
            right: var(--space-4);
            width: 40px;
            height: 40px;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all var(--duration-normal);
            z-index: 100;
        }

        .tweaks-toggle:hover {
            background: var(--bg-hover);
            border-color: var(--accent);
        }

        .tweaks-panel {
            position: fixed;
            bottom: 100px;
            right: var(--space-4);
            width: 280px;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: var(--space-4);
            z-index: 100;
            opacity: 0;
            visibility: hidden;
            transform: translateY(10px);
            transition: all var(--duration-normal) var(--ease-out);
        }

        .tweaks-panel.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }

        .tweaks-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: var(--space-4);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .tweak-item {
            margin-bottom: var(--space-4);
        }

        .tweak-label {
            font-size: 11px;
            color: var(--text-muted);
            margin-bottom: var(--space-2);
        }

        .tweak-slider {
            width: 100%;
            height: 4px;
            background: var(--bg-elevated);
            border-radius: 2px;
            outline: none;
            -webkit-appearance: none;
        }

        .tweak-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            background: var(--accent);
            border-radius: 50%;
            cursor: pointer;
        }

        /* Responsive */
        @media (max-width: 900px) {
            .main {
                grid-template-columns: 1fr;
            }
            .ai-panel {
                display: none;
            }
        }
    </style>
</head>
<body>
    <div class="app">
        <header class="header">
            <div class="logo">
                <div class="logo-mark">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <span>STM32 AI 串口监视器</span>
            </div>
            <div class="controls">
                <div class="control-group">
                    <select id="portSelect">
                        <option value="">选择串口</option>
                    </select>
                    <select id="baudSelect">
                        <option value="9600">9600</option>
                        <option value="19200">19200</option>
                        <option value="38400">38400</option>
                        <option value="57600">57600</option>
                        <option value="115200" selected>115200</option>
                        <option value="230400">230400</option>
                        <option value="460800">460800</option>
                        <option value="921600">921600</option>
                    </select>
                </div>
                    <button id="connectBtn" class="btn btn-primary" onclick="toggleConnect()">
                        连接
                    </button>
                    <button class="btn btn-ghost" onclick="refreshPorts()">刷新</button>
                    <button class="btn btn-ghost" onclick="clearConsole()">清空</button>
            </div>
                    <div id="statusBadge" class="status-badge">
                        <span class="status-dot"></span>
                        <span id="statusText">未连接</span>
                    </div>
        </header>

        <main class="main">
            <section class="panel">
                <div class="panel-header">
                    <div class="panel-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                        串口输出
                    </div>
                    <div class="panel-stats">
                        <span id="lineCount">0</span> lines | <span id="byteCount">0</span> bytes
                    </div>
                </div>
                <div class="console-scroll" id="consoleScroll">
                    <div class="empty-state" id="emptyState">
                        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                            <path d="M12 8v4"/>
                            <circle cx="12" cy="16" r="1"/>
                        </svg>
                        <div class="empty-title">未连接设备</div>
                        <div class="empty-desc">选择串口并点击连接</div>
                    </div>
                </div>
                <div class="send-bar">
                    <div class="input-wrapper">
                        <input type="text" id="sendInput" placeholder="发送命令..." onkeypress="handleKeyPress(event)" disabled>
                    </div>
                    <button id="sendBtn" class="btn btn-primary" onclick="sendData()" disabled>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"/>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                        发送
                    </button>
                    <label class="toggle" id="hexToggle" onclick="toggleHex()">
                        <input type="checkbox" id="hexMode">
                        <span>HEX</span>
                    </label>
                    <label class="toggle active" id="autoScrollToggle" onclick="toggleAutoScroll()">
                        <input type="checkbox" id="autoScroll" checked>
                        <span>自动滚动</span>
                    </label>
                </div>
            </section>

            <section class="ai-panel">
                <div class="ai-header">
                    <div class="ai-title">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        AI 对话
                        <span class="ai-badge">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="12" r="10"/>
                            </svg>
                            AI 就绪
                        </span>
                    </div>
                    <button class="btn btn-ghost" onclick="clearChat()" style="padding: 4px 8px; font-size: 11px;">清空</button>
                </div>
                <div class="chat-scroll" id="chatScroll">
                    <div class="api-card">
                        <div class="api-card-title">API 接口</div>
                        <div class="api-endpoint">
                            <span class="api-method get">GET</span>
                            <span class="api-path">/api/ports</span>
                        </div>
                        <div class="api-endpoint">
                            <span class="api-method get">GET</span>
                            <span class="api-path">/api/connect?port=X</span>
                        </div>
                        <div class="api-endpoint">
                            <span class="api-method get">GET</span>
                            <span class="api-path">/api/send?data=...</span>
                        </div>
                        <div class="api-endpoint">
                            <span class="api-method ws">WS</span>
                            <span class="api-path">/ws</span>
                        </div>
                    </div>
                    <div class="api-card" style="margin-top: 0;">
                        <div class="api-card-title">MCP 集成</div>
                        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                            配置 <code style="color: var(--accent);">.cursor/mcps.json</code> 以启用 AI 控制串口。
                        </div>
                    </div>
                </div>
            </section>
        </main>

        <footer class="footer">
            <div class="footer-info">
                <span>Port: <span id="portInfo">-</span></span>
                <span>Baud: <span id="baudInfo">-</span></span>
            </div>
            <span id="timeDisplay"></span>
        </footer>
    </div>

    <!-- Tweaks Panel -->
    <div class="tweaks-toggle" onclick="toggleTweaks()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
    </div>
    <div class="tweaks-panel" id="tweaksPanel">
        <div class="tweaks-title">设置</div>
        <div class="tweak-item">
            <div class="tweak-label">字体大小</div>
            <input type="range" class="tweak-slider" id="fontSizeSlider" min="11" max="16" value="13" onchange="updateFontSize(this.value)">
        </div>
        <div class="tweak-item">
            <div class="tweak-label">AI 面板宽度</div>
            <input type="range" class="tweak-slider" id="panelWidthSlider" min="300" max="600" value="400" onchange="updatePanelWidth(this.value)">
        </div>
    </div>

    <script>
        let ws;
        let lineCount = 0;
        let byteCount = 0;
        let isConnected = false;

        function connectWS() {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = protocol + '//' + location.host + '/ws?k=' + Date.now();

            ws = new WebSocket(wsUrl);

            ws.onopen = () => console.log('Connected');
            ws.onclose = () => {
                console.log('Disconnected, reconnecting...');
                setTimeout(connectWS, 2000);
            };
            ws.onerror = (err) => console.error('WS Error:', err);

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[WS Received]', data.type, data);
                    handleMessage(data);
                } catch (e) {
                    console.error('Parse error:', e);
                }
            };
        }

        function handleMessage(data) {
            console.log('[DEBUG handleMessage] type:', data.type, 'content:', data.content);
            switch (data.type) {
                case 'status':
                    updateStatus(data.status, data.port, data.baudRate);
                    break;
                case 'data':
                    addLogLine(data);
                    break;
                case 'error':
                    addLogLine({ type: 'error', message: data.message, timestamp: new Date().toISOString() });
                    break;
                case 'user_message':
                    // User sent message - show in AI chat panel
                    console.log('[DEBUG handleMessage] user_message, calling addChatMessage');
                    addChatMessage('user', data.content);
                    break;
                case 'ai_message':
                    // AI (MCP) sent message - show in AI chat panel
                    console.log('[DEBUG handleMessage] ai_message, calling addChatMessage');
                    addChatMessage('ai', data.content);
                    break;
                case 'device_message':
                    // Device response - show in AI chat panel
                    addChatMessage('device', data.content);
                    break;
                case 'chat_history_reload':
                    // External change detected, reload the chat panel
                    reloadChatHistory(data.history);
                    break;
            }
        }

        function updateStatus(status, port, baudRate) {
            const badge = document.getElementById('statusBadge');
            const text = document.getElementById('statusText');
            const btn = document.getElementById('connectBtn');
            const input = document.getElementById('sendInput');
            const sendBtn = document.getElementById('sendBtn');
            const emptyState = document.getElementById('emptyState');

            isConnected = status === 'connected';

            if (status === 'connected') {
                badge.classList.add('connected');
                text.textContent = port + ' @ ' + baudRate;
                btn.textContent = '断开';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-danger');
                input.disabled = false;
                sendBtn.disabled = false;
                if (emptyState) emptyState.style.display = 'none';
            } else {
                badge.classList.remove('connected');
                text.textContent = '未连接';
                btn.textContent = '连接';
                btn.classList.remove('btn-danger');
                btn.classList.add('btn-primary');
                input.disabled = true;
                sendBtn.disabled = true;
            }

            if (port) document.getElementById('portInfo').textContent = port;
            if (baudRate) document.getElementById('baudInfo').textContent = baudRate;
        }

        async function refreshPorts() {
            try {
                const res = await fetch('/api/ports');
                const ports = await res.json();
                const select = document.getElementById('portSelect');
                select.innerHTML = '<option value="">选择串口</option>';
                ports.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.path;
                    opt.textContent = p.path + (p.manufacturer ? ' (' + p.manufacturer + ')' : '');
                    select.appendChild(opt);
                });
            } catch (e) {
                console.error('Failed to refresh ports:', e);
            }
        }

        async function toggleConnect() {
            const btn = document.getElementById('connectBtn');
            if (btn.textContent === '连接') {
                const port = document.getElementById('portSelect').value;
                const baud = document.getElementById('baudSelect').value;
                if (!port) { alert('请选择串口'); return; }
                await fetch('/api/connect?port=' + port + '&baud=' + baud);
            } else {
                await fetch('/api/disconnect');
            }
        }

        async function sendData() {
            const input = document.getElementById('sendInput');
            const data = input.value;
            if (!data) return;

            const isHex = document.getElementById('hexMode').checked;
            const url = '/api/send?data=' + encodeURIComponent(data) + (isHex ? '&hex=1' : '');

            try {
                await fetch(url);
                addChatMessage('user', data);
                input.value = '';
            } catch (e) {
                console.error('Send failed:', e);
            }
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') sendData();
        }

        function addLogLine(data) {
            const scroll = document.getElementById('consoleScroll');
            const emptyState = document.getElementById('emptyState');
            if (emptyState) emptyState.style.display = 'none';

            const entry = document.createElement('div');
            entry.className = 'log-entry';

            const time = new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
            const isSent = data.source === 'user';

            if (data.type === 'error') {
                entry.classList.add('error');
                entry.innerHTML = '<span class="time">' + time + '</span><span class="label label-error">Error</span>' + escapeHtml(data.message);
            } else if (isSent) {
                entry.classList.add('sent');
                entry.innerHTML = '<span class="time">' + time + '</span><span class="label label-sent">Sent</span>' + escapeHtml(data.message);
            } else {
                entry.classList.add('received');
                entry.innerHTML = '<span class="time">' + time + '</span><span class="label label-device">Device</span>' + escapeHtml(data.message);
            }

            scroll.appendChild(entry);

            lineCount++;
            byteCount += (data.message || '').length;
            document.getElementById('lineCount').textContent = lineCount;
            document.getElementById('byteCount').textContent = byteCount;

            if (document.getElementById('autoScroll').checked) {
                scroll.scrollTop = scroll.scrollHeight;
            }

            while (scroll.children.length > 5000) {
                scroll.removeChild(scroll.firstChild);
            }
        }

        function addChatMessage(role, content) {
            console.log('[DEBUG addChatMessage] role:', role, 'content:', JSON.stringify(content));
            const scroll = document.getElementById('chatScroll');
            if (!scroll) {
                console.error('[DEBUG addChatMessage] chatScroll not found!');
                return;
            }

            const msg = document.createElement('div');
            msg.className = 'message ' + role;
            if (!content) {
                console.error('[DEBUG addChatMessage] content is undefined or empty!');
                content = '(empty message)';
            }

            const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            msg.innerHTML = '<div>' + escapeHtml(content) + '</div><div class="message-time">' + time + '</div>';

            scroll.appendChild(msg);
            scroll.scrollTop = scroll.scrollHeight;

            // Save to localStorage for persistence
            const history = JSON.parse(localStorage.getItem('aiChatHistory') || '[]');
            history.push({ role, content, time });
            if (history.length > 100) history.shift();
            localStorage.setItem('aiChatHistory', JSON.stringify(history));
        }

        function loadChatHistory() {
            const scroll = document.getElementById('chatScroll');
            // Fetch from server-side history (file persisted)
            fetch('/api/chat/history')
                .then(res => res.json())
                .then(history => {
                    history.forEach(item => {
                        const msg = document.createElement('div');
                        msg.className = 'message ' + (item.role || 'user');
                        const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';
                        msg.innerHTML = '<div>' + escapeHtml(item.content) + '</div><div class="message-time">' + time + '</div>';
                        scroll.appendChild(msg);
                    });
                    if (history.length > 0) scroll.scrollTop = scroll.scrollHeight;
                })
                .catch(err => {
                    // Fallback to localStorage
                    const history = JSON.parse(localStorage.getItem('aiChatHistory') || '[]');
                    history.forEach(item => {
                        const msg = document.createElement('div');
                        msg.className = 'message ' + item.role;
                        msg.innerHTML = '<div>' + escapeHtml(item.content) + '</div><div class="message-time">' + item.time + '</div>';
                        scroll.appendChild(msg);
                    });
                    if (history.length > 0) scroll.scrollTop = scroll.scrollHeight;
                });
        }

function clearChatHistory() {
            localStorage.removeItem('aiChatHistory');
        }

        function reloadChatHistory(history) {
            const scroll = document.getElementById('chatScroll');
            // Clear current display (keep API card at top)
            const apiCard = scroll.querySelector('.api-card');
            scroll.innerHTML = '';
            if (apiCard) scroll.appendChild(apiCard);

            // Render all messages from history
            history.forEach(item => {
                const msg = document.createElement('div');
                msg.className = 'message ' + (item.role || 'user');
                const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';
                msg.innerHTML = '<div>' + escapeHtml(item.content) + '</div><div class="message-time">' + time + '</div>';
                scroll.appendChild(msg);
            });
            scroll.scrollTop = scroll.scrollHeight;
        }

        function clearChatHistory() {
            localStorage.removeItem('aiChatHistory');
        }

        function clearConsole() {
            const scroll = document.getElementById('consoleScroll');
            scroll.innerHTML = '<div class="empty-state" id="emptyState"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 8v4"/><circle cx="12" cy="16" r="1"/></svg><div class="empty-title">No Device Connected</div><div class="empty-desc">Select a serial port and click Connect</div></div>';
            lineCount = 0;
            byteCount = 0;
            document.getElementById('lineCount').textContent = '0';
            document.getElementById('byteCount').textContent = '0';
        }

        function clearChat() {
            const scroll = document.getElementById('chatScroll');
            scroll.innerHTML = '<div class="api-card"><div class="api-card-title">对话已清空</div></div>';
        }

        function toggleHex() {
            const toggle = document.getElementById('hexToggle');
            const checkbox = document.getElementById('hexMode');
            checkbox.checked = !checkbox.checked;
            toggle.classList.toggle('active', checkbox.checked);
        }

        function toggleAutoScroll() {
            const toggle = document.getElementById('autoScrollToggle');
            const checkbox = document.getElementById('autoScroll');
            checkbox.checked = !checkbox.checked;
            toggle.classList.toggle('active', checkbox.checked);
        }

        function toggleTweaks() {
            const panel = document.getElementById('tweaksPanel');
            panel.classList.toggle('visible');
        }

        function updateFontSize(size) {
            document.querySelectorAll('.log-entry').forEach(el => {
                el.style.fontSize = size + 'px';
            });
        }

        function updatePanelWidth(width) {
            document.querySelector('.ai-panel').style.width = width + 'px';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Time update
        setInterval(() => {
            document.getElementById('timeDisplay').textContent = new Date().toLocaleTimeString();
        }, 1000);

        // Initialize
        refreshPorts();
        loadChatHistory();
        connectWS();

        // Close tweaks panel when clicking outside
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('tweaksPanel');
            const toggle = document.querySelector('.tweaks-toggle');
            if (!panel.contains(e.target) && !toggle.contains(e.target)) {
                panel.classList.remove('visible');
            }
        });
    </script>
</body>
</html>`;
}

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\nError: Port ${DEFAULT_WEB_PORT} is already in use.`);
        console.error(`Please close the other application or use: node serial_monitor_ai.js --port 8081\n`);
    } else {
        console.error(`\nServer error: ${err.message}`);
    }
    process.exit(1);
});

// WebSocket server
const wss = new WebSocketServer({ server: server });

// Log all WebSocketServer errors
wss.on('error', (err) => {
    console.error('[WSS] Server error:', err);
});

wss.on('connection', (ws, req) => {
    clients.add(ws);
    ws._closing = false;
    console.log('[DEBUG WS connection] Added client, total:', clients.size, 'from:', req.socket.remoteAddress);

    const originalSend = ws.send.bind(ws);
    ws.send = function(...args) {
        try {
            console.log('[DEBUG WS send]', args[0] ? JSON.parse(args[0]).type : 'unknown');
        } catch {}
        return originalSend(...args);
    };

    ws.send(JSON.stringify({
        type: 'status',
        status: connected ? 'connected' : 'disconnected',
        port: currentPort,
        baudRate: currentBaud
    }));

    ws.on('close', (code, reason) => {
        ws._closing = true;
        console.log('[DEBUG WS close] code:', code, 'reason:', reason?.toString(), '| current clients.size BEFORE del:', clients.size);
        setTimeout(() => {
            if (clients.has(ws)) {
                clients.delete(ws);
                console.log('[DEBUG WS close] Client removed after delay, total:', clients.size);
            }
        }, 500);
    });

    ws.on('error', (err) => {
        console.error('[DEBUG WS error]', err.message);
        ws._closing = true;
        setTimeout(() => clients.delete(ws), 500);
    });
});

async function getAvailablePorts() {
    try {
        const ports = await SerialPort.list();
        return ports.map(p => p.path);
    } catch {
        return [];
    }
}

async function startServer() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║   STM32 AI Serial Monitor                      ║');
    console.log('╠════════════════════════════════════════════════╣');

    const availablePorts = await getAvailablePorts();
    if (availablePorts.length > 0) {
        console.log('║   Available Ports:');
        availablePorts.forEach(p => console.log('║     - ' + p));
    } else {
        console.log('║   No COM ports detected');
    }

    console.log('╠════════════════════════════════════════════════╣');
    console.log('║   Web UI: http://localhost:' + DEFAULT_WEB_PORT);
    console.log('║   Serial: ' + DEFAULT_PORT + ' @ ' + DEFAULT_BAUD);
    console.log('╠════════════════════════════════════════════════╣');
    console.log('║   API Endpoints:');
    console.log('║     GET  /api/ports');
    console.log('║     GET  /api/connect?port=X&baud=Y');
    console.log('║     GET  /api/send?data=hello');
    console.log('║     WS   /ws');
    console.log('╚════════════════════════════════════════════════╝\n');

    server.listen(DEFAULT_WEB_PORT, () => {
        try {
            require('child_process').exec('start http://localhost:' + DEFAULT_WEB_PORT);
        } catch (e) {}

        console.log('Connecting to ' + DEFAULT_PORT + '...');
        openSerialPort(DEFAULT_PORT, DEFAULT_BAUD);
    });
}

startServer();

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (chatHistoryFileWatcher) clearInterval(chatHistoryFileWatcher);
    if (serialPort) serialPort.close();
    process.exit();
});
