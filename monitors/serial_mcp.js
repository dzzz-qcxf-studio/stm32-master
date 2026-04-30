#!/usr/bin/env node
/**
 * STM32 Serial Monitor MCP Server
 *
 * This MCP server provides serial port tools for AI assistants like Claude Code.
 * It communicates with serial_monitor_ai.js via HTTP API to avoid port conflicts.
 *
 * Usage:
 *   node serial_mcp.js                    # Default: localhost:8080
 *   node serial_mcp.js --host localhost   # Custom host
 *   node serial_mcp.js --port 8080        # Custom port (must match serial_monitor_ai.js)
 */

const http = require('http');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8080;

let apiHost = DEFAULT_HOST;
let apiPort = DEFAULT_PORT;

// Command history for AI context
let commandHistory = [];
const MAX_HISTORY = 50;

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--host') {
            if (i + 1 < args.length) apiHost = args[++i];
        } else if (arg === '--port' || arg === '-p') {
            if (i + 1 < args.length) apiPort = parseInt(args[++i]) || DEFAULT_PORT;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
STM32 Serial Monitor MCP Server

Usage:
  node serial_mcp.js [options]

Options:
  --host <addr>     API host (default: localhost)
  -p, --port <port> API port (default: 8080, must match serial_monitor_ai.js)
  -h, --help        Show this help
            `);
            process.exit(0);
        }
        i++;
    }
}
parseArgs();

// HTTP API helpers
function apiRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: apiHost,
            port: apiPort,
            path: path,
            method: method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            timeout: 5000
        };

        console.log('[DEBUG apiRequest] START', method, path);
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('[DEBUG apiRequest] END', method, path, 'status:', res.statusCode);
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });

        req.on('error', (err) => {
            console.error('[DEBUG apiRequest] ERROR', method, path, err.message);
            reject(err);
        });
        req.on('timeout', () => {
            console.error('[DEBUG apiRequest] TIMEOUT', method, path);
            req.destroy();
            reject(new Error('API request timeout'));
        });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// Notify web UI about AI message (for display and persistence)
async function listPorts() {
    try {
        const ports = await apiRequest('/api/ports');
        return ports.map(p => ({
            path: p.path,
            manufacturer: p.manufacturer || 'Unknown',
            friendlyName: p.path
        }));
    } catch (err) {
        throw new Error(`Failed to list ports: ${err.message}`);
    }
}

async function getStatus() {
    try {
        return await apiRequest('/api/status');
    } catch (err) {
        throw new Error(`Failed to get status: ${err.message}`);
    }
}

async function getChatHistory() {
    try {
        return await apiRequest('/api/chat/history');
    } catch (err) {
        throw new Error(`Failed to get chat history: ${err.message}`);
    }
}

// MCP Server Tools
const tools = [
    {
        name: 'serial_list_ports',
        description: 'List all available serial (COM) ports on the system. Use this first to find available devices.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'serial_connect',
        description: 'Connect to a serial port via serial_monitor_ai.js API.',
        inputSchema: {
            type: 'object',
            properties: {
                port: {
                    type: 'string',
                    description: 'Serial port name (e.g., COM5, /dev/ttyUSB0)',
                },
                baudRate: {
                    type: 'number',
                    description: 'Baud rate (default: 115200)',
                    default: 115200,
                },
            },
            required: ['port'],
        },
    },
    {
        name: 'serial_disconnect',
        description: 'Disconnect from the current serial port.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'serial_send',
        description: 'Send a command to the connected device via API. AI should use this to interact with embedded devices.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Command string to send',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'serial_status',
        description: 'Get current connection status from serial_monitor_ai.js API.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'serial_history',
        description: 'Get chat history including sent commands and device responses.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];

// MCP Server implementation
const server = new Server(
    {
        name: 'stm32-serial-monitor',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'serial_list_ports': {
                const ports = await listPorts();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(ports, null, 2),
                        },
                    ],
                };
            }

            case 'serial_connect': {
                const { port, baudRate = 115200 } = args;
                const result = await apiRequest(`/api/connect?port=${encodeURIComponent(port)}&baud=${baudRate}`);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Connected to ${port} @ ${baudRate} via serial_monitor_ai.js`,
                        },
                    ],
                };
            }

            case 'serial_disconnect': {
                const result = await apiRequest('/api/disconnect');
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Disconnected from serial port',
                        },
                    ],
                };
            }

            case 'serial_send': {
                const { command } = args;
                console.log('[DEBUG MCP serial_send] calling /api/send with from=ai, command:', JSON.stringify(command));
                const result = await apiRequest(`/api/send?data=${encodeURIComponent(command)}&from=ai`);
                console.log('[DEBUG MCP serial_send] /api/send returned:', JSON.stringify(result));

                // Add to history
                commandHistory.push({
                    type: 'sent',
                    command: command,
                    timestamp: new Date().toISOString()
                });
                if (commandHistory.length > MAX_HISTORY) commandHistory.shift();

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Sent: ${command}`,
                        },
                    ],
                };
            }

            case 'serial_status': {
                const status = await getStatus();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(status, null, 2),
                        },
                    ],
                };
            }

            case 'serial_history': {
                const history = await getChatHistory();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(history, null, 2),
                        },
                    ],
                };
            }

            default:
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Unknown tool: ${name}`,
                        },
                    ],
                    isError: true,
                };
        }
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

async function main() {
    console.error('[MCP] STM32 Serial Monitor MCP Server starting...');
    console.error(`[MCP] API endpoint: http://${apiHost}:${apiPort}`);
    console.error('[MCP] Make sure serial_monitor_ai.js is running!');

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[MCP] Server ready. Waiting for requests...');
}

main().catch(console.error);
