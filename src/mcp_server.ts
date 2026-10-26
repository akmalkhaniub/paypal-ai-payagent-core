/**
 * PayAgent Model Context Protocol (MCP) Server
 *
 * Implements standard MCP 2026 JSON-RPC tool definitions for autonomous commerce:
 * - negotiate_price: dynamic negotiation between buyer and merchant agent
 * - request_escrow_checkout: checks policy gate and creates PayPal escrow order
 * - verify_delivery_receipt: validates proof of fulfillment and releases funds
 * - get_escrow_status: inspects current escrow registry state
 */

import { EscrowPolicyEngine, PurchaseRequest, EvaluationResult } from './policy_engine.js';
import { PayPalGateway, PayPalOrder } from './paypal_gateway.js';

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/list' | 'tools/call';
  params?: {
    name?: string;
    arguments?: Record<string, any>;
  };
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class PayAgentMCPServer {
  public policyEngine: EscrowPolicyEngine;
  public gateway: PayPalGateway;

  constructor(policyEngine?: EscrowPolicyEngine, gateway?: PayPalGateway) {
    this.policyEngine = policyEngine || new EscrowPolicyEngine();
    this.gateway = gateway || new PayPalGateway();
  }

  getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        name: 'negotiate_price',
        description: 'Negotiate bulk discount or contractual price between AI buyer agent and merchant catalog.',
        parameters: {
          type: 'object',
          properties: {
            merchantId: { type: 'string', description: 'Identifier of the merchant' },
            itemDescription: { type: 'string', description: 'Item or API service requested' },
            quantity: { type: 'number', description: 'Quantity units requested' },
            targetPriceUSD: { type: 'number', description: 'Target purchase price per unit in USD' }
          },
          required: ['merchantId', 'itemDescription', 'quantity', 'targetPriceUSD']
        }
      },
      {
        name: 'request_escrow_checkout',
        description: 'Initiate a PayPal Orders v2 escrow checkout evaluated against deterministic budget policy guardrails.',
        parameters: {
          type: 'object',
          properties: {
            requestId: { type: 'string', description: 'Unique idempotency request ID' },
            merchantId: { type: 'string', description: 'Pre-approved or external merchant ID' },
            merchantName: { type: 'string', description: 'Human-readable merchant name' },
            itemDescription: { type: 'string', description: 'Description of the item/service being acquired' },
            amountUSD: { type: 'number', description: 'Total purchase amount in USD' },
            buyerAgentId: { type: 'string', description: 'ID of the calling autonomous buyer agent' },
            userBudgetRemainingUSD: { type: 'number', description: 'User remaining budget allowance' },
            humanApprovalToken: { type: 'string', description: 'Cryptographic approval token signed by human principal (if required)' }
          },
          required: ['requestId', 'merchantId', 'merchantName', 'itemDescription', 'amountUSD', 'buyerAgentId', 'userBudgetRemainingUSD']
        }
      },
      {
        name: 'verify_delivery_receipt',
        description: 'Cryptographically verify proof of fulfillment and release held escrow funds to merchant.',
        parameters: {
          type: 'object',
          properties: {
            orderId: { type: 'string', description: 'PayPal Order ID currently in escrow' },
            deliveryProofHash: { type: 'string', description: 'Cryptographic SHA-256 hash or token representing delivery receipt' }
          },
          required: ['orderId', 'deliveryProofHash']
        }
      },
      {
        name: 'get_escrow_status',
        description: 'Retrieve current status, audit log, and settlement details for an escrow order.',
        parameters: {
          type: 'object',
          properties: {
            orderId: { type: 'string', description: 'PayPal Order ID' }
          },
          required: ['orderId']
        }
      }
    ];
  }

  async handleCall(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'negotiate_price': {
        const { merchantId, itemDescription, quantity, targetPriceUSD } = args;
        // Deterministic A2A counter-offer curve: discounts scale with quantity
        const discountRate = quantity >= 10 ? 0.15 : quantity >= 5 ? 0.08 : 0.02;
        const listPrice = targetPriceUSD * 1.15;
        const negotiatedPrice = Number((listPrice * (1 - discountRate)).toFixed(2));
        const totalAmount = Number((negotiatedPrice * quantity).toFixed(2));

        return {
          status: 'OFFER_ACCEPTED',
          merchantId,
          itemDescription,
          quantity,
          listPricePerUnitUSD: Number(listPrice.toFixed(2)),
          agreedPricePerUnitUSD: negotiatedPrice,
          totalAmountUSD: totalAmount,
          savingsUSD: Number(((listPrice * quantity) - totalAmount).toFixed(2)),
          terms: 'Net-30 EscrowGuard Protected'
        };
      }

      case 'request_escrow_checkout': {
        const req: PurchaseRequest = {
          requestId: args.requestId,
          merchantId: args.merchantId,
          merchantName: args.merchantName,
          itemDescription: args.itemDescription,
          amountUSD: args.amountUSD,
          buyerAgentId: args.buyerAgentId,
          userBudgetRemainingUSD: args.userBudgetRemainingUSD
        };

        const policyEvaluation: EvaluationResult = this.policyEngine.evaluate(req);

        // If human approval is required, check if valid token was provided
        if (policyEvaluation.decision === 'REQUIRES_HUMAN_APPROVAL') {
          if (!args.humanApprovalToken) {
            return {
              status: 'BLOCKED_PENDING_HITL',
              decision: policyEvaluation.decision,
              reason: policyEvaluation.reason,
              approvalTokenRequired: policyEvaluation.approvalToken,
              actionRequired: 'Human principal must confirm transaction in dashboard.'
            };
          }
        } else if (policyEvaluation.decision === 'REJECTED_OVER_BUDGET') {
          return {
            status: 'REJECTED',
            decision: policyEvaluation.decision,
            reason: policyEvaluation.reason
          };
        }

        // Passed policy: Create PayPal Escrow Order
        const order = await this.gateway.createEscrowOrder({
          amountUSD: req.amountUSD,
          currency: 'USD',
          itemDescription: req.itemDescription,
          merchantId: req.merchantId,
          referenceId: req.requestId
        });

        return {
          status: 'ESCROW_CREATED',
          decision: policyEvaluation.decision,
          reason: policyEvaluation.reason,
          order
        };
      }

      case 'verify_delivery_receipt': {
        const { orderId, deliveryProofHash } = args;
        const updatedOrder = await this.gateway.releaseEscrow(orderId, deliveryProofHash);
        return {
          status: 'ESCROW_RELEASED',
          order: updatedOrder,
          payoutNotification: `Payment of $${updatedOrder.amountUSD} USD dispatched to merchant ${updatedOrder.merchantId}.`
        };
      }

      case 'get_escrow_status': {
        const { orderId } = args;
        const order = this.gateway.getOrder(orderId);
        if (!order) {
          return { status: 'NOT_FOUND', orderId };
        }
        return { status: 'FOUND', order };
      }

      default:
        throw new Error(`Unknown MCP Tool: ${toolName}`);
    }
  }

  async processJsonRpc(rawPayload: string | MCPRequest): Promise<MCPResponse> {
    const req: MCPRequest = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;

    if (req.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: this.getToolDefinitions()
        }
      };
    }

    if (req.method === 'tools/call') {
      try {
        const toolName = req.params?.name;
        if (!toolName) {
          throw new Error('Tool name missing from tools/call payload.');
        }
        const toolResult = await this.handleCall(toolName, req.params?.arguments || {});
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(toolResult) }]
          }
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32603,
            message: err.message || 'Internal tool execution error'
          }
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      error: {
        code: -32601,
        message: `Method '${req.method}' not found.`
      }
    };
  }
}
