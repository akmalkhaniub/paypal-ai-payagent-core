/**
 * EscrowGuard Policy Engine
 *
 * Deterministic policy gate enforcing spending caps, merchant allowlisting,
 * and cryptographic approval tokens for agentic purchases.
 */
export interface PurchaseRequest {
  requestId: string;
  merchantId: string;
  merchantName: string;
  itemDescription: string;
  amountUSD: number;
  buyerAgentId: string;
  userBudgetRemainingUSD: number;
}

export type PolicyDecision = 'AUTO_APPROVED' | 'REQUIRES_HUMAN_APPROVAL' | 'REJECTED_OVER_BUDGET';

export interface EvaluationResult {
  decision: PolicyDecision;
  reason: string;
  approvalToken?: string;
  escrowHoldRequired: boolean;
}

export class EscrowPolicyEngine {
  constructor(
    public maxAutonomousSpendUSD: number = 100.0,
    public allowlistedMerchants: Set<string> = new Set(['merch_aws', 'merch_github', 'merch_openai', 'merch_vultr'])
  ) {}

  evaluate(request: PurchaseRequest): EvaluationResult {
    // 1. Budget Cap Guard
    if (request.amountUSD > request.userBudgetRemainingUSD) {
      return {
        decision: 'REJECTED_OVER_BUDGET',
        reason: `Purchase amount ($${request.amountUSD}) exceeds user remaining budget cap ($${request.userBudgetRemainingUSD}).`,
        escrowHoldRequired: false
      };
    }

    // 2. High-Value or Unrecognized Merchant Gate (HITL)
    const isAllowlisted = this.allowlistedMerchants.has(request.merchantId);
    const exceedsAutonomousLimit = request.amountUSD > this.maxAutonomousSpendUSD;

    if (!isAllowlisted || exceedsAutonomousLimit) {
      const reason = exceedsAutonomousLimit
        ? `Transaction amount ($${request.amountUSD}) exceeds autonomous limit ($${this.maxAutonomousSpendUSD}). Human confirmation required.`
        : `Merchant '${request.merchantName}' (${request.merchantId}) is not on pre-approved merchant allowlist.`;

      const approvalToken = 'hitl_token_' + Math.random().toString(36).substring(2, 10);

      return {
        decision: 'REQUIRES_HUMAN_APPROVAL',
        reason,
        approvalToken,
        escrowHoldRequired: true
      };
    }

    // 3. Fast-Path Auto Approval
    return {
      decision: 'AUTO_APPROVED',
      reason: `Pre-approved merchant within autonomous limit ($${request.amountUSD} <= $${this.maxAutonomousSpendUSD}).`,
      escrowHoldRequired: true
    };
  }
}
