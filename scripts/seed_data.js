/**
 * seed_data.js
 *
 * Inserts a complete demo artifact graph into the Armature database.
 * Course: "Introduction to AI for Instructional Designers"
 *
 * Graph structure:
 *   2 LearningNeeds → 2 DescriptiveEvidence (via NeedEvidenceLink)
 *   7 LearningObjectives (4 with PrerequisiteRecords)
 *   3 Modules → 3 Assessments → 7 ItemInstances
 *   6 AssessmentItems, each with embedded stem and 4 options (24 options)
 *   7 ModuleObjectives
 *   2 DesignNotes (one on an AssessmentItem, one on a ModuleObjective junction)
 *   1 DesignFinding (on the Draft item)
 *   1 Course
 *
 * Safe to re-run: clears existing instance data before inserting.
 *
 * Usage:
 *   node seed_data.js
 *
 * Environment variables (all have defaults for local dev):
 *   TERMINUS_URL    - TerminusDB server URL  (default: http://localhost:6363)
 *   TERMINUS_USER   - Admin username          (default: admin)
 *   TERMINUS_PASS   - Admin password          (default: admin)
 *   TERMINUS_DB     - Database name           (default: armature)
 */

import { WOQLClient } from "terminusdb";

const TERMINUS_URL  = process.env.TERMINUS_URL  || "http://localhost:6363";
const TERMINUS_USER = process.env.TERMINUS_USER || "admin";
const TERMINUS_PASS = process.env.TERMINUS_PASS || "admin";
const TERMINUS_DB   = process.env.TERMINUS_DB   || "armature";

// ---------------------------------------------------------------------------
// ID helpers
// Explicit @id values let us reference documents before they exist in the DB.
// TerminusDB uses the schema base URI + type/id pattern.
// Using short local IDs — TerminusDB resolves these against @base automatically.
// ---------------------------------------------------------------------------

const id = (type, key) => `${type}/${key}`;

// ---------------------------------------------------------------------------
// Seed documents
// Organized by type in dependency order (referenced docs defined before referencing docs)
// ---------------------------------------------------------------------------

const documents = [

  // -------------------------------------------------------------------------
  // Course
  // -------------------------------------------------------------------------

  {
    "@type": "Course",
    "@id": id("Course", "intro-ai-for-ids"),
    "label": "Introduction to AI for Instructional Designers",
    "description": "A foundational course helping instructional designers understand how AI systems work, apply AI tools effectively in learning design, and evaluate risks and ethical considerations.",
  },

  // -------------------------------------------------------------------------
  // Evidence
  // -------------------------------------------------------------------------

  {
    "@type": "DescriptiveEvidence",
    "@id": id("DescriptiveEvidence", "survey-ai-concepts"),
    "label": "ID Conference Survey: AI Conceptual Knowledge",
    "description": "Survey administered at a regional instructional design conference assessing baseline AI literacy.",
    "collectedAt": "2024-03-15T00:00:00Z",
    "source": "Regional ID Conference, Spring 2024",
    "method": "Survey",
    "finding": "In a survey of 47 instructional designers, 82% could not correctly distinguish between rule-based systems and machine learning models.",
  },

  {
    "@type": "DescriptiveEvidence",
    "@id": id("DescriptiveEvidence", "observation-ai-adoption"),
    "label": "Workplace Observation: AI Tool Adoption Practices",
    "description": "Structured observations of instructional designers using AI tools in three organizations.",
    "collectedAt": "2024-05-01T00:00:00Z",
    "source": "Workplace observation study, Q2 2024",
    "method": "Observation",
    "finding": "Instructional designers across three organizations consistently accepted AI-generated learning objectives without reviewing alignment to course goals.",
  },

  // -------------------------------------------------------------------------
  // Learning Needs
  // -------------------------------------------------------------------------

  {
    "@type": "LearningNeed",
    "@id": id("LearningNeed", "conceptual-gap"),
    "label": "Conceptual Gap: How AI Systems Work",
    "description": "Instructional designers lack foundational understanding of how AI systems work, leading to unrealistic expectations and poor vendor evaluation decisions.",
    "rationale": "Survey data shows the majority of practicing IDs cannot distinguish core AI paradigms, suggesting foundational knowledge is absent rather than merely incomplete.",
  },

  {
    "@type": "LearningNeed",
    "@id": id("LearningNeed", "application-gap"),
    "label": "Application Gap: Evaluating AI Output Quality",
    "description": "Instructional designers are adopting AI tools without frameworks for evaluating output quality or identifying appropriate use cases.",
    "rationale": "Observation data shows IDs accepting AI-generated content uncritically, suggesting absence of evaluative criteria rather than poor judgment.",
  },

  // -------------------------------------------------------------------------
  // Need–Evidence Links
  // -------------------------------------------------------------------------

  {
    "@type": "NeedEvidenceLink",
    "need": id("LearningNeed", "conceptual-gap"),
    "evidence": id("DescriptiveEvidence", "survey-ai-concepts"),
    "confidence": "High",
  },

  {
    "@type": "NeedEvidenceLink",
    "need": id("LearningNeed", "application-gap"),
    "evidence": id("DescriptiveEvidence", "observation-ai-adoption"),
    "confidence": "Medium",
  },

  // -------------------------------------------------------------------------
  // Learning Objectives
  // -------------------------------------------------------------------------

  // Module 1 objectives
  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "distinguish-ai-approaches"),
    "label": "Distinguish AI Approaches",
    "description": "Differentiate between rule-based systems and machine learning models.",
    "bloomsLevel": "Understand",
    "state": "Active",
    "generatedBy": id("LearningNeed", "conceptual-gap"),
  },

  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "describe-model-training"),
    "label": "Describe Model Training",
    "description": "Explain how a machine learning model learns from data.",
    "bloomsLevel": "Understand",
    "state": "Active",
    "generatedBy": id("LearningNeed", "conceptual-gap"),
  },

  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "identify-ai-limitations"),
    "label": "Identify AI Limitations",
    "description": "Identify inherent limitations of current AI systems including hallucination and bias.",
    "bloomsLevel": "Remember",
    "state": "Active",
    "generatedBy": id("LearningNeed", "conceptual-gap"),
  },

  // Module 2 objectives
  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "evaluate-ai-objectives"),
    "label": "Evaluate AI-Generated Objectives",
    "description": "Apply alignment criteria to assess the quality of AI-generated learning objectives.",
    "bloomsLevel": "Apply",
    "state": "Active",
    "generatedBy": id("LearningNeed", "application-gap"),
  },

  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "write-effective-prompts"),
    "label": "Write Effective Prompts",
    "description": "Construct prompts that produce instructionally sound AI-generated content.",
    "bloomsLevel": "Apply",
    "state": "Active",
    "generatedBy": id("LearningNeed", "application-gap"),
  },

  // Module 3 objectives
  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "distinguish-bias-types"),
    "label": "Distinguish Bias Types",
    "description": "Distinguish between training data bias and output bias in AI systems.",
    "bloomsLevel": "Analyze",
    "state": "Active",
    "generatedBy": id("LearningNeed", "conceptual-gap"),
  },

  {
    "@type": "LearningObjective",
    "@id": id("LearningObjective", "evaluate-appropriate-use"),
    "label": "Evaluate Appropriate AI Use",
    "description": "Evaluate whether a given instructional design task is appropriate for AI assistance.",
    "bloomsLevel": "Evaluate",
    "state": "Active",
    "generatedBy": id("LearningNeed", "application-gap"),
  },

  // -------------------------------------------------------------------------
  // Prerequisite Records
  // -------------------------------------------------------------------------

  {
    "@type": "PrerequisiteRecord",
    "label": "Model training requires understanding AI approaches",
    "rationale": "Understanding the distinction between rule-based and ML systems is necessary context for explaining how training works — without it, the concept of 'learning from data' has no meaningful contrast.",
    "prerequisiteType": "Hard",
    "objective": id("LearningObjective", "describe-model-training"),
    "prerequisite": id("LearningObjective", "distinguish-ai-approaches"),
  },

  {
    "@type": "PrerequisiteRecord",
    "label": "Evaluating AI objectives requires understanding AI approaches",
    "rationale": "Designers cannot meaningfully evaluate AI output quality without understanding what kind of system produced it and what its constraints are.",
    "prerequisiteType": "Soft",
    "objective": id("LearningObjective", "evaluate-ai-objectives"),
    "prerequisite": id("LearningObjective", "distinguish-ai-approaches"),
  },

  {
    "@type": "PrerequisiteRecord",
    "label": "Writing prompts requires ability to evaluate output",
    "rationale": "Effective prompt construction requires knowing how to recognize good output — designers need evaluative criteria before they can iterate prompts toward instructionally sound results.",
    "prerequisiteType": "Hard",
    "objective": id("LearningObjective", "write-effective-prompts"),
    "prerequisite": id("LearningObjective", "evaluate-ai-objectives"),
  },

  {
    "@type": "PrerequisiteRecord",
    "label": "Distinguishing bias types requires understanding model training",
    "rationale": "Training data bias and output bias are only meaningful distinctions if the learner understands the training pipeline — without that foundation the two categories collapse into a single vague concept.",
    "prerequisiteType": "Hard",
    "objective": id("LearningObjective", "distinguish-bias-types"),
    "prerequisite": id("LearningObjective", "describe-model-training"),
  },

  // -------------------------------------------------------------------------
  // Modules
  // -------------------------------------------------------------------------

  {
    "@type": "Module",
    "@id": id("Module", "how-ai-works"),
    "label": "How AI Systems Work",
    "description": "Foundational concepts: the distinction between rule-based and machine learning systems, how models are trained, and core limitations.",
    "sequence": 1,
    "course": id("Course", "intro-ai-for-ids"),
  },

  {
    "@type": "Module",
    "@id": id("Module", "ai-in-learning-design"),
    "label": "AI in Learning Design",
    "description": "Applying AI tools to instructional design tasks: evaluating AI-generated content and writing effective prompts.",
    "sequence": 2,
    "course": id("Course", "intro-ai-for-ids"),
  },

  {
    "@type": "Module",
    "@id": id("Module", "risks-and-ethics"),
    "label": "Risks and Ethical Use",
    "description": "Understanding bias in AI systems and evaluating the appropriateness of AI assistance for specific instructional design tasks.",
    "sequence": 3,
    "course": id("Course", "intro-ai-for-ids"),
  },

  // -------------------------------------------------------------------------
  // Module Objectives
  // -------------------------------------------------------------------------

  // Module 1
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "coverageStatus": "FullyAssessed",
    "sequence": 1,
    "module": id("Module", "how-ai-works"),
    "references": id("LearningObjective", "distinguish-ai-approaches"),
  },
  {
    "@type": "ModuleObjective",
    "@capture": "mo-how-ai-works-describe-model-training",
    "role": "Primary",
    "coverageStatus": "Uncovered",
    "sequence": 2,
    "module": id("Module", "how-ai-works"),
    "references": id("LearningObjective", "describe-model-training"),
  },
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "coverageStatus": "FullyAssessed",
    "sequence": 3,
    "module": id("Module", "how-ai-works"),
    "references": id("LearningObjective", "identify-ai-limitations"),
  },

  // Module 2
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "coverageStatus": "FullyAssessed",
    "sequence": 1,
    "module": id("Module", "ai-in-learning-design"),
    "references": id("LearningObjective", "evaluate-ai-objectives"),
  },
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "coverageStatus": "FullyAssessed",
    "sequence": 2,
    "module": id("Module", "ai-in-learning-design"),
    "references": id("LearningObjective", "write-effective-prompts"),
  },

  // Module 3
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "coverageStatus": "FullyAssessed",
    "sequence": 1,
    "module": id("Module", "risks-and-ethics"),
    "references": id("LearningObjective", "distinguish-bias-types"),
  },
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "coverageStatus": "FullyAssessed",
    "sequence": 2,
    "module": id("Module", "risks-and-ethics"),
    "references": id("LearningObjective", "evaluate-appropriate-use"),
  },

  // -------------------------------------------------------------------------
  // Assessments
  // -------------------------------------------------------------------------

  {
    "@type": "Assessment",
    "@id": id("Assessment", "mod1-assessment"),
    "label": "Module 1 Knowledge Check",
    "description": "Formative assessment covering AI system distinctions and core limitations.",
    "randomize": false,
    "passingScore": 0.7,
    "retakes": 2,
    "module": id("Module", "how-ai-works"),
  },

  {
    "@type": "Assessment",
    "@id": id("Assessment", "mod2-assessment"),
    "label": "Module 2 Application Check",
    "description": "Formative assessment covering evaluation of AI-generated objectives and prompt construction.",
    "randomize": false,
    "passingScore": 0.7,
    "retakes": 2,
    "module": id("Module", "ai-in-learning-design"),
  },

  {
    "@type": "Assessment",
    "@id": id("Assessment", "mod3-assessment"),
    "label": "Module 3 Capstone Assessment",
    "description": "Summative assessment covering bias identification, appropriate use evaluation, and prompt construction (item reuse from Module 2).",
    "randomize": true,
    "passingScore": 0.8,
    "retakes": 1,
    "module": id("Module", "risks-and-ethics"),
  },

  // -------------------------------------------------------------------------
  // Assessment Items
  // -------------------------------------------------------------------------

  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "distinguish-ai-mc"),
    "label": "Rule-based vs. ML distinction",
    "stem": { "@type": "TextFragment", "fragmentId": "distinguish-ai-mc-stem", "text": "Which of the following best describes the difference between a rule-based system and a machine learning model?" },
    "options": [
      { "@type": "ItemOption", "fragmentId": "distinguish-ai-mc-opt-a", "text": "A rule-based system learns patterns from data; a machine learning model follows hand-written logic.", "isCorrect": false, "feedback": "This reverses the two — rule-based systems use explicit logic, not learned patterns.", "purpose": "Targets the common reversal of which paradigm learns from data." },
      { "@type": "ItemOption", "fragmentId": "distinguish-ai-mc-opt-b", "text": "A rule-based system follows explicit, hand-written logic; a machine learning model learns patterns from data.", "isCorrect": true },
      { "@type": "ItemOption", "fragmentId": "distinguish-ai-mc-opt-c", "text": "Both learn from data, but rule-based systems need less of it.", "isCorrect": false, "feedback": "Rule-based systems do not learn from data at all — their logic is hand-coded." },
      { "@type": "ItemOption", "fragmentId": "distinguish-ai-mc-opt-d", "text": "Machine learning models are always more accurate than rule-based systems.", "isCorrect": false, "feedback": "Accuracy depends on the task and data, not the paradigm itself." },
    ],
    "incorrectFeedback": { "@type": "TextFragment", "fragmentId": "distinguish-ai-mc-fb-incorrect", "text": "Revisit the Module 1 reading on paradigms: the key difference is where the logic comes from." },
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [id("LearningObjective", "distinguish-ai-approaches")],
  },

  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "hallucination-mc"),
    "label": "AI hallucination definition",
    "stem": { "@type": "TextFragment", "fragmentId": "hallucination-mc-stem", "text": "What term describes an AI system confidently producing factually incorrect information?" },
    "options": [
      { "@type": "ItemOption", "fragmentId": "hallucination-mc-opt-a", "text": "Hallucination", "isCorrect": true },
      { "@type": "ItemOption", "fragmentId": "hallucination-mc-opt-b", "text": "Overfitting", "isCorrect": false, "feedback": "Overfitting describes a model that performs well on training data but poorly on new data." },
      { "@type": "ItemOption", "fragmentId": "hallucination-mc-opt-c", "text": "Bias", "isCorrect": false, "feedback": "Bias refers to systematic errors from flawed assumptions — distinct from confident fabrication." },
      { "@type": "ItemOption", "fragmentId": "hallucination-mc-opt-d", "text": "Underfitting", "isCorrect": false, "feedback": "Underfitting describes a model that fails to capture patterns in its training data." },
    ],
    "status": "Draft",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Remember",
    "assesses": [id("LearningObjective", "identify-ai-limitations")],
  },

  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "evaluate-objective-mc"),
    "label": "Identifying an unmeasurable objective",
    "stem": { "@type": "TextFragment", "fragmentId": "evaluate-objective-mc-stem", "text": "An AI tool generates this objective: 'Learners will understand AI.' Which criterion does it most clearly violate?" },
    "options": [
      { "@type": "ItemOption", "fragmentId": "evaluate-objective-mc-opt-a", "text": "It is not measurable: no observable behaviour is named.", "isCorrect": true },
      { "@type": "ItemOption", "fragmentId": "evaluate-objective-mc-opt-b", "text": "Its Bloom level is too low for a professional audience.", "isCorrect": false, "feedback": "'Understand' is a mid-level Bloom's verb — the problem is that it is not measurable, not that the level is wrong.", "purpose": "Targets confusing Bloom level with measurability." },
      { "@type": "ItemOption", "fragmentId": "evaluate-objective-mc-opt-c", "text": "Its scope is too broad to cover in one course.", "isCorrect": false, "feedback": "The objective covers only one concept (AI) — scope is not the primary issue here." },
      { "@type": "ItemOption", "fragmentId": "evaluate-objective-mc-opt-d", "text": "It states no conditions under which the behaviour is performed.", "isCorrect": false, "feedback": "Missing conditions are a concern, but the more fundamental problem is the unmeasurable verb." },
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Apply",
    "assesses": [id("LearningObjective", "evaluate-ai-objectives")],
  },

  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "effective-prompt-mc"),
    "label": "Identifying an effective prompt",
    "stem": { "@type": "TextFragment", "fragmentId": "effective-prompt-mc-stem", "text": "Which prompt is most likely to produce a measurable learning objective from an AI tool?" },
    "options": [
      { "@type": "ItemOption", "fragmentId": "effective-prompt-mc-opt-a", "text": "\"Write a learning objective about machine learning.\"", "isCorrect": false, "feedback": "This prompt specifies a topic but provides no cognitive level, audience, or context for the AI to work with." },
      { "@type": "ItemOption", "fragmentId": "effective-prompt-mc-opt-b", "text": "\"Write a learning objective for a corporate training course.\"", "isCorrect": false, "feedback": "Naming a course type adds some context but still leaves cognitive level and audience unspecified." },
      { "@type": "ItemOption", "fragmentId": "effective-prompt-mc-opt-c", "text": "\"Write a measurable learning objective at the Apply level for instructional designers new to machine learning, using an observable verb.\"", "isCorrect": true },
      { "@type": "ItemOption", "fragmentId": "effective-prompt-mc-opt-d", "text": "\"Write a document.\"", "isCorrect": false, "feedback": "This provides no constraints — the AI has nothing to work with beyond the document type." },
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Apply",
    "assesses": [id("LearningObjective", "write-effective-prompts")],
  },

  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "bias-type-mc"),
    "label": "Identifying training data bias",
    "stem": { "@type": "TextFragment", "fragmentId": "bias-type-mc-stem", "text": "A facial recognition system trained primarily on images of light-skinned faces performs poorly on darker-skinned faces. What type of bias does this best illustrate?" },
    "options": [
      { "@type": "ItemOption", "fragmentId": "bias-type-mc-opt-a", "text": "Training data bias", "isCorrect": true },
      { "@type": "ItemOption", "fragmentId": "bias-type-mc-opt-b", "text": "Output bias", "isCorrect": false, "feedback": "Output bias refers to systematic skew in what the model produces, not in what it was trained on." },
      { "@type": "ItemOption", "fragmentId": "bias-type-mc-opt-c", "text": "Confirmation bias", "isCorrect": false, "feedback": "Confirmation bias is a human cognitive pattern — not an AI system characteristic." },
      { "@type": "ItemOption", "fragmentId": "bias-type-mc-opt-d", "text": "Automation bias", "isCorrect": false, "feedback": "Automation bias describes human over-reliance on automated systems — not a property of the system itself." },
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Analyze",
    "assesses": [id("LearningObjective", "distinguish-bias-types")],
  },

  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "appropriate-use-mc"),
    "label": "Evaluating appropriate AI use in sensitive content",
    "stem": { "@type": "TextFragment", "fragmentId": "appropriate-use-mc-stem", "text": "An instructional designer is developing a sensitive course on workplace harassment. Which task is LEAST appropriate for AI assistance?" },
    "options": [
      { "@type": "ItemOption", "fragmentId": "appropriate-use-mc-opt-a", "text": "Drafting the module outline", "isCorrect": false, "feedback": "Generating a structural outline is a low-risk task with no sensitive content generation required." },
      { "@type": "ItemOption", "fragmentId": "appropriate-use-mc-opt-b", "text": "Suggesting background reading", "isCorrect": false, "feedback": "Source suggestions are low-stakes and easily reviewed — appropriate for AI assistance." },
      { "@type": "ItemOption", "fragmentId": "appropriate-use-mc-opt-c", "text": "Generating realistic harassment scenarios for the case studies", "isCorrect": true },
      { "@type": "ItemOption", "fragmentId": "appropriate-use-mc-opt-d", "text": "Formatting the final handout", "isCorrect": false, "feedback": "Formatting is a mechanical task with no content sensitivity — well-suited for AI assistance." },
    ],
    "status": "InReview",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Evaluate",
    "assesses": [id("LearningObjective", "evaluate-appropriate-use")],
  },

  // -------------------------------------------------------------------------
  // Item Instances
  // -------------------------------------------------------------------------

  // Module 1 assessment
  { "@type": "ItemInstance", "sequence": 1, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "mod1-assessment"), "implements": id("AssessmentItem", "distinguish-ai-mc") },
  { "@type": "ItemInstance", "sequence": 2, "pointValue": 1, "randomize": true, "status": "Draft", "assessment": id("Assessment", "mod1-assessment"), "implements": id("AssessmentItem", "hallucination-mc") },

  // Module 2 assessment
  { "@type": "ItemInstance", "sequence": 1, "pointValue": 2, "randomize": true, "status": "Approved", "assessment": id("Assessment", "mod2-assessment"), "implements": id("AssessmentItem", "evaluate-objective-mc") },
  { "@type": "ItemInstance", "sequence": 2, "pointValue": 2, "randomize": true, "status": "Approved", "assessment": id("Assessment", "mod2-assessment"), "implements": id("AssessmentItem", "effective-prompt-mc") },

  // Module 3 capstone — note item 4 (effective-prompt-mc) reused here
  { "@type": "ItemInstance", "sequence": 1, "pointValue": 2, "randomize": true, "status": "Approved", "assessment": id("Assessment", "mod3-assessment"), "implements": id("AssessmentItem", "bias-type-mc") },
  { "@type": "ItemInstance", "sequence": 2, "pointValue": 3, "randomize": true, "status": "InReview", "assessment": id("Assessment", "mod3-assessment"), "implements": id("AssessmentItem", "appropriate-use-mc") },
  { "@type": "ItemInstance", "sequence": 3, "pointValue": 2, "randomize": true, "status": "Approved", "assessment": id("Assessment", "mod3-assessment"), "implements": id("AssessmentItem", "effective-prompt-mc") },

  // -------------------------------------------------------------------------
  // Design Note
  // -------------------------------------------------------------------------

  {
    "@type": "DesignNote",
    "@id": id("DesignNote", "item6-authoring-rationale"),
    "label": "Rationale for human-authored harassment scenarios",
    "description": "Design note on assessment item: Evaluating appropriate AI use in sensitive content.",
    "rationale": "Unable to find literature on prompting AI to generate descriptions of inappropriate behavior. Scenarios authored manually to ensure accuracy, sensitivity, and instructional appropriateness.",
    "category": "AssessmentStrategyChoice",
    "subject": [id("AssessmentItem", "appropriate-use-mc")],
  },

  // A note on a relationship, not an artifact: why this objective is declared with no item yet (ADR-0017).
  // The subject is the ModuleObjective captured above; @ref resolves to the id the store mints for it.
  {
    "@type": "DesignNote",
    "@id": id("DesignNote", "model-training-declared-unassessed"),
    "label": "Model training declared Primary ahead of its assessment",
    "description": "Design note on the module declaration of 'Describe Model Training' in How AI Systems Work.",
    "rationale": "Declared Primary now so the gap is visible in coverage. The item will be authored after the training-loop activity is scoped; writing it first risked assessing the wrong representation.",
    "category": "SequencingDecision",
    "subject": [{ "@ref": "mo-how-ai-works-describe-model-training" }],
  },

  // -------------------------------------------------------------------------
  // Design Finding
  // -------------------------------------------------------------------------

  // Why hallucination-mc is still Draft: a reviewer flagged the stem (ADR-0020).
  {
    "@type": "DesignFinding",
    "@id": id("DesignFinding", "hallucination-stem-cues-answer"),
    "label": "Stem may cue the correct option",
    "description": "Expert-review finding on assessment item: AI hallucination definition.",
    "finding": "The stem's phrase 'confidently producing factually incorrect information' is close to the textbook definition the correct option restates, so the item may test recognition of wording rather than the concept.",
    "subject": [id("AssessmentItem", "hallucination-mc")],
    "regarding": id("LearningObjective", "identify-ai-limitations"),
    "confidence": "Medium",
    "status": "Open",
  },

];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const client = new WOQLClient(TERMINUS_URL, {
    user: TERMINUS_USER,
    key:  TERMINUS_PASS,
    organization: "admin",
  });
  client.db(TERMINUS_DB);

  console.log(`Seeding "${TERMINUS_DB}" at ${TERMINUS_URL}`);
  console.log(`  → ${documents.length} documents to insert\n`);

  // full_replace on the instance graph deletes every existing instance document
  // and inserts the seed in one transaction, so re-runs are clean and idempotent.
  // The commit message is addDocument's fourth positional argument; the client has
  // no commit_info parameter (an earlier version passed one, which was ignored, and
  // the string "replace" became the commit message).
  console.log("Replacing instance data with the seed...");
  await client.addDocument(
    documents,
    { full_replace: true },
    null,
    "Seed demo data: Introduction to AI for Instructional Designers",
  );

  console.log(`  → Done.\n`);
  console.log(`GraphQL endpoint: http://127.0.0.1:6363/api/graphql/admin/armature`);
}

main().catch(err => {
  console.error("\nError:", err.message || err);
  if (err.data) console.error("Details:", JSON.stringify(err.data, null, 2));
  process.exit(1);
});
