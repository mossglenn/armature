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
 * The generated Zod schemas in schemas.ts build their enum checks from these
 * arrays, so request validation and the types can never disagree.
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

export const VALID_FindingStatus = [
  "Open",
  "Addressed",
  "Dismissed",
] as const;

export type FindingStatus = typeof VALID_FindingStatus[number];

export const VALID_AttestationVerdict = [
  "Affirmed",
  "Declined",
] as const;

export type AttestationVerdict = typeof VALID_AttestationVerdict[number];

export const VALID_ExternalSystem = [
  "CASE",
  "QTI",
  "xAPI",
  "LTI",
  "Other",
] as const;

export type ExternalSystem = typeof VALID_ExternalSystem[number];

export const VALID_AttachmentStore = [
  "S3",
  "Lore",
  "Git",
  "Other",
] as const;

export type AttachmentStore = typeof VALID_AttachmentStore[number];

// ────────────────────────────────────────────────────────
// Base type
// ────────────────────────────────────────────────────────

/** Every document and subdocument stored in TerminusDB carries @id and @type. */
export interface TerminusDocument {
  "@id": string;
  "@type": string;
}

// ────────────────────────────────────────────────────────
// Infrastructure — User, and the abstract roots every record inherits
// ────────────────────────────────────────────────────────

export interface User extends TerminusDocument {
  displayName: string;
  externalId: string;
  email?: string;
  institution?: string;
}

/** @abstract */
export type DesignRecord = TerminusDocument;  // no additional fields

/** @abstract */
export interface ArmatureDocument extends DesignRecord {
  label: string;
  description?: string;
  createdBy?: string;  // User @id
  externalRefs: ExternalRef[];
  attachments: Attachment[];
}

/** @subdocument — returned inline with a nested @id; cannot be referenced from another document */
export interface ExternalRef extends TerminusDocument {
  system: ExternalSystem;
  identifier: string;
  label?: string;
}

/** @subdocument — returned inline with a nested @id; cannot be referenced from another document */
export interface Attachment extends TerminusDocument {
  store: AttachmentStore;
  storeUri: string;
  container?: string;
  revision?: string;
  path?: string;
  contentHash: string;
  hashAlgorithm: string;
  mediaType?: string;
  byteSize?: number;
  role?: string;
  label?: string;
}

// ────────────────────────────────────────────────────────
// Fragments — subdocument parts of an artifact, returned inline (ADR-0033)
// ────────────────────────────────────────────────────────

/** @abstract · @subdocument — returned inline with a nested @id; cannot be referenced from another document */
export interface Fragment extends TerminusDocument {
  fragmentId: string;
  text?: string;
  attachments: Attachment[];
}

/** @subdocument — returned inline with a nested @id; cannot be referenced from another document */
export type TextFragment = Fragment;  // no additional fields

/** @subdocument — returned inline with a nested @id; cannot be referenced from another document */
export interface ItemOption extends Fragment {
  isCorrect: boolean;
  feedback?: string;
  purpose?: string;
}

// ────────────────────────────────────────────────────────
// Artifacts — primary instructional design documents
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
  asOf?: string;
  subject?: string;  // DesignRecord @id
}

export interface DescriptiveEvidence extends LearningEvidence {
  method: EvidenceMethod;
  finding: string;
}

export interface LearningDataset extends ArmatureDocument {
  administrationDate?: string;  // ISO 8601 date
  cohort?: string;
  producedBy?: string;  // Assessment @id
  asOf?: string;
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

export interface AssessmentItem extends ArmatureDocument {
  stem: TextFragment;
  options: ItemOption[];
  correctFeedback?: TextFragment;
  incorrectFeedback?: TextFragment;
  itemType: ItemType;
  status: ItemStatus;
  bloomsLevel?: BloomsLevel;
  assesses: string[];  // LearningObjective @id[]
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

export type ActivityGroup = ArmatureDocument;  // no additional fields

export interface Module extends ArmatureDocument {
  sequence?: number;
  course: string;  // Course @id
}

export interface DesignNote extends ArmatureDocument {
  rationale: string;
  subject: string[];  // DesignRecord @id[]
  category?: DesignNoteCategory;
  fragmentId?: string;
}

export interface DesignFinding extends ArmatureDocument {
  finding: string;
  subject: string[];  // DesignRecord @id[]
  regarding?: string;  // DesignRecord @id
  evidence: string[];  // LearningEvidence @id[]
  confidence?: ConfidenceLevel;
  status: FindingStatus;
  resolutionRationale?: string;
  asOf?: string;
  fragmentId?: string;
}

export type Course = ArmatureDocument;  // no additional fields

// ────────────────────────────────────────────────────────
// Relationships — reified junction documents; no label / description / createdBy unless they inherit ArmatureDocument
// ────────────────────────────────────────────────────────

export interface NeedEvidenceLink extends DesignRecord {
  need: string;  // LearningNeed @id
  evidence: string;  // LearningEvidence @id
  confidence?: ConfidenceLevel;
}

export interface PrerequisiteRecord extends ArmatureDocument {
  rationale: string;
  prerequisiteType: PrerequisiteType;
  objective: string;  // LearningObjective @id
  prerequisite: string;  // LearningObjective @id
}

export interface ItemInstance extends DesignRecord {
  sequence: number;
  pointValue: number;
  randomize: boolean;
  status: ItemStatus;
  assessment: string;  // Assessment @id
  implements: string;  // AssessmentItem @id
}

export interface ActivityGroupMember extends DesignRecord {
  group: string;  // ActivityGroup @id
  activity: string;  // LearningActivity @id
  sequence?: number;
}

export interface ActivityItemLink extends DesignRecord {
  activity: string;  // LearningActivity @id
  item: string;  // AssessmentItem @id
  sequence?: number;
}

export interface ModuleObjective extends DesignRecord {
  sequence?: number;
  role: ObjectiveRole;
  roleRationale?: string;
  module: string;  // Module @id
  references: string;  // LearningObjective @id
}

export interface ModuleActivityLink extends DesignRecord {
  module: string;  // Module @id
  activity: string;  // LearningActivity @id
  sequence?: number;
}

export interface ModuleActivityGroupLink extends DesignRecord {
  module: string;  // Module @id
  group: string;  // ActivityGroup @id
  sequence?: number;
}

export interface Attestation extends DesignRecord {
  subject: string;  // DesignRecord @id
  fragmentId?: string;
  claimRef?: string;
  claimText?: string;
  verdict: AttestationVerdict;
  reason?: string;
  asOf?: string;
  attestedBy?: string;  // User @id
}

// ────────────────────────────────────────────────────────
// Schema self-description (ADR-0027)
// ────────────────────────────────────────────────────────

/** Every class @id mapped to its @metadata.armature.category. */
export const CLASS_CATEGORY = {
  User: "infrastructure",
  DesignRecord: "infrastructure",
  ArmatureDocument: "infrastructure",
  LearningEvidence: "artifact",
  LearningMetric: "artifact",
  DescriptiveEvidence: "artifact",
  LearningDataset: "artifact",
  LearningNeed: "artifact",
  NeedEvidenceLink: "relationship",
  LearningObjective: "artifact",
  PrerequisiteRecord: "relationship",
  ExternalRef: "infrastructure",
  Attachment: "infrastructure",
  Fragment: "fragment",
  TextFragment: "fragment",
  ItemOption: "fragment",
  AssessmentItem: "artifact",
  ItemInstance: "relationship",
  Assessment: "artifact",
  LearningActivity: "artifact",
  ActivityGroup: "artifact",
  ActivityGroupMember: "relationship",
  ActivityItemLink: "relationship",
  ModuleObjective: "relationship",
  Module: "artifact",
  ModuleActivityLink: "relationship",
  ModuleActivityGroupLink: "relationship",
  DesignNote: "artifact",
  DesignFinding: "artifact",
  Attestation: "relationship",
  Course: "artifact",
} as const;

export type ClassName = keyof typeof CLASS_CATEGORY;
export type ClassCategory = typeof CLASS_CATEGORY[ClassName];

/** Every class name mapped to its interface, so a client can type a read by the class it names (Phase 7, @armature/client). */
export interface ClassMap {
  User: User;
  DesignRecord: DesignRecord;
  ArmatureDocument: ArmatureDocument;
  LearningEvidence: LearningEvidence;
  LearningMetric: LearningMetric;
  DescriptiveEvidence: DescriptiveEvidence;
  LearningDataset: LearningDataset;
  LearningNeed: LearningNeed;
  NeedEvidenceLink: NeedEvidenceLink;
  LearningObjective: LearningObjective;
  PrerequisiteRecord: PrerequisiteRecord;
  ExternalRef: ExternalRef;
  Attachment: Attachment;
  Fragment: Fragment;
  TextFragment: TextFragment;
  ItemOption: ItemOption;
  AssessmentItem: AssessmentItem;
  ItemInstance: ItemInstance;
  Assessment: Assessment;
  LearningActivity: LearningActivity;
  ActivityGroup: ActivityGroup;
  ActivityGroupMember: ActivityGroupMember;
  ActivityItemLink: ActivityItemLink;
  ModuleObjective: ModuleObjective;
  Module: Module;
  ModuleActivityLink: ModuleActivityLink;
  ModuleActivityGroupLink: ModuleActivityGroupLink;
  DesignNote: DesignNote;
  DesignFinding: DesignFinding;
  Attestation: Attestation;
  Course: Course;
}

/** Subdocument classes: returned inline, never addressable on their own (ADR-0022, ADR-0033). */
export const SUBDOCUMENT_CLASSES = [
  "ExternalRef",
  "Attachment",
  "Fragment",
  "TextFragment",
  "ItemOption",
] as const;

/** Every class @id mapped to its transitive @inherits ancestors, nearest first (ADR-0032; CLAUDE.md constraint 0). */
export const CLASS_ANCESTORS = {
  User: [],
  DesignRecord: [],
  ArmatureDocument: ["DesignRecord"],
  LearningEvidence: ["ArmatureDocument", "DesignRecord"],
  LearningMetric: ["LearningEvidence", "ArmatureDocument", "DesignRecord"],
  DescriptiveEvidence: ["LearningEvidence", "ArmatureDocument", "DesignRecord"],
  LearningDataset: ["ArmatureDocument", "DesignRecord"],
  LearningNeed: ["ArmatureDocument", "DesignRecord"],
  NeedEvidenceLink: ["DesignRecord"],
  LearningObjective: ["ArmatureDocument", "DesignRecord"],
  PrerequisiteRecord: ["ArmatureDocument", "DesignRecord"],
  ExternalRef: [],
  Attachment: [],
  Fragment: [],
  TextFragment: ["Fragment"],
  ItemOption: ["Fragment"],
  AssessmentItem: ["ArmatureDocument", "DesignRecord"],
  ItemInstance: ["DesignRecord"],
  Assessment: ["ArmatureDocument", "DesignRecord"],
  LearningActivity: ["ArmatureDocument", "DesignRecord"],
  ActivityGroup: ["ArmatureDocument", "DesignRecord"],
  ActivityGroupMember: ["DesignRecord"],
  ActivityItemLink: ["DesignRecord"],
  ModuleObjective: ["DesignRecord"],
  Module: ["ArmatureDocument", "DesignRecord"],
  ModuleActivityLink: ["DesignRecord"],
  ModuleActivityGroupLink: ["DesignRecord"],
  DesignNote: ["ArmatureDocument", "DesignRecord"],
  DesignFinding: ["ArmatureDocument", "DesignRecord"],
  Attestation: ["DesignRecord"],
  Course: ["ArmatureDocument", "DesignRecord"],
} as const;

/** Each class's @key strategy; Hash keys name the fields the id is derived from (ADR-0016, ADR-0024). */
export const CLASS_KEY = {
  User: {"type":"Random"},
  LearningMetric: {"type":"Random"},
  DescriptiveEvidence: {"type":"Random"},
  LearningDataset: {"type":"Random"},
  LearningNeed: {"type":"Random"},
  NeedEvidenceLink: {"type":"Hash","fields":["need","evidence"]},
  LearningObjective: {"type":"Random"},
  PrerequisiteRecord: {"type":"Hash","fields":["objective","prerequisite"]},
  ExternalRef: {"type":"Random"},
  Attachment: {"type":"Random"},
  Fragment: {"type":"Random"},
  TextFragment: {"type":"Random"},
  ItemOption: {"type":"Random"},
  AssessmentItem: {"type":"Random"},
  ItemInstance: {"type":"Hash","fields":["assessment","implements"]},
  Assessment: {"type":"Random"},
  LearningActivity: {"type":"Random"},
  ActivityGroup: {"type":"Random"},
  ActivityGroupMember: {"type":"Hash","fields":["group","activity"]},
  ActivityItemLink: {"type":"Hash","fields":["activity","item"]},
  ModuleObjective: {"type":"Hash","fields":["module","references"]},
  Module: {"type":"Random"},
  ModuleActivityLink: {"type":"Hash","fields":["module","activity"]},
  ModuleActivityGroupLink: {"type":"Hash","fields":["module","group"]},
  DesignNote: {"type":"Random"},
  DesignFinding: {"type":"Random"},
  Attestation: {"type":"Hash","fields":["subject","fragmentId","claimRef","attestedBy"]},
  Course: {"type":"Random"},
} as const;

/** One field's shape as data; see CLASS_FIELDS. */
export interface FieldShape {
  /** The xsd/sys type, enum, subdocument class or referenced class. */
  type: string;
  kind: "primitive" | "enum" | "subdocument" | "reference";
  optional: boolean;
  many: boolean;
  /** @min_cardinality on a Set or List. */
  min?: number;
}

/** Every field of every class, own and inherited: the schema as data for the invariants engine (ADR-0027). */
export const CLASS_FIELDS: Record<ClassName, Record<string, FieldShape>> = {
  User: {
    displayName: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    externalId: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    email: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    institution: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  DesignRecord: {},
  ArmatureDocument: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
  },
  LearningEvidence: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    collectedAt: {"type":"xsd:dateTime","kind":"primitive","optional":false,"many":false},
    source: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
  },
  LearningMetric: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    collectedAt: {"type":"xsd:dateTime","kind":"primitive","optional":false,"many":false},
    source: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    value: {"type":"xsd:decimal","kind":"primitive","optional":false,"many":false},
    unit: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    derivedFrom: {"type":"LearningDataset","kind":"reference","optional":true,"many":false},
    asOf: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    subject: {"type":"DesignRecord","kind":"reference","optional":true,"many":false},
  },
  DescriptiveEvidence: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    collectedAt: {"type":"xsd:dateTime","kind":"primitive","optional":false,"many":false},
    source: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    method: {"type":"EvidenceMethod","kind":"enum","optional":false,"many":false},
    finding: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
  },
  LearningDataset: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    administrationDate: {"type":"xsd:date","kind":"primitive","optional":true,"many":false},
    cohort: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    producedBy: {"type":"Assessment","kind":"reference","optional":true,"many":false},
    asOf: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  LearningNeed: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    rationale: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    priority: {"type":"NeedPriority","kind":"enum","optional":true,"many":false},
  },
  NeedEvidenceLink: {
    need: {"type":"LearningNeed","kind":"reference","optional":false,"many":false},
    evidence: {"type":"LearningEvidence","kind":"reference","optional":false,"many":false},
    confidence: {"type":"ConfidenceLevel","kind":"enum","optional":true,"many":false},
  },
  LearningObjective: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    bloomsLevel: {"type":"BloomsLevel","kind":"enum","optional":true,"many":false},
    state: {"type":"ObjectiveState","kind":"enum","optional":false,"many":false},
    generatedBy: {"type":"LearningNeed","kind":"reference","optional":true,"many":false},
  },
  PrerequisiteRecord: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    rationale: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    prerequisiteType: {"type":"PrerequisiteType","kind":"enum","optional":false,"many":false},
    objective: {"type":"LearningObjective","kind":"reference","optional":false,"many":false},
    prerequisite: {"type":"LearningObjective","kind":"reference","optional":false,"many":false},
  },
  ExternalRef: {
    system: {"type":"ExternalSystem","kind":"enum","optional":false,"many":false},
    identifier: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    label: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  Attachment: {
    store: {"type":"AttachmentStore","kind":"enum","optional":false,"many":false},
    storeUri: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    container: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    revision: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    path: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    contentHash: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    hashAlgorithm: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    mediaType: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    byteSize: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
    role: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    label: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  Fragment: {
    fragmentId: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    text: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
  },
  TextFragment: {
    fragmentId: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    text: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
  },
  ItemOption: {
    fragmentId: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    text: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    isCorrect: {"type":"xsd:boolean","kind":"primitive","optional":false,"many":false},
    feedback: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    purpose: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  AssessmentItem: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    stem: {"type":"TextFragment","kind":"subdocument","optional":false,"many":false},
    options: {"type":"ItemOption","kind":"subdocument","optional":true,"many":true},
    correctFeedback: {"type":"TextFragment","kind":"subdocument","optional":true,"many":false},
    incorrectFeedback: {"type":"TextFragment","kind":"subdocument","optional":true,"many":false},
    itemType: {"type":"ItemType","kind":"enum","optional":false,"many":false},
    status: {"type":"ItemStatus","kind":"enum","optional":false,"many":false},
    bloomsLevel: {"type":"BloomsLevel","kind":"enum","optional":true,"many":false},
    assesses: {"type":"LearningObjective","kind":"reference","optional":true,"many":true},
  },
  ItemInstance: {
    sequence: {"type":"xsd:integer","kind":"primitive","optional":false,"many":false},
    pointValue: {"type":"xsd:integer","kind":"primitive","optional":false,"many":false},
    randomize: {"type":"xsd:boolean","kind":"primitive","optional":false,"many":false},
    status: {"type":"ItemStatus","kind":"enum","optional":false,"many":false},
    assessment: {"type":"Assessment","kind":"reference","optional":false,"many":false},
    implements: {"type":"AssessmentItem","kind":"reference","optional":false,"many":false},
  },
  Assessment: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    randomize: {"type":"xsd:boolean","kind":"primitive","optional":false,"many":false},
    passingScore: {"type":"xsd:decimal","kind":"primitive","optional":true,"many":false},
    retakes: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
    module: {"type":"Module","kind":"reference","optional":false,"many":false},
  },
  LearningActivity: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    activityType: {"type":"ActivityType","kind":"enum","optional":true,"many":false},
    targets: {"type":"LearningObjective","kind":"reference","optional":false,"many":true,"min":1},
  },
  ActivityGroup: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
  },
  ActivityGroupMember: {
    group: {"type":"ActivityGroup","kind":"reference","optional":false,"many":false},
    activity: {"type":"LearningActivity","kind":"reference","optional":false,"many":false},
    sequence: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
  },
  ActivityItemLink: {
    activity: {"type":"LearningActivity","kind":"reference","optional":false,"many":false},
    item: {"type":"AssessmentItem","kind":"reference","optional":false,"many":false},
    sequence: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
  },
  ModuleObjective: {
    sequence: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
    role: {"type":"ObjectiveRole","kind":"enum","optional":false,"many":false},
    roleRationale: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    module: {"type":"Module","kind":"reference","optional":false,"many":false},
    references: {"type":"LearningObjective","kind":"reference","optional":false,"many":false},
  },
  Module: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    sequence: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
    course: {"type":"Course","kind":"reference","optional":false,"many":false},
  },
  ModuleActivityLink: {
    module: {"type":"Module","kind":"reference","optional":false,"many":false},
    activity: {"type":"LearningActivity","kind":"reference","optional":false,"many":false},
    sequence: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
  },
  ModuleActivityGroupLink: {
    module: {"type":"Module","kind":"reference","optional":false,"many":false},
    group: {"type":"ActivityGroup","kind":"reference","optional":false,"many":false},
    sequence: {"type":"xsd:integer","kind":"primitive","optional":true,"many":false},
  },
  DesignNote: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    rationale: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    subject: {"type":"DesignRecord","kind":"reference","optional":false,"many":true,"min":1},
    category: {"type":"DesignNoteCategory","kind":"enum","optional":true,"many":false},
    fragmentId: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  DesignFinding: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
    finding: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    subject: {"type":"DesignRecord","kind":"reference","optional":false,"many":true,"min":1},
    regarding: {"type":"DesignRecord","kind":"reference","optional":true,"many":false},
    evidence: {"type":"LearningEvidence","kind":"reference","optional":true,"many":true},
    confidence: {"type":"ConfidenceLevel","kind":"enum","optional":true,"many":false},
    status: {"type":"FindingStatus","kind":"enum","optional":false,"many":false},
    resolutionRationale: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    asOf: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    fragmentId: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
  },
  Attestation: {
    subject: {"type":"DesignRecord","kind":"reference","optional":false,"many":false},
    fragmentId: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    claimRef: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    claimText: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    verdict: {"type":"AttestationVerdict","kind":"enum","optional":false,"many":false},
    reason: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    asOf: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    attestedBy: {"type":"User","kind":"reference","optional":true,"many":false},
  },
  Course: {
    label: {"type":"xsd:string","kind":"primitive","optional":false,"many":false},
    description: {"type":"xsd:string","kind":"primitive","optional":true,"many":false},
    createdBy: {"type":"User","kind":"reference","optional":true,"many":false},
    externalRefs: {"type":"ExternalRef","kind":"subdocument","optional":true,"many":true},
    attachments: {"type":"Attachment","kind":"subdocument","optional":true,"many":true},
  },
};
