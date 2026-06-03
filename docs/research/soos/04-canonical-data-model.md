# Canonical Data Model

## Purpose

This document defines the canonical service operations data model for SOOS. The
model should guide DTOs, Salesforce object mapping, RAG metadata, graph state,
eval fixtures, and reporting across outsourced multi-client manufacturer
support.

## Modeling Rule

Do not assume every entity already exists in the Salesforce org. First map each
entity to an authoritative source system, then create DTOs and actions around
that source of truth.

## Core Entities

| Entity                | Purpose                                                                    | Key relationships                                                                                |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Service Provider      | Aptivance operating unit that owns the shared Salesforce support process.  | Supports Clients, teams, SLAs, queues, and operational policies.                                 |
| Client / Manufacturer | Company X or another manufacturer whose customers Aptivance supports.      | Owns contracts, product catalog, SLA policies, source systems, and client-specific rules.        |
| Client Contract       | Commercial and service agreement for the client.                           | Links Client, SLA Policy, entitlement rules, priority tier, approval thresholds, parts rules.    |
| Ingress Channel       | ServiceNow, email, AI chat, assisted support, or another approved channel. | Links Client, External Ticket, Case, source-system auth, and provenance.                         |
| External Ticket       | Client-owned ticket or message before/after Salesforce normalization.      | Links source system, external ID, Case, retries, dedupe key, and audit trail.                    |
| End Customer          | Buyer, account, or service recipient.                                      | Owns Contacts, Assets, Cases, Warranties, Service Visits where known.                            |
| Product               | Device model, series, capacity, and specification.                         | Links to Assets, Spare Parts, Failure Codes, manuals, Service Bulletins, Manufacturing Batches.  |
| Asset / Device Unit   | Specific installed or owned unit at customer site.                         | Belongs to End Customer and Product; links to Warranty, Cases, Work Orders, Service Visits.      |
| Warranty              | Coverage terms for product or asset.                                       | Links to Customer, Asset, Claim, Approval Request, Service Bulletin exceptions.                  |
| Case                  | Customer complaint, client ticket, email issue, or service request.        | Links Client, End Customer, External Ticket, Asset, Work Order, Warranty, Failure Code, sources. |
| Work Order            | Field-service task created to resolve a Case.                              | Links to Case, Service Appointment, Technician, parts, repair result.                            |
| Service Appointment   | Scheduled visit for a Work Order.                                          | Links to Technician, time window, location, SLA, dispatch status.                                |
| Technician            | Field-service resource.                                                    | Links to skills, territory, availability, appointments, performance metrics.                     |
| Inventory Item        | Stock state for a part at a location.                                      | Links to Spare Part, Warehouse, reservation, transfer, availability.                             |
| Spare Part            | Replaceable AC component.                                                  | Links to Product, repair guides, Work Orders, warranty costs, inventory.                         |
| Warehouse             | Stock location or service center.                                          | Holds Inventory Items; serves territories and technicians.                                       |
| Approval Request      | Governed approval decision.                                                | Links to Case, Work Order, Warranty, estimated cost, approver, outcome.                          |
| Failure Code          | Standardized failure classification.                                       | Links to Product, Case, Work Order, Service Visit, Quality Investigation.                        |
| Service Visit         | Actual field visit result.                                                 | Links to Work Order, Technician, parts used, failure code, resolution.                           |
| Quality Investigation | Product or manufacturing quality review.                                   | Links to failure clusters, Product, Manufacturing Batch, Supplier, Service Bulletin.             |
| Manufacturing Batch   | Production batch or serial range.                                          | Links to Product, Assets, Supplier lots, quality issues.                                         |
| Supplier              | Vendor for parts or components.                                            | Links to Spare Parts, Manufacturing Batches, quality signals.                                    |
| Knowledge Article     | Approved service knowledge.                                                | Links to Products, symptoms, customer-safe or internal access roles.                             |
| Service Bulletin      | Official guidance for known issue, safety notice, repair, or exception.    | Links to Product, serial range, Failure Code, Warranty, repair guidance.                         |

## Source Of Truth Decisions

| Data area                        | Decision needed                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Client and contract              | Salesforce Account/Contract, custom client-policy objects, CPQ/ERP, or external master.       |
| External tickets and channels    | ServiceNow, email platform, chat system, integration middleware, or Salesforce-native intake. |
| Customer and contact             | Salesforce Account, Contact, Person Account, or external customer master.                     |
| Installed or owned device units  | Salesforce Asset, custom object, ERP asset registry, or warranty system.                      |
| Warranty                         | Salesforce entitlement/warranty objects, ERP warranty module, or custom policy system.        |
| Work orders and appointments     | Salesforce Field Service, Service Cloud objects, or custom scheduling integration.            |
| Technician skills and calendar   | Salesforce Field Service resource model or workforce management system.                       |
| Inventory and warehouses         | ERP, inventory system, Salesforce object model, or warehouse management system.               |
| Manufacturing batch and supplier | ERP, manufacturing execution system, product lifecycle system, or quality system.             |
| Knowledge                        | Salesforce Knowledge, external document store, or approved RAG corpus.                        |

## Initial DTO Families

Create DTOs under `apps/ai-api/src/agents/dto` until contracts need to be shared
across apps.

| DTO family                | Purpose                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `CaseIngressContext`      | Source channel, source system, external ticket ID, dedupe key, raw-to-safe summary.     |
| `ClientPolicyContext`     | Client, contract, tier, SLA, entitlement, approval thresholds, escalation, parts rules. |
| `ServiceCaseContext`      | Case, client, customer, asset, symptoms, error code, priority, SLA, source channel.     |
| `AssetContext`            | Product model, serial range, installation age, warranty link, repair history summary.   |
| `WarrantyContext`         | Coverage status, exclusions, claim history, cost estimate, policy flags.                |
| `TechnicianCandidate`     | Skill, certification, distance, availability, workload, performance summary.            |
| `InventoryAvailability`   | Spare part, warehouse, available quantity, reserved quantity, transfer time.            |
| `ApprovalDecisionContext` | Cost band, approval level, risk reason, approver role, audit summary.                   |
| `QualitySignalContext`    | Failure code, product, batch, region, repeat rate, parts used, confidence.              |
| `ServiceKpiContext`       | Region, product, technician, warehouse, warranty, SLA, quality metrics.                 |

## RAG Metadata Model

Every indexed AC service source should carry enough metadata for hybrid search,
role filtering, citation, version control, and debugging.

| Metadata field                                       | Purpose                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `tenantId` and `namespace`                           | Tenant isolation and corpus selection.                           |
| `clientId`, `clientTier`, `contractId`               | Client-specific policy, SLA, and access filtering.               |
| `sourceSystem`, `ingressChannel`, `externalTicketId` | Ticket provenance and operational debugging.                     |
| `sourceId`, `sourceType`, `title`                    | Citation and audit reference.                                    |
| `parentDocumentId` and `sectionId`                   | Hierarchical retrieval from chunk to section or document.        |
| `productModel`, `productSeries`, `assetClass`        | Product-specific filtering and reranking.                        |
| `errorCode`, `failureCode`, `partNumbers`            | Exact-match retrieval for AC service identifiers.                |
| `serialRange`, `manufacturingBatch`, `supplierLot`   | Quality and service-bulletin applicability.                      |
| `documentVersion`, `effectiveFrom`, `effectiveTo`    | Current versus stale source control.                             |
| `accessRoles` and `customerSafe`                     | Customer-safe versus internal-only filtering.                    |
| `language`                                           | Multilingual retrieval and answer routing.                       |
| `chunkStrategy`                                      | Debugging natural-boundary, table, section, or overlap chunking. |
| `ingestedAt`, `stale`, `deleted`                     | Ingestion audit and source lifecycle.                            |

## Graph State Boundary

Graph state should contain safe references and summaries:

- request ID
- tenant ID
- client ID
- client tier
- contract ID
- SLA policy ID
- entitlement ID
- ingress channel
- source system
- external ticket ID
- actor role
- safe record references
- symptom summary
- error codes
- retrieval IDs
- source IDs
- recommendation
- confidence
- required approval level
- execution proposal

Graph state should not contain raw customer prompts, secrets, full transcripts,
raw retrieved chunks, payment data, private keys, JWTs, or unnecessary PII.

## Data Model Conclusion

The canonical data model is the foundation for every SOOS agent. Build the
model and source-of-truth decisions before building technician assignment,
inventory, warranty, approval, or quality workflows.
