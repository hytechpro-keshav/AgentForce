/*
 * Node 5 Phase 5-Pre seed — idempotent Field Service scheduling data for the laptop domain.
 * Seeds: Skill graph, ServiceResourceSkill (A1/A2), North America territory + members,
 *        laptop WorkTypes + SkillRequirement. Re-runnable: query-before-insert on every object.
 * Run via: scripts/sf/node5-pre-seed.sh <org-alias>
 * Phase plan: docs/orchestrator/node-5-scheduling-phase-plan.md §6, §12
 */
Date today = Date.today();

// ---------- 1. Skill taxonomy (§12.2) ----------
// Skill is a metadata/setup object (not Apex-insertable) — deployed via force-app/main/default/skills/.
// This step only resolves the deployed Skill Ids; the metadata deploy must run first.
Set<String> expectedSkillDevs = new Set<String>{
    'Laptop_Hardware', 'Battery_Power', 'Display', 'Motherboard', 'Thermal_Cooling'
};
Map<String, Id> skillIdByDev = new Map<String, Id>();
for (Skill s : [SELECT Id, DeveloperName FROM Skill WHERE DeveloperName IN :expectedSkillDevs]) {
    skillIdByDev.put(s.DeveloperName, s.Id);
}
if (!skillIdByDev.keySet().containsAll(expectedSkillDevs)) {
    Set<String> missing = new Set<String>(expectedSkillDevs);
    missing.removeAll(skillIdByDev.keySet());
    throw new System.AsyncException('Skill metadata not deployed. Missing Skill DeveloperNames: ' + missing
        + '. Deploy force-app/main/default/skills/ before running this seed.');
}
System.debug('Skills present: ' + skillIdByDev.keySet());

// ---------- 2. Technicians (resolve A1/A2 by name, no hardcoded Id) ----------
Map<String, Id> techByCode = new Map<String, Id>();
for (ServiceResource sr : [SELECT Id, Name FROM ServiceResource WHERE IsActive = true AND ResourceType = 'T']) {
    if (sr.Name.startsWithIgnoreCase('A1')) techByCode.put('A1', sr.Id);
    if (sr.Name.startsWithIgnoreCase('A2')) techByCode.put('A2', sr.Id);
}
if (!techByCode.containsKey('A1') || !techByCode.containsKey('A2')) {
    throw new System.AsyncException('Expected technicians A1 and A2 not found. Found: ' + techByCode);
}

// ---------- 3. ServiceResourceSkill assignments (§12.2) ----------
// dev-name -> { techCode -> level }
Map<String, Map<String, Integer>> assign = new Map<String, Map<String, Integer>>{
    'Laptop_Hardware' => new Map<String, Integer>{ 'A1' => 9, 'A2' => 7 },
    'Battery_Power'   => new Map<String, Integer>{ 'A1' => 8, 'A2' => 5 },
    'Display'         => new Map<String, Integer>{ 'A2' => 8 },
    'Motherboard'     => new Map<String, Integer>{ 'A1' => 9 },
    'Thermal_Cooling' => new Map<String, Integer>{ 'A1' => 6, 'A2' => 7 }
};
Set<String> existingSrsKeys = new Set<String>();
for (ServiceResourceSkill srs : [SELECT ServiceResourceId, SkillId FROM ServiceResourceSkill]) {
    existingSrsKeys.add(srs.ServiceResourceId + '|' + srs.SkillId);
}
List<ServiceResourceSkill> srsToInsert = new List<ServiceResourceSkill>();
for (String dev : assign.keySet()) {
    Id skillId = skillIdByDev.get(dev);
    for (String techCode : assign.get(dev).keySet()) {
        Id resId = techByCode.get(techCode);
        if (!existingSrsKeys.contains(resId + '|' + skillId)) {
            srsToInsert.add(new ServiceResourceSkill(
                ServiceResourceId = resId,
                SkillId = skillId,
                SkillLevel = assign.get(dev).get(techCode),
                EffectiveStartDate = today
            ));
        }
    }
}
if (!srsToInsert.isEmpty()) insert srsToInsert;
System.debug('ServiceResourceSkill inserted: ' + srsToInsert.size());

// ---------- 4. North America territory (§6.2 — align to Node 4 Austin ship-to) ----------
Id baseOhId;
for (OperatingHours oh : [SELECT Id, Name FROM OperatingHours ORDER BY Name LIMIT 50]) {
    if (oh.Name == 'Base Calendar') baseOhId = oh.Id;
}
if (baseOhId == null) {
    // fall back to any operating hours
    List<OperatingHours> anyOh = [SELECT Id FROM OperatingHours LIMIT 1];
    if (!anyOh.isEmpty()) baseOhId = anyOh[0].Id;
}
List<ServiceTerritory> naList = [SELECT Id FROM ServiceTerritory WHERE Name = 'North America' LIMIT 1];
Id naTerritoryId;
if (naList.isEmpty()) {
    ServiceTerritory na = new ServiceTerritory(
        Name = 'North America',
        IsActive = true,
        OperatingHoursId = baseOhId,
        Street = '11501 Domain Dr',
        City = 'Austin',
        State = 'TX',
        PostalCode = '78758',
        Country = 'US'
    );
    insert na;
    naTerritoryId = na.Id;
} else {
    naTerritoryId = naList[0].Id;
}
System.debug('North America territory: ' + naTerritoryId);

// ---------- 5. Territory members (A1, A2 Primary in NA) ----------
Set<Id> existingMembers = new Set<Id>();
for (ServiceTerritoryMember m : [SELECT ServiceResourceId FROM ServiceTerritoryMember WHERE ServiceTerritoryId = :naTerritoryId]) {
    existingMembers.add(m.ServiceResourceId);
}
List<ServiceTerritoryMember> membersToInsert = new List<ServiceTerritoryMember>();
for (String techCode : techByCode.keySet()) {
    Id resId = techByCode.get(techCode);
    if (!existingMembers.contains(resId)) {
        // Secondary ('S'): A1/A2 are already Primary in Abypro; FSL allows only one Primary
        // territory per resource for overlapping dates. Secondary membership still makes the
        // technician schedulable in North America for territory ranking.
        membersToInsert.add(new ServiceTerritoryMember(
            ServiceResourceId = resId,
            ServiceTerritoryId = naTerritoryId,
            TerritoryType = 'S',
            EffectiveStartDate = Datetime.now()
        ));
    }
}
if (!membersToInsert.isEmpty()) insert membersToInsert;
System.debug('ServiceTerritoryMember (NA) inserted: ' + membersToInsert.size());

// ---------- 6. Laptop WorkTypes (§12.3) ----------
Map<String, Map<String, Object>> wtSpec = new Map<String, Map<String, Object>>{
    'Laptop Onsite Repair'       => new Map<String, Object>{ 'dur' => 2, 'skill' => 'Laptop_Hardware' },
    'Laptop Battery Replacement' => new Map<String, Object>{ 'dur' => 1, 'skill' => 'Battery_Power' }
};
Map<String, Id> wtIdByName = new Map<String, Id>();
for (WorkType wt : [SELECT Id, Name FROM WorkType WHERE Name IN :wtSpec.keySet()]) {
    wtIdByName.put(wt.Name, wt.Id);
}
List<WorkType> wtToInsert = new List<WorkType>();
for (String name : wtSpec.keySet()) {
    if (!wtIdByName.containsKey(name)) {
        wtToInsert.add(new WorkType(
            Name = name,
            EstimatedDuration = (Integer) wtSpec.get(name).get('dur'),
            DurationType = 'Hours'
        ));
    }
}
if (!wtToInsert.isEmpty()) {
    insert wtToInsert;
    for (WorkType wt : wtToInsert) wtIdByName.put(wt.Name, wt.Id);
}
System.debug('WorkTypes present: ' + wtIdByName.keySet());

// ---------- 7. SkillRequirement on laptop WorkTypes (§6.1 / §12.3) ----------
Set<String> existingSkillReqKeys = new Set<String>();
for (SkillRequirement sr : [SELECT RelatedRecordId, SkillId FROM SkillRequirement WHERE RelatedRecordId IN :wtIdByName.values()]) {
    existingSkillReqKeys.add(sr.RelatedRecordId + '|' + sr.SkillId);
}
List<SkillRequirement> skillReqToInsert = new List<SkillRequirement>();
for (String name : wtSpec.keySet()) {
    Id wtId = wtIdByName.get(name);
    Id skillId = skillIdByDev.get((String) wtSpec.get(name).get('skill'));
    if (wtId != null && skillId != null && !existingSkillReqKeys.contains(wtId + '|' + skillId)) {
        skillReqToInsert.add(new SkillRequirement(
            RelatedRecordId = wtId,
            SkillId = skillId,
            SkillLevel = 5
        ));
    }
}
if (!skillReqToInsert.isEmpty()) insert skillReqToInsert;
System.debug('SkillRequirement inserted: ' + skillReqToInsert.size());

System.debug('=== Node 5 5-Pre seed complete ===');
