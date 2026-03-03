// GENERATED — do not edit manually
// Source:      schema/schema.json
// Regenerate:  npm run generate:types  (from armature/app/)
// Check drift: npm run check:types
//
// To update types, modify schema/schema.json and re-run the generator.

// ────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────

/**
 * Runtime allowlists for every TerminusDB enum type.
 * Each VALID_* array is the source of truth — the union type is derived from it.
 *
 * Use with validateEnum() in route handlers:
 *   validateEnum(body.bloomsLevel, 'bloomsLevel', VALID_BloomsLevel, false)
 *
 * The arrays are readonly tuples so TypeScript can narrow the derived union type.
 */

export const VALID_BloomsLevel = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export type BloomsLevel = typeof VALID_BloomsLevel[number];

export const VALID_ObjectiveState = [
  "Draft",
  "Active",
  "Deprecated",
  "Archived",
] as const;

export type ObjectiveState = typeof VALID_ObjectiveState[number];

export const VALID_ItemType = [
  "MultipleChoice",
  "MultipleSelect",
  "TrueFalse",
  "ShortAnswer",
  "Essay",
  "Matching",
  "Ordering",
  "FillInTheBlank",
] as const;

export type ItemType = typeof VALID_ItemType[number];

export const VALID_ItemStatus = [
  "Draft",
  "InReview",
  "Approved",
  "Retired",
] as const;

export type ItemStatus = typeof VALID_ItemStatus[number];

export const VALID_EvidenceMethod = [
  "Interview",
  "Survey",
  "Observation",
  "FocusGroup",
  "DocumentReview",
  "ExpertReview",
  "Other",
] as const;

export type EvidenceMethod = typeof VALID_EvidenceMethod[number];

export const VALID_ObjectiveRole = [
  "Primary",
  "Supporting",
  "Prerequisite",
] as const;

export type ObjectiveRole = typeof VALID_ObjectiveRole[number];

export const VALID_CoverageStatus = [
  "Uncovered",
  "PartiallyAssessed",
  "FullyAssessed",
  "OverAssessed",
] as const;

export type CoverageStatus = typeof VALID_CoverageStatus[number];

export const VALID_ActivityType = [
  "Reading",
  "Video",
  "Simulation",
  "WorkedExample",
  "Discussion",
  "Practice",
  "Reflection",
  "Other",
] as const;

export type ActivityType = typeof VALID_ActivityType[number];

export const VALID_PrerequisiteType = [
  "Hard",
  "Soft",
  "Corequisite",
] as const;

export type PrerequisiteType = typeof VALID_PrerequisiteType[number];

export const VALID_ConfidenceLevel = [
  "High",
  "Medium",
  "Low",
  "Preliminary",
] as const;

export type ConfidenceLevel = typeof VALID_ConfidenceLevel[number];

export const VALID_NeedPriority = [
  "Critical",
  "High",
  "Medium",
  "Low",
] as const;

export type NeedPriority = typeof VALID_NeedPriority[number];

export const VALID_DesignNoteCategory = [
  "BloomsLevelChoice",
  "AssessmentStrategyChoice",
  "SequencingDecision",
  "PrioritizationDecision",
  "ScopeDecision",
  "AlignmentDecision",
  "PrerequisiteIntent",
  "Other",
] as const;

export type DesignNoteCategory = typeof VALID_DesignNoteCategory[number];

// ────────────────────────────────────────────────────────
// Base types
// ────────────────────────────────────────────────────────

/** Every document stored in TerminusDB carries @id and @type. */
export interface TerminusDocument {
  "@id": string;
  "@type": string;
}

/** Infrastructure type — not an instructional artifact. Does not extend ArmatureDocument. */
export interface User extends TerminusDocument {
  displayName: string;
  externalId: string;
  email?: string;
  institution?: string;
}

/** Abstract base for all primary instructional artifacts. */
export interface ArmatureDocument extends TerminusDocument {
  label: string;
  description?: string;
  createdBy?: string;  // User @id
}

// ────────────────────────────────────────────────────────
// Document types
// ────────────────────────────────────────────────────────

/** @abstract */
export interface LearningEvidence extends ArmatureDocument {
  collectedAt: string;  // ISO 8601 datetime
  source: string;
}

export interface LearningMetric extends LearningEvidence {
  value: number;
  unit: string;
  derivedFrom?: string;  // LearningDataset @id
}

export interface DescriptiveEvidence extends LearningEvidence {
  method: EvidenceMethod;
  finding: string;
}

export interface LearningDataset extends ArmatureDocument {
  administrationDate?: string;  // ISO 8601 date
  cohort?: string;
  producedBy?: string;  // Assessment @id
}

export interface LearningNeed extends ArmatureDocument {
  rationale: string;
  priority?: NeedPriority;
}

export interface LearningObjective extends ArmatureDocument {
  bloomsLevel?: BloomsLevel;
  state: ObjectiveState;
  generatedBy?: string;  // LearningNeed @id
}

export interface PrerequisiteRecord extends ArmatureDocument {
  rationale: string;
  prerequisiteType: PrerequisiteType;
  objective: string;  // LearningObjective @id
  prerequisite: string;  // LearningObjective @id
}

export interface AssessmentItem extends ArmatureDocument {
  stem: string;
  itemType: ItemType;
  bloomsLevel?: BloomsLevel;
  assesses: string[];  // LearningObjective @id[]
  difficultyIndex?: number;
  discriminationIndex?: number;
}

export interface Response extends ArmatureDocument {
  isCorrect: boolean;
  incorrectFeedback?: string;
  item: string;  // AssessmentItem @id
}

export interface Assessment extends ArmatureDocument {
  randomize: boolean;
  passingScore?: number;
  retakes?: number;
  module: string;  // Module @id
}

export interface LearningActivity extends ArmatureDocument {
  activityType?: ActivityType;
  targets: string[];  // LearningObjective @id[]
}

export interface ActivityGroup extends ArmatureDocument {
  // no additional fields
}

export interface Module extends ArmatureDocument {
  sequence?: number;
  course: string;  // Course @id
}

export interface Course extends ArmatureDocument {
  // no additional fields
}

export interface DesignNote extends ArmatureDocument {
  rationale: string;
  subject: string[];  // ArmatureDocument @id[]
  category?: DesignNoteCategory;
}

// ────────────────────────────────────────────────────────
// Junction documents — no label / description / createdBy
// ────────────────────────────────────────────────────────

export interface NeedEvidenceLink extends TerminusDocument {
  need: string;  // LearningNeed @id
  evidence: string;  // LearningEvidence @id
  confidence?: ConfidenceLevel;
}

export interface ItemInstance extends TerminusDocument {
  sequence: number;
  pointValue: number;
  randomize: boolean;
  status: ItemStatus;
  assessment: string;  // Assessment @id
  implements: string;  // AssessmentItem @id
}

export interface ModuleObjective extends TerminusDocument {
  sequence?: number;
  role: ObjectiveRole;
  roleRationale?: string;
  coverageStatus: CoverageStatus;
  module: string;  // Module @id
  references: string;  // LearningObjective @id
}

export interface ActivityGroupMember extends TerminusDocument {
  group: string;  // ActivityGroup @id
  activity: string;  // LearningActivity @id
  sequence?: number;
}

export interface ModuleActivityLink extends TerminusDocument {
  module: string;  // Module @id
  activity: string;  // LearningActivity @id
  sequence?: number;
}

export interface ModuleActivityGroupLink extends TerminusDocument {
  module: string;  // Module @id
  group: string;  // ActivityGroup @id
  sequence?: number;
}
