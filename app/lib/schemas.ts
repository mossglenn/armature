// GENERATED — do not edit manually
// Source:      schema/schema.json
// Regenerate:  npm run generate:types  (from armature/app/)
// Check drift: npm run check:types
//
// Zod request schemas for the generic write routes (ADR-0054 decision 4,
// Phase 3). Shape only: cross-document rules live in the invariants engine.

import { z } from 'zod';
import { VALID_BloomsLevel, VALID_ObjectiveState, VALID_ItemType, VALID_ItemStatus, VALID_EvidenceMethod, VALID_ObjectiveRole, VALID_ActivityType, VALID_PrerequisiteType, VALID_ConfidenceLevel, VALID_NeedPriority, VALID_DesignNoteCategory, VALID_FindingStatus } from './types';

/**
 * A reference to another document: its id, or { "@ref": "<capture>" } naming a
 * document captured earlier in the same batch with "@capture" (platform check X2).
 */
export const ReferenceSchema = z.union([z.string().min(1), z.strictObject({ '@ref': z.string().min(1) })]);

// ── Subdocuments (inline; @type required, nested @id ignored) ─────────────────

export const TextFragmentSchema = z.strictObject({
  '@id': z.string().optional(),
  '@type': z.literal('TextFragment'),
  fragmentId: z.string().min(1).max(10_000),
  text: z.string().min(1).max(10_000),
});

export const ItemOptionSchema = z.strictObject({
  '@id': z.string().optional(),
  '@type': z.literal('ItemOption'),
  fragmentId: z.string().min(1).max(10_000),
  text: z.string().min(1).max(10_000),
  isCorrect: z.boolean(),
  feedback: z.string().min(1).max(10_000).optional(),
  purpose: z.string().min(1).max(10_000).optional(),
});

/** @abstract: any concrete Fragment */
export const FragmentSchema = z.discriminatedUnion('@type', [TextFragmentSchema, ItemOptionSchema]);

// ── Documents (concrete classes; the route fills @id and @type; computed fields omitted) ───

export const UserSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('User').optional(),
  '@capture': z.string().min(1).optional(),
  displayName: z.string().min(1).max(10_000),
  externalId: z.string().min(1).max(10_000),
  email: z.string().min(1).max(10_000).optional(),
  institution: z.string().min(1).max(10_000).optional(),
});

export const LearningMetricSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('LearningMetric').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  collectedAt: z.iso.datetime(),
  source: z.string().min(1).max(10_000),
  value: z.number(),
  unit: z.string().min(1).max(10_000),
  derivedFrom: ReferenceSchema.optional(),
});

export const DescriptiveEvidenceSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('DescriptiveEvidence').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  collectedAt: z.iso.datetime(),
  source: z.string().min(1).max(10_000),
  method: z.enum(VALID_EvidenceMethod),
  finding: z.string().min(1).max(10_000),
});

export const LearningDatasetSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('LearningDataset').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  administrationDate: z.iso.date().optional(),
  cohort: z.string().min(1).max(10_000).optional(),
  producedBy: ReferenceSchema.optional(),
});

export const LearningNeedSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('LearningNeed').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  rationale: z.string().min(1).max(10_000),
  priority: z.enum(VALID_NeedPriority).optional(),
});

export const NeedEvidenceLinkSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('NeedEvidenceLink').optional(),
  '@capture': z.string().min(1).optional(),
  need: ReferenceSchema,
  evidence: ReferenceSchema,
  confidence: z.enum(VALID_ConfidenceLevel).optional(),
});

export const LearningObjectiveSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('LearningObjective').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  bloomsLevel: z.enum(VALID_BloomsLevel).optional(),
  state: z.enum(VALID_ObjectiveState),
  generatedBy: ReferenceSchema.optional(),
});

export const PrerequisiteRecordSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('PrerequisiteRecord').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  rationale: z.string().min(1).max(10_000),
  prerequisiteType: z.enum(VALID_PrerequisiteType),
  objective: ReferenceSchema,
  prerequisite: ReferenceSchema,
});

export const AssessmentItemSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('AssessmentItem').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  stem: TextFragmentSchema,
  options: z.array(ItemOptionSchema).optional(),
  correctFeedback: TextFragmentSchema.optional(),
  incorrectFeedback: TextFragmentSchema.optional(),
  itemType: z.enum(VALID_ItemType),
  status: z.enum(VALID_ItemStatus),
  bloomsLevel: z.enum(VALID_BloomsLevel).optional(),
  assesses: z.array(ReferenceSchema).min(1),
  difficultyIndex: z.number().optional(),
  discriminationIndex: z.number().optional(),
});

export const ItemInstanceSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('ItemInstance').optional(),
  '@capture': z.string().min(1).optional(),
  sequence: z.number().int(),
  pointValue: z.number().int(),
  randomize: z.boolean(),
  status: z.enum(VALID_ItemStatus),
  assessment: ReferenceSchema,
  implements: ReferenceSchema,
});

export const AssessmentSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('Assessment').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  randomize: z.boolean(),
  passingScore: z.number().optional(),
  retakes: z.number().int().optional(),
  module: ReferenceSchema,
});

export const LearningActivitySchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('LearningActivity').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  activityType: z.enum(VALID_ActivityType).optional(),
  targets: z.array(ReferenceSchema).min(1),
});

export const ActivityGroupSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('ActivityGroup').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
});

export const ActivityGroupMemberSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('ActivityGroupMember').optional(),
  '@capture': z.string().min(1).optional(),
  group: ReferenceSchema,
  activity: ReferenceSchema,
  sequence: z.number().int().optional(),
});

/** Without coverageStatus, projectedCoverageStatus: computed by the hub (ADR-0029). */
export const ModuleObjectiveSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('ModuleObjective').optional(),
  '@capture': z.string().min(1).optional(),
  sequence: z.number().int().optional(),
  role: z.enum(VALID_ObjectiveRole),
  roleRationale: z.string().min(1).max(10_000).optional(),
  module: ReferenceSchema,
  references: ReferenceSchema,
});

export const ModuleSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('Module').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  sequence: z.number().int().optional(),
  course: ReferenceSchema,
});

export const ModuleActivityLinkSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('ModuleActivityLink').optional(),
  '@capture': z.string().min(1).optional(),
  module: ReferenceSchema,
  activity: ReferenceSchema,
  sequence: z.number().int().optional(),
});

export const ModuleActivityGroupLinkSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('ModuleActivityGroupLink').optional(),
  '@capture': z.string().min(1).optional(),
  module: ReferenceSchema,
  group: ReferenceSchema,
  sequence: z.number().int().optional(),
});

export const DesignNoteSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('DesignNote').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  rationale: z.string().min(1).max(10_000),
  subject: z.array(ReferenceSchema).min(1),
  category: z.enum(VALID_DesignNoteCategory).optional(),
});

export const DesignFindingSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('DesignFinding').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
  finding: z.string().min(1).max(10_000),
  subject: z.array(ReferenceSchema).min(1),
  regarding: ReferenceSchema.optional(),
  evidence: z.array(ReferenceSchema).optional(),
  confidence: z.enum(VALID_ConfidenceLevel).optional(),
  status: z.enum(VALID_FindingStatus),
  resolutionRationale: z.string().min(1).max(10_000).optional(),
});

export const CourseSchema = z.strictObject({
  '@id': z.string().min(1).optional(),
  '@type': z.literal('Course').optional(),
  '@capture': z.string().min(1).optional(),
  label: z.string().min(1).max(10_000),
  description: z.string().min(1).max(10_000).optional(),
  createdBy: ReferenceSchema.optional(),
});

/** Every concrete document class by @id. */
export const DOCUMENT_SCHEMAS = {
  User: UserSchema,
  LearningMetric: LearningMetricSchema,
  DescriptiveEvidence: DescriptiveEvidenceSchema,
  LearningDataset: LearningDatasetSchema,
  LearningNeed: LearningNeedSchema,
  NeedEvidenceLink: NeedEvidenceLinkSchema,
  LearningObjective: LearningObjectiveSchema,
  PrerequisiteRecord: PrerequisiteRecordSchema,
  AssessmentItem: AssessmentItemSchema,
  ItemInstance: ItemInstanceSchema,
  Assessment: AssessmentSchema,
  LearningActivity: LearningActivitySchema,
  ActivityGroup: ActivityGroupSchema,
  ActivityGroupMember: ActivityGroupMemberSchema,
  ModuleObjective: ModuleObjectiveSchema,
  Module: ModuleSchema,
  ModuleActivityLink: ModuleActivityLinkSchema,
  ModuleActivityGroupLink: ModuleActivityGroupLinkSchema,
  DesignNote: DesignNoteSchema,
  DesignFinding: DesignFindingSchema,
  Course: CourseSchema,
} as const;

export type DocumentClassName = keyof typeof DOCUMENT_SCHEMAS;
