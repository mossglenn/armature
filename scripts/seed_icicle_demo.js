/**
 * seed_icicle_demo.js
 *
 * The "inherited module" for the ICICLE Design SIG demo, Version C: a change
 * to one objective in Module 1 quietly breaks an assumption Module 2 was built
 * on, and the PrerequisiteRecord between them says so in its own rationale.
 *
 * Course: "First-Year Information Literacy" (sample data, not a real course)
 *
 * Graph structure:
 *   4 Users: the demo designer (you, holding the grants), the former designer
 *     who authored the design (so it reads as inherited), an SME reviewer, and
 *     the design assistant, an agent (externalId agent:armature-mcp, as the MCP
 *     server's plan names it) seeded with a readable id so its commits read as
 *     "design-assistant" in the History tab, where one registered through
 *     POST /users would read as a random id
 *   1 LearningNeed ← 1 DescriptiveEvidence (via NeedEvidenceLink); sample wording
 *   4 LearningObjectives: three in Module 1, one in Module 2
 *   2 Modules → 2 Assessments → 7 ItemInstances
 *   8 AssessmentItems: six in the Module 1 check, one practice item used
 *     inside the lateral-reading activity (ActivityItemLink), one in the Module 2
 *     check
 *   4 ModuleObjectives (Module 1 FullyAssessed on every objective; Module 2,
 *     only sketched, PartiallyAssessed)
 *   4 LearningActivities, each linked to its module
 *   1 PrerequisiteRecord: Module 2's tracing objective requires Module 1's
 *     lateral-reading check, with the rationale that carries the hidden ripple
 *   2 DesignNotes: why C is the key of the .org item, and why the
 *     lateral-reading objective is Apply rather than Evaluate
 *   1 Attestation: the SME affirms the .org item's key (a later commit, so its
 *     asOf can name the commit it judged; ADR-0028)
 *   2 Grants: the demo designer as Administrator and as Maintainer of every
 *     branch, as in seed_data.js
 *
 * Commits, oldest first, each by the person who made it (COMMITS, below), so
 * the branch's history is the former designer's trail and the reviewer's:
 *   1. Module 1 designed (the former designer)
 *   2. Module 2 sketched, built on Module 1's quick check (the former designer)
 *   3. SME review: the .org item's key affirmed (the reviewer)
 *
 * Every rule the hub enforces holds over this seed: run the operator's `check`
 * after seeding.
 *
 * DESTRUCTIVE, like seed_data.js: it replaces every instance document in the
 * database. Run it only on a demo instance:
 *   docker compose run --rm operator node load_schema.js --recreate
 *   docker compose run --rm operator node seed_icicle_demo.js
 *
 * Environment variables (all have defaults for local dev):
 *   TERMINUS_URL    - TerminusDB server URL  (default: http://localhost:6363)
 *   TERMINUS_USER   - Admin username          (default: admin)
 *   TERMINUS_PASS   - Admin password          (default: admin)
 *   TERMINUS_DB     - Database name           (default: armature)
 *
 * The module also exports its commits and the beat-3 change, so a rehearsal
 * or a test (app/lib/api/icicleDemo.test.ts) loads exactly what this seed
 * writes, authors included. The demonstration's script is
 * docs/icicle-demo-script.md.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const id = (type, key) => `${type}/${key}`;

// The classes that carry createdBy, read from the schema, as in seed_data.js.
const schemaClasses = Object.fromEntries(
  JSON.parse(readFileSync(new URL("../schema/schema.json", import.meta.url), "utf8"))
    .filter((c) => c["@type"] === "Class")
    .map((c) => [c["@id"], c]),
);
const carriesCreatedBy = (name) => {
  const c = schemaClasses[name];
  if (!c) return false;
  const parents = [c["@inherits"] ?? []].flat();
  return "createdBy" in c || parents.some(carriesCreatedBy);
};
// The design was authored by the former designer: that is what makes it inherited.
export const authored = (docs) =>
  docs.map((d) => (carriesCreatedBy(d["@type"]) && d.createdBy === undefined ? { ...d, createdBy: id("User", "former-designer") } : d));

// ---------------------------------------------------------------------------
// Ids used across the documents, the change and the demo script
// ---------------------------------------------------------------------------

export const IDS = {
  course: id("Course", "first-year-info-lit"),
  module1: id("Module", "checking-sources"),
  module2: id("Module", "tracing-claims"),
  o1: id("LearningObjective", "lateral-reading-check"),
  o2: id("LearningObjective", "who-runs-a-site"),
  o3: id("LearningObjective", "recognize-sponsored-content"),
  o4: id("LearningObjective", "trace-viral-claim"),
  orgItem: id("AssessmentItem", "org-site-first-step"),
  assistant: id("User", "design-assistant"),
  practiceItem: id("AssessmentItem", "practice-who-runs-alliance"),
  tracingSprint: id("LearningActivity", "claim-tracing-sprint"),
};

// A ModuleObjective is Hash-keyed on (module, references); a DesignNote cannot
// name one in the same commit without @capture, and none is needed: the role
// rationale lives on the declaration itself.
const option = (item, letter, text, isCorrect, extra = {}) => ({
  "@type": "ItemOption",
  "fragmentId": `${item}-opt-${letter}`,
  "text": text,
  "isCorrect": isCorrect,
  ...extra,
});
const fragment = (item, part, text) => ({ "@type": "TextFragment", "fragmentId": `${item}-${part}`, "text": text });

// ---------------------------------------------------------------------------
// Commit 1: Module 1 designed
// ---------------------------------------------------------------------------

export const module1 = [

  // People ------------------------------------------------------------------

  {
    "@type": "User",
    "@id": id("User", "demo-designer"),
    "displayName": "Demo Designer",
    "externalId": "demo-designer@example.edu",
    "email": "demo-designer@example.edu",
    "institution": "Example University",
  },
  {
    "@type": "User",
    "@id": id("User", "former-designer"),
    "displayName": "Former Designer",
    "externalId": "former-designer@example.edu",
    "email": "former-designer@example.edu",
    "institution": "Example University",
  },
  {
    "@type": "User",
    "@id": id("User", "demo-reviewer"),
    "displayName": "Demo Reviewer",
    "externalId": "demo-reviewer@example.edu",
    "email": "demo-reviewer@example.edu",
    "institution": "Partner College",
  },
  // An agent: the hub knows one by its externalId's agent: prefix (ADR-0067 decision 3).
  {
    "@type": "User",
    "@id": IDS.assistant,
    "displayName": "Design assistant (AI)",
    "externalId": "agent:armature-mcp",
  },

  // Course, evidence, need --------------------------------------------------

  {
    "@type": "Course",
    "@id": IDS.course,
    "label": "First-Year Information Literacy",
    "description": "A first-year course on checking sources before citing them: lateral reading, who is behind a source, sponsored content, and tracing claims. Sample data for a demonstration.",
  },
  {
    "@type": "DescriptiveEvidence",
    "@id": id("DescriptiveEvidence", "liaison-bibliography-review"),
    "label": "Library liaison review of first-year bibliographies",
    "description": "Illustrative evidence, written for this sample course.",
    "collectedAt": "2026-02-10T00:00:00Z",
    "source": "Library liaison review (illustrative)",
    "method": "DocumentReview",
    "finding": "Liaisons reviewing first-year research bibliographies regularly found web sources cited without any sign the student had checked who was behind them.",
  },
  {
    "@type": "LearningNeed",
    "@id": id("LearningNeed", "unvetted-sources"),
    "label": "First-year students cite web sources they haven't vetted",
    "description": "First-year students cite web sources in research assignments without checking who is behind them or what others say about them.",
    "rationale": "Library liaisons report unvetted web sources in first-year research assignments; the habit to build is checking before citing, not memorizing a checklist.",
    "priority": "High",
  },
  {
    "@type": "NeedEvidenceLink",
    "need": id("LearningNeed", "unvetted-sources"),
    "evidence": id("DescriptiveEvidence", "liaison-bibliography-review"),
    "confidence": "Medium",
  },

  // Objectives (Module 1) ---------------------------------------------------

  {
    "@type": "LearningObjective",
    "@id": IDS.o1,
    "label": "Check a website with lateral reading",
    "description": "Check an unfamiliar website using lateral reading: leave the page and see what other sources say about it.",
    "bloomsLevel": "Apply",
    "state": "Active",
    "generatedBy": id("LearningNeed", "unvetted-sources"),
  },
  {
    "@type": "LearningObjective",
    "@id": IDS.o2,
    "label": "Identify who runs a website",
    "description": "Identify who owns or funds a website.",
    "bloomsLevel": "Understand",
    "state": "Active",
    "generatedBy": id("LearningNeed", "unvetted-sources"),
  },
  {
    "@type": "LearningObjective",
    "@id": IDS.o3,
    "label": "Recognize sponsored content",
    "description": "Recognize sponsored content and native advertising.",
    "bloomsLevel": "Understand",
    "state": "Active",
    "generatedBy": id("LearningNeed", "unvetted-sources"),
  },

  // Module 1 and its declarations -------------------------------------------

  {
    "@type": "Module",
    "@id": IDS.module1,
    "label": "Checking sources online",
    "description": "The quick habits that most improve first-year source choices: lateral reading, finding who is behind a site, and spotting sponsored content.",
    "sequence": 1,
    "course": IDS.course,
  },
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "sequence": 1,
    "roleRationale": "Primary: the fastest habit that most improves first-year source choices.",
    "module": IDS.module1,
    "references": IDS.o1,
  },
  {
    "@type": "ModuleObjective",
    "role": "Supporting",
    "sequence": 2,
    "roleRationale": "Supports the check: knowing who is behind a site tells you what to search for.",
    "module": IDS.module1,
    "references": IDS.o2,
  },
  {
    "@type": "ModuleObjective",
    "role": "Supporting",
    "sequence": 3,
    "roleRationale": "Sponsored posts are where first-years most often mistake marketing for reporting.",
    "module": IDS.module1,
    "references": IDS.o3,
  },

  // Module 1 check ----------------------------------------------------------

  {
    "@type": "Assessment",
    "@id": id("Assessment", "m1-check"),
    "label": "Module 1 check",
    "description": "Six items, two per objective, on checking sources online.",
    "randomize": true,
    "passingScore": 0.7,
    "retakes": 2,
    "module": IDS.module1,
  },

  // The .org item: the one on slide 2 of the deck.
  {
    "@type": "AssessmentItem",
    "@id": IDS.orgItem,
    "label": "The .org item: first step with an unfamiliar website",
    "stem": fragment("org-site-first-step", "stem", "A website has a .org address, a polished design, and no author listed. What should you do first?"),
    "options": [
      option("org-site-first-step", "a", "Trust it, since .org means nonprofit", false, { "feedback": "Anyone can register a .org. The domain tells you little.", "purpose": "Misconception: the domain signals credibility." }),
      option("org-site-first-step", "b", "Read its About page", false, { "feedback": "The About page is what the site says about itself. Check what others say first.", "purpose": "Vertical reading: trusting the site's account of itself." }),
      option("org-site-first-step", "c", "Search what other sources say about the site", true, { "feedback": "Right. Fact-checkers leave the page to see what others say about it.", "purpose": "Lateral reading." }),
      option("org-site-first-step", "d", "Check it for typos", false, { "feedback": "Polish and typos say little about reliability.", "purpose": "Surface cue: polish as a proxy for credibility." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Apply",
    "assesses": [IDS.o1],
  },
  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "healthy-living-post"),
    "label": "Before reading a post that cites an unknown institute",
    "stem": fragment("healthy-living-post", "stem", "A post you want to share cites the \"Institute for Healthy Living.\" You have never heard of it. What do you do before reading the article?"),
    "options": [
      option("healthy-living-post", "a", "Read the article closely for signs of bias", false, { "feedback": "Reading closely keeps you on the page. Find out who the institute is first.", "purpose": "Vertical reading." }),
      option("healthy-living-post", "b", "Search the institute's name and see what others say about it", true, { "feedback": "Right. A quick search tells you who you are about to read." }),
      option("healthy-living-post", "c", "Check whether the article cites its sources", false, { "feedback": "Citations on the page are still the page's account of itself.", "purpose": "Vertical reading: trusting on-page signals." }),
      option("healthy-living-post", "d", "Look at how many times it has been shared", false, { "feedback": "Popularity says nothing about who is behind it.", "purpose": "Social proof as a credibility cue." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Apply",
    "assesses": [IDS.o1],
  },
  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "funding-clue"),
    "label": "Which clue shows who funds a site",
    "stem": fragment("funding-clue", "stem", "Which clue tells you most about who funds a website?"),
    "options": [
      option("funding-clue", "a", "The site's color scheme", false, { "feedback": "Design choices say nothing about funding." }),
      option("funding-clue", "b", "A list of donors or a \"Supported by\" line", true, { "feedback": "Right. Then check what others say about those funders." }),
      option("funding-clue", "c", "The number of articles on the site", false, { "feedback": "Volume is not a clue to funding." }),
      option("funding-clue", "d", "The domain ending", false, { "feedback": "Anyone can register most domain endings.", "purpose": "Misconception: the domain signals who is behind a site." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [IDS.o2],
  },
  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "find-site-owner"),
    "label": "Most reliable way to learn who is behind a site",
    "stem": fragment("find-site-owner", "stem", "Which is the most reliable way to learn who is behind a website?"),
    "options": [
      option("find-site-owner", "a", "The site's About page alone", false, { "feedback": "The About page is the site describing itself." }),
      option("find-site-owner", "b", "What independent sources report about the organization", true, { "feedback": "Right. Independent reporting is harder to fake than a self-description." }),
      option("find-site-owner", "c", "The site's logo", false, { "feedback": "A logo is branding, not ownership." }),
      option("find-site-owner", "d", "Its social media follower count", false, { "feedback": "Followers measure reach, not who runs it." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [IDS.o2],
  },
  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "which-post-sponsored"),
    "label": "Which post is sponsored",
    "stem": fragment("which-post-sponsored", "stem", "Which of these posts is most likely sponsored content?"),
    "options": [
      option("which-post-sponsored", "a", "A news story with a reporter's byline", false, { "feedback": "A byline marks reporting, not advertising." }),
      option("which-post-sponsored", "b", "An article labeled \"Paid partnership\" that praises one product", true, { "feedback": "Right. The label and the single product are the giveaways." }),
      option("which-post-sponsored", "c", "An opinion column labeled \"Opinion\"", false, { "feedback": "Opinion is labeled, but it is not paid placement." }),
      option("which-post-sponsored", "d", "A wire-service report", false, { "feedback": "Wire reports are news, distributed to many outlets." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [IDS.o3],
  },
  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "native-ad-label"),
    "label": "The label that marks native advertising",
    "stem": fragment("native-ad-label", "stem", "Which label usually marks native advertising?"),
    "options": [
      option("native-ad-label", "a", "Sponsored", true, { "feedback": "Right. \"Sponsored\" or \"Paid\" marks content someone paid to place." }),
      option("native-ad-label", "b", "Analysis", false, { "feedback": "\"Analysis\" marks interpretive journalism." }),
      option("native-ad-label", "c", "Breaking", false, { "feedback": "\"Breaking\" marks timely news." }),
      option("native-ad-label", "d", "Explainer", false, { "feedback": "\"Explainer\" marks background journalism." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [IDS.o3],
  },

  // The practice item, used inside the lateral-reading activity. In Version C
  // its feedback is neutral; Version A would plant the ripple here.
  {
    "@type": "AssessmentItem",
    "@id": IDS.practiceItem,
    "label": "Practice: who runs the Alliance for Balanced Nutrition?",
    "stem": fragment("practice-who-runs-alliance", "stem", "Practice: an article cites the \"Alliance for Balanced Nutrition.\" What is the fastest way to find out who runs it?"),
    "options": [
      option("practice-who-runs-alliance", "a", "Read the Alliance's mission statement", false, { "feedback": "That is what the Alliance says about itself." }),
      option("practice-who-runs-alliance", "b", "Search the Alliance's name and see who reports funding it", true, { "feedback": "Right. That's where to start." }),
      option("practice-who-runs-alliance", "c", "Check whether its website looks professional", false, { "feedback": "A professional look is cheap to produce." }),
      option("practice-who-runs-alliance", "d", "See whether the article sounds neutral", false, { "feedback": "A neutral tone can hide an interested funder." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [IDS.o2],
  },

  { "@type": "ItemInstance", "sequence": 1, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "m1-check"), "implements": IDS.orgItem },
  { "@type": "ItemInstance", "sequence": 2, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "m1-check"), "implements": id("AssessmentItem", "healthy-living-post") },
  { "@type": "ItemInstance", "sequence": 3, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "m1-check"), "implements": id("AssessmentItem", "funding-clue") },
  { "@type": "ItemInstance", "sequence": 4, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "m1-check"), "implements": id("AssessmentItem", "find-site-owner") },
  { "@type": "ItemInstance", "sequence": 5, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "m1-check"), "implements": id("AssessmentItem", "which-post-sponsored") },
  { "@type": "ItemInstance", "sequence": 6, "pointValue": 1, "randomize": true, "status": "Approved", "assessment": id("Assessment", "m1-check"), "implements": id("AssessmentItem", "native-ad-label") },

  // Module 1 activities -----------------------------------------------------

  {
    "@type": "LearningActivity",
    "@id": id("LearningActivity", "lateral-reading-practice"),
    "label": "Lateral reading practice",
    "description": "Learners practice lateral reading on five unfamiliar sites: open a new tab, search the site or organization, and decide where to look next.",
    "activityType": "Practice",
    "targets": [IDS.o1],
  },
  {
    "@type": "LearningActivity",
    "@id": id("LearningActivity", "whos-behind-it"),
    "label": "Who's behind it? A worked example",
    "description": "A worked example that follows one site from its About page to independent reporting on who funds it.",
    "activityType": "WorkedExample",
    "targets": [IDS.o2],
  },
  {
    "@type": "LearningActivity",
    "@id": id("LearningActivity", "spot-sponsored-post"),
    "label": "Spot the sponsored post",
    "description": "Learners sort six posts into sponsored and editorial, then discuss the cues that gave each away.",
    "activityType": "Discussion",
    "targets": [IDS.o3],
  },
  { "@type": "ModuleActivityLink", "sequence": 1, "module": IDS.module1, "activity": id("LearningActivity", "lateral-reading-practice") },
  { "@type": "ModuleActivityLink", "sequence": 2, "module": IDS.module1, "activity": id("LearningActivity", "whos-behind-it") },
  { "@type": "ModuleActivityLink", "sequence": 3, "module": IDS.module1, "activity": id("LearningActivity", "spot-sponsored-post") },
  { "@type": "ActivityItemLink", "sequence": 1, "activity": id("LearningActivity", "lateral-reading-practice"), "item": IDS.practiceItem },

  // The reasons -------------------------------------------------------------

  // The why that beat 2's answer cites.
  {
    "@type": "DesignNote",
    "@id": id("DesignNote", "org-item-key-rationale"),
    "label": "Why C is the key of the .org item",
    "description": "Design note on assessment item: the .org item.",
    "rationale": "Key is C. Fact-checkers leave a page to see what others say about it (lateral reading); novices judge the page itself. A, B and D are the vertical-reading moves first-years make.",
    "category": "AssessmentStrategyChoice",
    "subject": [IDS.orgItem],
  },
  // The former designer's level choice: the reason the change in beat 3 overturns.
  {
    "@type": "DesignNote",
    "@id": id("DesignNote", "lateral-reading-level-choice"),
    "label": "Apply, not Evaluate, on purpose",
    "description": "Design note on the lateral-reading objective's Bloom's level.",
    "rationale": "Apply, not Evaluate, on purpose: first-years need a fast habit of leaving the page before they can weigh what they find.",
    "category": "BloomsLevelChoice",
    "subject": [IDS.o1],
  },

  // Grants (ADR-0068 decision 6), as in seed_data.js ------------------------

  {
    "@type": "Grant",
    "user": id("User", "demo-designer"),
    "role": "Administrator",
    "status": "Active",
    "rationale": "The instance's first administrator, from the seed.",
  },
  {
    "@type": "Grant",
    "user": id("User", "demo-designer"),
    "role": "Maintainer",
    "status": "Active",
    "rationale": "Maintains every branch, so the demonstration needs no further grants.",
  },
];

// ---------------------------------------------------------------------------
// Commit 2: Module 2 sketched, built on Module 1's quick check
// ---------------------------------------------------------------------------

export const module2 = [
  {
    "@type": "LearningObjective",
    "@id": IDS.o4,
    "label": "Trace a viral claim to its source",
    "description": "Trace a viral claim to its original source.",
    "bloomsLevel": "Apply",
    "state": "Active",
    "generatedBy": id("LearningNeed", "unvetted-sources"),
  },
  {
    "@type": "Module",
    "@id": IDS.module2,
    "label": "Tracing claims",
    "description": "Following a claim back through the sources that repeat it to the one that made it.",
    "sequence": 2,
    "course": IDS.course,
  },
  {
    "@type": "ModuleObjective",
    "role": "Primary",
    "sequence": 1,
    "roleRationale": "Primary: tracing is the skill the course builds toward.",
    "module": IDS.module2,
    "references": IDS.o4,
  },

  // THE HIDDEN RIPPLE: the relationship carries the assumption in its rationale.
  {
    "@type": "PrerequisiteRecord",
    "label": "Tracing claims requires the quick lateral check",
    "rationale": "Tracing chains several quick lateral checks in a row. Module 2 allows about two minutes per hop and does not reteach the check.",
    "prerequisiteType": "Hard",
    "objective": IDS.o4,
    "prerequisite": IDS.o1,
  },

  {
    "@type": "Assessment",
    "@id": id("Assessment", "m2-check"),
    "label": "Module 2 check",
    "description": "Sketched: one item so far.",
    "randomize": false,
    "passingScore": 0.7,
    "retakes": 2,
    "module": IDS.module2,
  },
  {
    "@type": "AssessmentItem",
    "@id": id("AssessmentItem", "first-step-tracing"),
    "label": "First step in tracing a viral claim",
    "stem": fragment("first-step-tracing", "stem", "A viral post says \"a new study proves\" a claim. What is your first step in tracing it?"),
    "options": [
      option("first-step-tracing", "a", "Find the study the post refers to", true, { "feedback": "Right. Go upstream toward the original source." }),
      option("first-step-tracing", "b", "Look for other posts making the same claim", false, { "feedback": "Repetition is not confirmation; they may share one source." }),
      option("first-step-tracing", "c", "Decide whether the claim seems plausible", false, { "feedback": "Plausibility is a judgment about the claim, not a trace of its source." }),
      option("first-step-tracing", "d", "Check the poster's follower count", false, { "feedback": "Reach says nothing about where the claim came from." }),
    ],
    "status": "Approved",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Apply",
    "assesses": [IDS.o4],
  },
  { "@type": "ItemInstance", "sequence": 1, "pointValue": 1, "randomize": false, "status": "Approved", "assessment": id("Assessment", "m2-check"), "implements": id("AssessmentItem", "first-step-tracing") },
  {
    "@type": "LearningActivity",
    "@id": IDS.tracingSprint,
    "label": "Claim tracing sprint",
    "description": "Teams follow a viral claim back through three to five sources, about two minutes per hop, using the quick lateral check from Module 1 at each hop.",
    "activityType": "Practice",
    "targets": [IDS.o4],
  },
  { "@type": "ModuleActivityLink", "sequence": 1, "module": IDS.module2, "activity": IDS.tracingSprint },
];

// ---------------------------------------------------------------------------
// Commit 3: SME review
// ---------------------------------------------------------------------------

// Hash-keyed: the store mints the id from subject, fragmentId, claimRef and
// attestedBy. asOf names the commit the verdict is about.
export const attestations = (asOf) => [
  {
    "@type": "Attestation",
    "subject": IDS.orgItem,
    "fragmentId": "org-site-first-step-opt-c",
    "claimRef": "seed:key-is-correct",
    "claimText": "Searching what other sources say about the site is the only correct first step.",
    "verdict": "Affirmed",
    "reason": "The stem asks for the first move; only C leaves the page. B is the most tempting distractor and is wrong for the reason the feedback gives.",
    "asOf": asOf,
    "attestedBy": id("User", "demo-reviewer"),
  },
];

// ---------------------------------------------------------------------------
// The commits, in order: who made each, its message, and its documents given
// the commits written before it (the review's asOf names Module 1's commit).
// main() writes these, and the test loads the same list.
// ---------------------------------------------------------------------------

export const COMMITS = [
  { author: id("User", "former-designer"), message: "Module 1 designed: checking sources online", documents: () => authored(module1) },
  { author: id("User", "former-designer"), message: "Module 2 sketched: tracing claims, built on Module 1's quick lateral check", documents: () => authored(module2) },
  { author: id("User", "demo-reviewer"), message: "SME review: the .org item's key affirmed", documents: (written) => attestations(written[0]) },
];

// ---------------------------------------------------------------------------
// The beat-3 change (not seeded): what you write on stage
// ---------------------------------------------------------------------------

// The whole objective as it reads after the change, for PUT /documents. No
// createdBy: the hub keeps the stored one on a replace, whatever a body says.
export const CHANGE = {
  "message": "Raise the lateral-reading objective to Evaluate: the library liaison asked us to go past the quick check, so first-years weigh what they find.",
  "document": {
    "@type": "LearningObjective",
    "@id": IDS.o1,
    "label": "Evaluate a website's credibility",
    "description": "Evaluate an unfamiliar website's credibility by weighing what other sources say about it.",
    "bloomsLevel": "Evaluate",
    "state": "Active",
    "generatedBy": id("LearningNeed", "unvetted-sources"),
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const TERMINUS_URL  = process.env.TERMINUS_URL  || "http://localhost:6363";
const TERMINUS_USER = process.env.TERMINUS_USER || "admin";
const TERMINUS_PASS = process.env.TERMINUS_PASS || "admin";
const TERMINUS_DB   = process.env.TERMINUS_DB   || "armature";

async function main() {
  const { WOQLClient } = await import("terminusdb");
  const client = new WOQLClient(TERMINUS_URL, { user: TERMINUS_USER, key: TERMINUS_PASS, organization: "admin" });
  client.db(TERMINUS_DB);

  const auth = "Basic " + Buffer.from(`${TERMINUS_USER}:${TERMINUS_PASS}`).toString("base64");
  const head = async () => {
    const log = await fetch(`${TERMINUS_URL}/api/log/admin/${TERMINUS_DB}?count=1`, { headers: { Authorization: auth } });
    const commit = (await log.json())?.[0]?.identifier;
    if (!commit) throw new Error("could not read the head commit from /api/log");
    return commit;
  };

  // The client takes a commit's author from its connection user ("admin"); the history is the
  // inherited trail only if each commit names the person who made it, in the hub's form (User/<id>).
  console.log(`Seeding the ICICLE demo (Version C) into "${TERMINUS_DB}" at ${TERMINUS_URL}`);
  const written = [];
  for (const [i, commit] of COMMITS.entries()) {
    console.log(`  ${commit.message}`);
    client.author = () => commit.author;
    // The first replaces every instance document, so a rerun starts clean.
    await client.addDocument(commit.documents(written), i === 0 ? { full_replace: true } : {}, null, commit.message);
    written.push(await head());
  }

  console.log("  → Done. Run the operator's check next.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("\nError:", err.message || err);
    if (err.data) console.error("Details:", JSON.stringify(err.data, null, 2));
    process.exit(1);
  });
}
