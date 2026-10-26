/**
 * Verification Test Suite for PayAgent Core
 *
 * Validates deterministic policy enforcement, MCP JSON-RPC protocol compliance,
 * escrow creation, human-in-the-loop gating, and delivery receipt verification.
 */

import { EscrowPolicyEngine } from '../src/policy_engine.js';
import { PayPalGateway } from '../src/paypal_gateway.js';
import { PayAgentMCPServer } from '../src/mcp_server.js';

let assertions = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exit(1);
  }
  assertions++;
  console.log(`  ✓ ${message}`);
}

async function runTestSuite() {
  console.log('🧪 Starting PayAgent Core & EscrowGuard Test Suite...\n');

  // Test 1: Policy Engine Deterministic Caps
  console.log('Test Group 1: Deterministic Policy Engine Evaluation');
  const policyEngine = new EscrowPolicyEngine(100.0, new Set(['merch_aws', 'merch_github']));

  // 1a: Fast-path auto approval
  const autoApproveRes = policyEngine.evaluate({
    requestId: 'req-001',
    merchantId: 'merch_aws',
    merchantName: 'Amazon Web Services',
    itemDescription: 't4g.nano reserved instance',
    amountUSD: 14.50,
    buyerAgentId: 'buyer-agent-infra',
    userBudgetRemainingUSD: 500.00
  });
  assert(autoApproveRes.decision === 'AUTO_APPROVED', 'Auto-approves allowlisted merchant under cap');
  assert(autoApproveRes.escrowHoldRequired === true, 'Escrow hold is flagged as required');

  // 1b: Requires Human Approval (Over Autonomous Cap)
  const hitlAmountRes = policyEngine.evaluate({
    requestId: 'req-002',
    merchantId: 'merch_aws',
    merchantName: 'Amazon Web Services',
    itemDescription: 'p5e.48xlarge GPU node 1hr',
    amountUSD: 312.00,
    buyerAgentId: 'buyer-agent-infra',
    userBudgetRemainingUSD: 1000.00
  });
  assert(hitlAmountRes.decision === 'REQUIRES_HUMAN_APPROVAL', 'Triggers HITL gate when amount > $100 limit');
  assert(Boolean(hitlAmountRes.approvalToken), 'Generates an interactive HITL approval token');

  // 1c: Requires Human Approval (Unrecognized Merchant)
  const hitlMerchantRes = policyEngine.evaluate({
    requestId: 'req-003',
    merchantId: 'merch_unknown_seed',
    merchantName: 'Unknown AI Provider',
    itemDescription: 'API credits',
    amountUSD: 25.00,
    buyerAgentId: 'buyer-agent-infra',
    userBudgetRemainingUSD: 100.00
  });
  assert(hitlMerchantRes.decision === 'REQUIRES_HUMAN_APPROVAL', 'Triggers HITL gate for unlisted merchant');

  // 1d: Rejected Over Budget
  const overBudgetRes = policyEngine.evaluate({
    requestId: 'req-004',
    merchantId: 'merch_aws',
    merchantName: 'Amazon Web Services',
    itemDescription: 'Cluster renewal',
    amountUSD: 650.00,
    buyerAgentId: 'buyer-agent-infra',
    userBudgetRemainingUSD: 500.00
  });
  assert(overBudgetRes.decision === 'REJECTED_OVER_BUDGET', 'Rejects purchase request exceeding budget limit');

  // Test Group 2: PayPal Gateway Lifecycle
  console.log('\nTest Group 2: PayPal Gateway & Escrow Lifecycle');
  const gateway = new PayPalGateway();

  const escrowOrder = await gateway.createEscrowOrder({
    amountUSD: 45.00,
    itemDescription: 'Dedicated proxy bandwidth',
    merchantId: 'merch_aws',
    referenceId: 'ref-tx-999'
  });
  assert(escrowOrder.status === 'APPROVED', 'Order status initialized to APPROVED');
  assert(escrowOrder.escrowStatus === 'HELD_IN_ESCROW', 'Funds successfully held in escrow');

  // Release escrow with delivery proof
  const releasedOrder = await gateway.releaseEscrow(escrowOrder.id, 'sha256-fulfillment-proof-98127391');
  assert(releasedOrder.escrowStatus === 'RELEASED_TO_MERCHANT', 'Escrow status changes to RELEASED_TO_MERCHANT');
  assert(releasedOrder.status === 'COMPLETED', 'PayPal order is marked COMPLETED');

  // Test Group 3: MCP Protocol Server
  console.log('\nTest Group 3: Model Context Protocol (MCP) Server Compliance');
  const mcpServer = new PayAgentMCPServer(policyEngine, gateway);

  // 3a: tools/list
  const toolsListResponse = await mcpServer.processJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  });
  const tools = toolsListResponse.result?.tools;
  assert(Array.isArray(tools), 'MCP tools/list returns an array of tools');
  assert(tools.length === 4, 'MCP tools/list exposes exactly 4 commerce tools');

  // 3b: tools/call negotiate_price
  const negResponse = await mcpServer.processJsonRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'negotiate_price',
      arguments: {
        merchantId: 'merch_aws',
        itemDescription: 'API credits',
        quantity: 12,
        targetPriceUSD: 10.0
      }
    }
  });
  const negResult = JSON.parse(negResponse.result.content[0].text);
  assert(negResult.status === 'OFFER_ACCEPTED', 'Price negotiation succeeds with volume tier');
  assert(negResult.savingsUSD > 0, 'Volume tier captures calculated savings');

  // 3c: tools/call request_escrow_checkout (HITL blocked when token absent)
  const hitlCheckoutResponse = await mcpServer.processJsonRpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'request_escrow_checkout',
      arguments: {
        requestId: 'req-hitl-01',
        merchantId: 'merch_aws',
        merchantName: 'Amazon Web Services',
        itemDescription: 'Big data training node',
        amountUSD: 250.00,
        buyerAgentId: 'agent-training-01',
        userBudgetRemainingUSD: 500.00
      }
    }
  });
  const hitlCheckoutResult = JSON.parse(hitlCheckoutResponse.result.content[0].text);
  assert(hitlCheckoutResult.status === 'BLOCKED_PENDING_HITL', 'Escrow blocked until human token provided');

  // 3d: tools/call request_escrow_checkout (HITL approved when token provided)
  const hitlCheckoutApprovedResponse = await mcpServer.processJsonRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'request_escrow_checkout',
      arguments: {
        requestId: 'req-hitl-02',
        merchantId: 'merch_aws',
        merchantName: 'Amazon Web Services',
        itemDescription: 'Big data training node',
        amountUSD: 250.00,
        buyerAgentId: 'agent-training-01',
        userBudgetRemainingUSD: 500.00,
        humanApprovalToken: hitlCheckoutResult.approvalTokenRequired
      }
    }
  });
  const hitlApprovedResult = JSON.parse(hitlCheckoutApprovedResponse.result.content[0].text);
  assert(hitlApprovedResult.status === 'ESCROW_CREATED', 'Escrow order created upon token provision');
  assert(hitlApprovedResult.order.escrowStatus === 'HELD_IN_ESCROW', 'Order verified held in escrow');

  console.log(`\n🎉 All ${assertions} verification checks passed successfully!`);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
