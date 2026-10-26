# 💳 PayAgent Core — Autonomous Agentic Commerce & EscrowGuard Protocol

[![TypeScript: strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Event: PayPal AI Hackathon](https://img.shields.io/badge/Devpost-PayPal%20AI%20Hackathon-00457c.svg)](https://devpost.com)
[![Model Context Protocol](https://img.shields.io/badge/MCP-2026--07--28-green.svg)](https://modelcontextprotocol.io)

> **Built for the [PayPal AI Hackathon 2026 (Devpost)](https://devpost.com)**  
> *Timeline: October 1 – November 12, 2026 • Prize Pool: $67,500*

PayAgent Core is an autonomous Agent-to-Agent (A2A) commerce execution and escrow governance protocol. It empowers AI buyer agents to discover, negotiate, and purchase goods or services via PayPal APIs while enforcing cryptographic spend guardrails, cryptographic budget caps, dynamic invoice verification, and Human-in-the-Loop (HITL) approval for high-value transactions.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    User["👤 Human Principal\n(Sets Budget & Guardrails)"] --> BuyerAgent["🤖 Autonomous Buyer Agent\n(Model Context Protocol / MCP)"]

    subgraph Escrow_Guard ["🛡️ EscrowGuard Governance Engine"]
        BuyerAgent -->|"Invoice Negotiation Request"| PolicyEngine["⚖️ Policy & Spending Gate\n(Budget Limit, Merchant Allowlist)"]
        
        PolicyEngine -->|"< $100 & Allowlisted"| AutoApprove["⚡ Cryptographic Fast-Path"]
        PolicyEngine -->|"> $100 or Anomalous"| HITL["🛑 Human-in-the-Loop Gate\n(Interactive Approval Token)"]
        
        AutoApprove --> PayPalGateway["💳 PayPal Orders v2 API\n(Capture / Vault / Escrow Hold)"]
        HITL -->|"User Signs Approval"| PayPalGateway
    end

    PayPalGateway --> SellerAgent["🏪 Merchant Seller Agent\n(Fulfills Order / Delivery Proof)"]
    SellerAgent --> DeliveryVerifier["📦 Proof-of-Fulfillment Verifier"]
    DeliveryVerifier --> ReleaseEscrow["💰 Escrow Payout Released"]

    classDef paypal fill:#003087,stroke:#0079c1,stroke-width:2px,color:#fff;
    classDef guard fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#fff;
    
    class PayPalGateway,ReleaseEscrow paypal;
    class PolicyEngine,AutoApprove,HITL,DeliveryVerifier guard;
```

---

## 🚀 Key Innovations
1. **Agent-to-Agent (A2A) Dynamic Negotiation**: Autonomous buyer and seller agents negotiate volume discounts and item specs over standard MCP protocols.
2. **Deterministic Spending Caps**: AI models propose purchases, but deterministic code cryptographically enforces policy gates before a single dollar can move.
3. **Escrow Hold & Proof-of-Delivery Verification**: Funds are captured into escrow and only settled once the buyer agent cryptographically verifies the fulfillment receipt.
