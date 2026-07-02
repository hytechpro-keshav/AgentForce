#!/usr/bin/env bash
# Phase C — Case Approval Account Manager summary: layout + approver perm set.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ORG="${1:-AgentForce}"
echo "Deploying case-approval-summary package to org: ${ORG}"
sf project deploy start \
  --target-org "$ORG" \
  --manifest manifest/case-approval-summary-package.xml \
  --wait 30
