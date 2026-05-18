#!/usr/bin/env bash
set -euo pipefail

TARGET_ORG="${1:-${SF_TARGET_ORG:-certinia-phase8}}"

if ! command -v sf >/dev/null 2>&1; then
  echo "sf CLI is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

run_query() {
  local query="$1"
  sf data query --target-org "${TARGET_ORG}" --query "${query}" --json
}

echo "Phase 8 Certinia PSA discovery for org: ${TARGET_ORG}"
echo "Only aggregate metrics and record ids are printed. Project names, account names, notes, and comments are intentionally omitted."
echo

echo "Installed Certinia packages"
sf package installed list --target-org "${TARGET_ORG}" --json \
  | jq -r '.result[] | select(.SubscriberPackageNamespace=="pse" or .SubscriberPackageNamespace=="certinia") | [.SubscriberPackageNamespace,.SubscriberPackageName,.SubscriberPackageVersionNumber] | @tsv'
echo

echo "PSA object record counts"
for object_name in \
  pse__Proj__c \
  pse__Assignment__c \
  pse__Milestone__c \
  pse__Timecard_Header__c \
  pse__Timecard__c \
  pse__Project_Task__c \
  pse__Resource_Request__c \
  pse__Budget__c; do
  run_query "SELECT COUNT(Id) records FROM ${object_name}" \
    | jq -r --arg object_name "${object_name}" '.result.records[0] | [$object_name,.records] | @tsv'
done
echo

echo "Project status distribution"
run_query "SELECT pse__Project_Status__c status, COUNT(Id) records FROM pse__Proj__c GROUP BY pse__Project_Status__c" \
  | jq -r '.result.records[] | [.status,.records] | @tsv'
echo

echo "Healthy pilot candidates: Green projects (ids only)"
run_query "SELECT Id, pse__Project_Status__c, pse__Percent_Hours_Complete__c, pse__End_Date__c FROM pse__Proj__c WHERE pse__Project_Status__c = 'Green' ORDER BY LastModifiedDate DESC LIMIT 10" \
  | jq -r '.result.records[] | [.Id,.pse__Project_Status__c,.pse__Percent_Hours_Complete__c,.pse__End_Date__c] | @tsv'
echo

echo "Risk pilot candidates: Yellow or Red projects (ids only)"
run_query "SELECT Id, pse__Project_Status__c, pse__Percent_Hours_Complete__c, pse__End_Date__c FROM pse__Proj__c WHERE pse__Project_Status__c IN ('Yellow','Red') ORDER BY LastModifiedDate DESC LIMIT 10" \
  | jq -r '.result.records[] | [.Id,.pse__Project_Status__c,.pse__Percent_Hours_Complete__c,.pse__End_Date__c] | @tsv'
echo

echo "Projects with late milestones (project ids only)"
run_query "SELECT pse__Project__c projectId, COUNT(Id) lateMilestones FROM pse__Milestone__c WHERE psaws__Milestone_Is_Late__c = true GROUP BY pse__Project__c ORDER BY COUNT(Id) DESC LIMIT 10" \
  | jq -r '.result.records[] | [.projectId,.lateMilestones] | @tsv'
echo

echo "Projects with submitted or rejected timecard headers (project ids only)"
run_query "SELECT pse__Project__c projectId, pse__Status__c status, COUNT(Id) records FROM pse__Timecard_Header__c WHERE pse__Status__c IN ('Submitted','Rejected') GROUP BY pse__Project__c, pse__Status__c ORDER BY COUNT(Id) DESC LIMIT 20" \
  | jq -r '.result.records[] | [.projectId,.status,.records] | @tsv'
echo

echo "PSA-related report types already available"
sf org list metadata --metadata-type ReportType --target-org "${TARGET_ORG}" --json \
  | jq -r '.result[]? | select((.fullName|test("(?i)pse|psa|project|milestone|timecard|assignment|resource|budget"))) | [.fullName,.manageableState] | @tsv' \
  | sed -n '1,80p'