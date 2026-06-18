/**
 * Node 5 — Phase 5c gated scheduling executor.
 *
 * Creates the in-org `ServiceAppointment` (+ `AssignedResource`) for the
 * APPROVED, parts-ETA-gated plan the orchestrator produced in Node 5, and
 * links it to the Case. Salesforce owns the write here (called by the
 * NestJS orchestrator via AgentforceSchedulingRest, or by an Agentforce
 * genAiFunction / Flow after the Node 6 approval). The class is:
 *   - with sharing + FLS/CRUD checked (Schema.sObjectType.*),
 *   - degrade-safe (Database.insert(record, false), never throws), and
 *   - idempotent on Orchestrator_Workflow_Id__c so a repeated delivery of
 *     the same approved command never books a second appointment.
 *
 * The orchestrator NEVER writes Field Service records from the Node 5
 * read/plan slice; this runs ONLY in the post-approval write-back, and the
 * orchestrator re-reads parts + scheduling at write time (RC-5) before it
 * calls here. The technician is identified by its sanitized
 * `resourceReference` (e.g. "SR-A2"), which this class resolves back to the
 * ServiceResource by name prefix; an optional `resourceId` fast-path lets a
 * Flow caller that already holds the Salesforce id skip the lookup.
 */
public with sharing class AgentforceSchedulingService {
  private static final String STATUS_BOOKED = 'booked';
  private static final String STATUS_NONE = 'none';
  // Org FSL validation blocks insert in Scheduled/Dispatched — use None.
  private static final String APPT_STATUS_SCHEDULED = 'None';

  @InvocableMethod(
    label='Create Scheduling Appointment'
    description='Creates a ServiceAppointment + AssignedResource for an approved Node 5 plan. Idempotent on orchestrator workflow id.'
  )
  public static List<SchedulingResult> createAppointments(
    List<SchedulingRequest> requests
  ) {
    List<SchedulingResult> results = new List<SchedulingResult>();
    if (requests == null) {
      return results;
    }
    for (SchedulingRequest request : requests) {
      results.add(apply(request));
    }
    return results;
  }

  /**
   * Applies a single approved scheduling command. Never throws — any
   * validation / DML failure degrades the result and leaves the
   * appointment unbooked so the post-approval write-back can never fail
   * the run.
   */
  public static SchedulingResult apply(SchedulingRequest request) {
    SchedulingResult result = new SchedulingResult();
    result.applied = false;
    result.degraded = false;
    result.booked = false;
    result.idempotentSkip = false;
    result.appointmentStatus = STATUS_NONE;

    if (
      request == null ||
      String.isBlank(request.workflowId) ||
      String.isBlank(request.caseId) ||
      (String.isBlank(request.resourceReference) &&
      String.isBlank(request.resourceId)) ||
      String.isBlank(request.schedStart) ||
      String.isBlank(request.schedEnd)
    ) {
      result.degraded = true;
      result.message = 'Invalid scheduling command.';
      return result;
    }

    if (
      !Schema.sObjectType.ServiceAppointment.isCreateable() ||
      !Schema.sObjectType.AssignedResource.isCreateable()
    ) {
      result.degraded = true;
      result.message = 'Scheduling writes are not permitted in this context.';
      return result;
    }

    // ---- Idempotency: did this workflow already book an appointment? ----
    for (ServiceAppointment existing : [
      SELECT Id, AppointmentNumber, Status
      FROM ServiceAppointment
      WHERE Orchestrator_Workflow_Id__c = :request.workflowId
      LIMIT 1
    ]) {
      result.applied = true;
      result.booked = true;
      result.idempotentSkip = true;
      result.appointmentStatus = STATUS_BOOKED;
      result.appointmentId = existing.Id;
      result.appointmentReference = String.isNotBlank(
          existing.AppointmentNumber
        )
        ? existing.AppointmentNumber
        : String.valueOf(existing.Id);
      result.message = 'Existing appointment reused (idempotent).';
      return result;
    }

    Datetime schedStart = parseIso(request.schedStart);
    Datetime schedEnd = parseIso(request.schedEnd);
    if (schedStart == null || schedEnd == null || schedEnd <= schedStart) {
      result.degraded = true;
      result.message = 'Invalid appointment window.';
      return result;
    }

    // Validate the technician (resolved by the orchestrator) is real + active.
    Id resourceId = resolveResource(request);
    if (resourceId == null) {
      result.degraded = true;
      result.message = 'Technician not found or inactive.';
      return result;
    }

    Id territoryId = resolveTerritory(request.territoryReference);

    // ---- Insert the appointment ----
    ServiceAppointment appt = new ServiceAppointment();
    appt.ParentRecordId = request.caseId;
    appt.SchedStartTime = schedStart;
    appt.SchedEndTime = schedEnd;
    appt.EarliestStartTime = schedStart;
    appt.DueDate = schedEnd;
    appt.Subject = String.isBlank(request.subject)
      ? 'Orchestrated service visit'
      : request.subject;
    appt.Orchestrator_Workflow_Id__c = request.workflowId;
    if (territoryId != null) {
      appt.ServiceTerritoryId = territoryId;
    }
    // 'Scheduled' is the system-of-record marker for a booked visit. A
    // status/validation rejection degrades the write rather than throwing.
    appt.Status = APPT_STATUS_SCHEDULED;

    Database.SaveResult apptSave = Database.insert(appt, false);
    if (!apptSave.isSuccess()) {
      result.degraded = true;
      result.message =
        'Appointment create failed: ' +
        String.valueOf(apptSave.getErrors()[0].getStatusCode());
      return result;
    }

    result.applied = true;
    result.booked = true;
    result.appointmentStatus = STATUS_BOOKED;
    result.appointmentId = appt.Id;

    // ---- Link the technician ----
    AssignedResource assigned = new AssignedResource();
    assigned.ServiceAppointmentId = appt.Id;
    assigned.ServiceResourceId = resourceId;
    Database.SaveResult arSave = Database.insert(assigned, false);
    if (!arSave.isSuccess()) {
      // The appointment exists (booked) but the resource link failed —
      // surface it as degraded so the operator can reconcile the assignment.
      result.degraded = true;
      result.message =
        'Appointment booked but resource assignment failed: ' +
        String.valueOf(arSave.getErrors()[0].getStatusCode());
    } else {
      result.assignedResourceId = assigned.Id;
      result.message = 'Appointment booked.';
    }

    result.appointmentReference = appointmentNumberFor(appt.Id);
    return result;
  }

  /** AppointmentNumber (non-PII) for the surfaced reference; id fallback. */
  private static String appointmentNumberFor(Id appointmentId) {
    if (appointmentId == null) {
      return null;
    }
    for (ServiceAppointment row : [
      SELECT AppointmentNumber
      FROM ServiceAppointment
      WHERE Id = :appointmentId
      LIMIT 1
    ]) {
      if (String.isNotBlank(row.AppointmentNumber)) {
        return row.AppointmentNumber;
      }
    }
    return String.valueOf(appointmentId);
  }

  /**
   * Resolves the technician for the booking. Prefers an explicit `resourceId`
   * fast-path when a caller supplies one; otherwise matches the sanitized
   * `resourceReference` (e.g. "SR-A1" -> a resource whose Name starts with
   * "A1"). Returns null when neither resolves to an active resource, so a
   * stale plan degrades gracefully instead of mis-booking.
   */
  private static Id resolveResource(SchedulingRequest request) {
    if (!Schema.sObjectType.ServiceResource.isAccessible()) {
      return null;
    }
    Id fastPathId = safeId(request.resourceId);
    if (fastPathId != null) {
      for (ServiceResource resource : [
        SELECT Id
        FROM ServiceResource
        WHERE Id = :fastPathId AND IsActive = TRUE
        LIMIT 1
      ]) {
        return resource.Id;
      }
    }
    String namePrefix = referenceToNamePrefix(request.resourceReference);
    if (String.isNotBlank(namePrefix)) {
      // 'like' is an Apex reserved word — name the bind variable explicitly.
      String namePattern = namePrefix + '%';
      for (ServiceResource resource : [
        SELECT Id
        FROM ServiceResource
        WHERE Name LIKE :namePattern AND IsActive = TRUE
        LIMIT 1
      ]) {
        return resource.Id;
      }
    }
    return null;
  }

  /** Parse a String to an Id, or null when blank / not a valid Salesforce id. */
  private static Id safeId(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    try {
      return Id.valueOf(value);
    } catch (Exception invalidId) {
      return null;
    }
  }

  /** "SR-A1" -> "A1" (the gateway's sanitizeReference inverse, best-effort). */
  private static String referenceToNamePrefix(String reference) {
    if (String.isBlank(reference)) {
      return null;
    }
    String trimmed = reference.trim();
    if (trimmed.startsWith('SR-')) {
      return trimmed.substring(3);
    }
    return null;
  }

  private static Id resolveTerritory(String territoryName) {
    if (
      String.isBlank(territoryName) ||
      !Schema.sObjectType.ServiceTerritory.isAccessible()
    ) {
      return null;
    }
    for (ServiceTerritory territory : [
      SELECT Id
      FROM ServiceTerritory
      WHERE Name = :territoryName
      LIMIT 1
    ]) {
      return territory.Id;
    }
    return null;
  }

  /** Parse an ISO-8601 datetime (e.g. 2026-06-18T16:00:00.000Z) via JSON. */
  private static Datetime parseIso(String iso) {
    if (String.isBlank(iso)) {
      return null;
    }
    try {
      return (Datetime) JSON.deserialize('"' + iso + '"', Datetime.class);
    } catch (Exception parseError) {
      return null;
    }
  }

  // ---- DTOs (mirror apps/ai-api/src/orchestrator/dto/scheduling-write.ts) ----

  public class SchedulingRequest {
    @InvocableVariable(label='Workflow Id' required=true)
    public String workflowId;

    @InvocableVariable(label='Case Id' required=true)
    public String caseId;

    @InvocableVariable(
      label='Service Resource Id'
      description='Salesforce ServiceResource id resolved from the fresh read.'
    )
    public String resourceId;

    @InvocableVariable(label='Resource Reference')
    public String resourceReference;

    @InvocableVariable(label='Territory Reference')
    public String territoryReference;

    @InvocableVariable(
      label='Scheduled Start'
      description='ISO-8601 appointment start.'
    )
    public String schedStart;

    @InvocableVariable(
      label='Scheduled End'
      description='ISO-8601 appointment end.'
    )
    public String schedEnd;

    @InvocableVariable(label='Duration Minutes')
    public Integer durationMinutes;

    @InvocableVariable(label='Subject')
    public String subject;

    @InvocableVariable(label='Approval Reason')
    public String approvalReason;
  }

  public class SchedulingResult {
    @InvocableVariable(label='Applied')
    public Boolean applied;

    @InvocableVariable(label='Degraded')
    public Boolean degraded;

    @InvocableVariable(label='Booked')
    public Boolean booked;

    @InvocableVariable(label='Idempotent Skip')
    public Boolean idempotentSkip;

    @InvocableVariable(label='Appointment Status')
    public String appointmentStatus;

    @InvocableVariable(label='Appointment Reference')
    public String appointmentReference;

    @InvocableVariable(label='Appointment Id')
    public String appointmentId;

    @InvocableVariable(label='Assigned Resource Id')
    public String assignedResourceId;

    @InvocableVariable(label='Message')
    public String message;
  }
}
