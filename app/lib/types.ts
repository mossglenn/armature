// ============================================================
// Armature TypeScript types
// Auto-derived from schema/schema.json — keep in sync manually
// ============================================================

// ------ Enums -----------------------------------------------

export type BloomsLevel =
  | "Remember"
  | "Understand"
  | "Apply"
  | "Analyze"
  | "Evaluate"
  | "Create";

export type ObjectiveState = "Draft" | "Active" | "Deprecated" | "Archived";

export type ItemType =
  | "MultipleChoice"
  | "MultipleSelect"
  | "TrueFalse"
  | "ShortAnswer"
  | "Essay"
  | "Matching"
  | "Ordering"
  | "FillInTheBlank";

export type ItemStatus = "Draft" | "InReview" | "Approved" | "Retired";

export type EvidenceMethod =
  | "Interview"
  | "Survey"
  | "Observation"
  | "FocusGroup"
  | "DocumentReview"
  | "ExpertReview"
  | "Other";

export type ObjectiveRole = "Primary" | "Supporting" | "Prerequisite";

export type CoverageStatus =
  | "Uncovered"
  | "PartiallyAssessed"
  | "FullyAssessed"
  | "OverAssessed";

export type ActivityType =
  | "Reading"
  | "Video"
  | "Simulation"
  | "WorkedExample"
  | "Discussion"
  | "Practice"
  | "Reflection"
  | "Other";

export type PrerequisiteType = "Hard" | "Soft" | "Corequisite";

export type ConfidenceLevel = "High" | "Medium" | "Low" | "Preliminary";

export type NeedPriority = "Critical" | "High" | "Medium" | "Low";

export type DesignNoteCategory =
  | "BloomsLevelChoice"
  | "AssessmentStrategyChoice"
  | "SequencingDecision"
  | "PrioritizationDecision"
  | "ScopeDecision"
  | "AlignmentDecision"
  | "PrerequisiteIntent"
  | "Other";

// ------ Base types ------------------------------------------

export interface TerminusDocument {
  "@id": string;
  "@type": string;
}

// User is infrastructure — does not extend ArmatureDocument
export interface User extends TerminusDocument {
  displayName: string;
  externalId: string;
  email?: string;
  institution?: string;
}

// Abstract base — all primary artifacts inherit these fields
export interface ArmatureDocument extends TerminusDocument {
  label: string;
  description?: string;
  createdBy?: string; // User @id reference
}

// ------ Evidence types --------------------------------------

// Abstract — never instantiated directly
export interface LearningEvidence extends ArmatureDocument {
  collectedAt: string; // xsd:dateTime
  source: string;
}

export interface LearningMetric extends LearningEvidence {
  value: number;
  unit: string;
  derivedFrom?: string; // LearningDataset @id
}

export interface DescriptiveEvidence extends LearningEvidence {
  method: EvidenceMethod;
  finding: string;
}

// ------ Primary artifact types ------------------------------

export interface Course extends ArmatureDocument {}

export interface Module extends ArmatureDocument {
  sequence?: number;
  course: string; // Course @id
}

export interface LearningNeed extends ArmatureDocument {
  rationale: string;
  priority?: NeedPriority;
}

export interface LearningObjective extends ArmatureDocument {
  state: ObjectiveState;
  bloomsLevel?: BloomsLevel;
  generatedBy?: string; // LearningNeed @id
}

export interface AssessmentItem extends ArmatureDocument {
  stem: string;
  itemType: ItemType;
  bloomsLevel?: BloomsLevel;
  assesses: string[]; // LearningObjective @id[]
  difficultyIndex?: number;
  discriminationIndex?: number;
}

export interface Response extends ArmatureDocument {
  isCorrect: boolean;
  incorrectFeedback?: string;
  item: string; // AssessmentItem @id
}

export interface Assessment extends ArmatureDocument {
  randomize: boolean;
  passingScore?: number;
  retakes?: number;
  module: string; // Module @id
}

export interface LearningActivity extends ArmatureDocument {
  activityType?: ActivityType;
  targets: string[]; // LearningObjective @id[]
}

export interface ActivityGroup extends ArmatureDocument {}

export interface LearningDataset extends ArmatureDocument {
  administrationDate?: string; // xsd:date
  cohort?: string;
  producedBy?: string; // Assessment @id
}

export interface DesignNote extends ArmatureDocument {
  rationale: string;
  subject: string[]; // ArmatureDocument @id[]
  category?: DesignNoteCategory;
}

export interface PrerequisiteRecord extends ArmatureDocument {
  rationale: string;
  prerequisiteType: PrerequisiteType;
  objective: string; // LearningObjective @id
  prerequisite: string; // LearningObjective @id
}

// ------ Junction documents ----------------------------------
// These do NOT extend ArmatureDocument — no label/description/createdBy

export interface NeedEvidenceLink extends TerminusDocument {
  need: string; // LearningNeed @id
  evidence: string; // LearningEvidence @id
  confidence?: ConfidenceLevel;
}

export interface ModuleObjective extends TerminusDocument {
  module: string; // Module @id
  references: string; // LearningObjective @id
  role: ObjectiveRole;
  roleRationale?: string;
  coverageStatus: CoverageStatus;
  sequence?: number;
}

export interface ItemInstance extends TerminusDocument {
  assessment: string; // Assessment @id
  implements: string; // AssessmentItem @id
  sequence: number;
  pointValue: number;
  randomize: boolean;
  status: ItemStatus;
}

export interface ActivityGroupMember extends TerminusDocument {
  group: string; // ActivityGroup @id
  activity: string; // LearningActivity @id
  sequence?: number;
}

export interface ModuleActivityLink extends TerminusDocument {
  module: string; // Module @id
  activity: string; // LearningActivity @id
  sequence?: number;
}

export interface ModuleActivityGroupLink extends TerminusDocument {
  module: string; // Module @id
  group: string; // ActivityGroup @id
  sequence?: number;
}
