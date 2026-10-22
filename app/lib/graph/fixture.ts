/**
 * A small graph for the derivation, relation and layout tests: one of every
 * drawing case (a person, a course and module, evidence and a need with their
 * link, two objectives with a prerequisite, an aligned and an unaligned item, a
 * placement, a declaration, an attestation on one part, a note with an
 * unresolved subject, a dataset and a metric). Field names and classes are the
 * schema's; the ids are short.
 */
import type { Doc } from './derive';

export const USER = 'User/u';

export const FIXTURE: Doc[] = [
  { '@id': USER, '@type': 'User', displayName: 'A person', externalId: 'person@example.edu' },
  { '@id': 'Course/c', '@type': 'Course', label: 'The course', createdBy: USER },
  { '@id': 'Module/m', '@type': 'Module', label: 'Module one', course: 'Course/c', sequence: 1, createdBy: USER },
  { '@id': 'DescriptiveEvidence/e', '@type': 'DescriptiveEvidence', label: 'A survey', method: 'Survey' },
  { '@id': 'LearningNeed/n', '@type': 'LearningNeed', label: 'A need', priority: 'High' },
  { '@id': 'NeedEvidenceLink/ne', '@type': 'NeedEvidenceLink', need: 'LearningNeed/n', evidence: 'DescriptiveEvidence/e', confidence: 'High' },
  { '@id': 'LearningObjective/o1', '@type': 'LearningObjective', label: 'Objective one', bloomsLevel: 'Analyze', state: 'Active', generatedBy: 'LearningNeed/n' },
  { '@id': 'LearningObjective/o2', '@type': 'LearningObjective', label: 'Objective two', state: 'Active' },
  { '@id': 'PrerequisiteRecord/pr', '@type': 'PrerequisiteRecord', objective: 'LearningObjective/o2', prerequisite: 'LearningObjective/o1', prerequisiteType: 'Required' },
  { '@id': 'AssessmentItem/i1', '@type': 'AssessmentItem', label: 'Item one', status: 'Approved', bloomsLevel: 'Analyze', assesses: ['LearningObjective/o1', 'LearningObjective/o2'] },
  { '@id': 'AssessmentItem/i2', '@type': 'AssessmentItem', label: 'A draft item', status: 'Draft' },
  { '@id': 'Assessment/a', '@type': 'Assessment', label: 'A quiz', module: 'Module/m' },
  { '@id': 'ItemInstance/p', '@type': 'ItemInstance', assessment: 'Assessment/a', implements: 'AssessmentItem/i1', status: 'Approved', sequence: 1 },
  { '@id': 'ModuleObjective/mo', '@type': 'ModuleObjective', module: 'Module/m', references: 'LearningObjective/o1', role: 'Primary', sequence: 1 },
  { '@id': 'Attestation/at', '@type': 'Attestation', subject: 'AssessmentItem/i1', attestedBy: USER, verdict: 'Affirmed', fragmentId: 'stem', asOf: 'abcdefabcdefabcdef' },
  { '@id': 'DesignNote/note', '@type': 'DesignNote', label: 'A note', subject: ['AssessmentItem/i1', 'Missing/x'] },
  { '@id': 'LearningDataset/d', '@type': 'LearningDataset', label: 'A pilot', producedBy: 'Assessment/a', cohort: 'Pilot', asOf: 'abcdefabcdefabcdef' },
  { '@id': 'LearningMetric/mt', '@type': 'LearningMetric', label: 'Difficulty', subject: 'AssessmentItem/i1', derivedFrom: 'LearningDataset/d', value: 0.38, unit: 'proportion correct', asOf: 'abcdefabcdefabcdef' },
];
