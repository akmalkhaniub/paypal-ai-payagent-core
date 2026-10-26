import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EscrowPolicyEngine } from './policy_engine.js';
import { PayPalGateway } from './paypal_gateway.js';
import { PayAgentMCPServer } from './mcp_server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3004);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const policyEngine = new EscrowPolicyEngine();
const gateway = new PayPalGateway();
const mcpServer = new PayAgentMCPServer(policyEngine, gateway);

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Health check
    if (url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'ok',
        app: 'payagent-core',
        mode: gateway.isLive() ? 'LIVE_PAYPAL' : 'SIMULATED',
        escrowHoldCount: gateway.listOrders().length
      }));
    }

    // List Orders
    if (url === '/api/orders' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ orders: gateway.listOrders() }));
    }

    // Direct MCP JSON-RPC Endpoint
    if (url === '/api/mcp' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const response = await mcpServer.processJsonRpc(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Convenience Demo: Run Autonomous Purchase Simulation
    if (url === '/api/simulate-purchase' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const amount = Number(payload.amountUSD || 42.50);
          const merchantId = payload.merchantId || 'merch_aws';
          const merchantName = payload.merchantName || 'Amazon Web Services';
          const itemDescription = payload.itemDescription || 'Cloud GPU Compute Units';
          const humanToken = payload.humanApprovalToken;

          const toolResult = await mcpServer.handleCall('request_escrow_checkout', {
            requestId: 'sim-' + Date.now().toString(36),
            merchantId,
            merchantName,
            itemDescription,
            amountUSD: amount,
            buyerAgentId: 'buyer-agent-ops',
            userBudgetRemainingUSD: 500.0,
            humanApprovalToken: humanToken
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(toolResult));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Convenience Demo: Release Escrow
    if (url === '/api/release-escrow' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const toolResult = await mcpServer.handleCall('verify_delivery_receipt', {
            orderId: payload.orderId,
            deliveryProofHash: payload.deliveryProofHash || 'sha256-verified-receipt-' + Date.now()
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(toolResult));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Static Web Dashboard
    const requestedFile = url === '/' ? 'index.html' : url.substring(1);
    const filePath = path.join(PUBLIC_DIR, requestedFile);

    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
      res.writeHead(200, { 'Content-Type': mime });
      return res.end(fs.readFileSync(filePath));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint or static asset not found' }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`\n💳 PayAgent Core Operator Console listening on http://localhost:${PORT}`);
  });
}
