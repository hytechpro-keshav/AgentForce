/** Latest orchestrator agent update on the case (agent narratives only). */
export interface IntakeCaseUpdateDto {
  body: string;
  createdDate?: string;
}

/** An open Case surfaced to the verified customer in the chat status update. */
export interface IntakeOpenCaseDto {
  caseNumber: string;
  subject?: string;
  status?: string;
  priority?: string;
  /** ISO timestamp the case was opened (Salesforce CreatedDate). */
  createdDate?: string;
  latestUpdate?: IntakeCaseUpdateDto;
}

/**
 * Live status of the verified customer's open Cases. Contact-scoped: only
 * cases raised by the verified contact are returned. `summary` is a
 * plain-English AI digest generated from ONLY these cases (grouped, no
 * internal jargon); when it is absent the client renders the deterministic
 * case list instead, so status can never be invented and never breaks.
 */
export interface IntakeCasesResponseDto {
  cases: IntakeOpenCaseDto[];
  summary?: string;
}
