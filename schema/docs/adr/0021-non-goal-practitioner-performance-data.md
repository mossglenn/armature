# ADR-0021: Armature Does Not Model Practitioner Performance

## Status
Accepted

## Context

Armature records who is responsible for each record entering the graph. `createdBy` is on `ArmatureDocument` and propagates to every inheriting type (ADR-0015). Proposed types that capture design activity — `DesignFinding` (ADR-0020) and extensions to `DesignNote` — will carry it too.

Once those exist, the graph can answer questions about **people**:

- How many of this designer's items were flagged in review?
- How many revision rounds does their work typically require?
- How often are their cognitive-level judgments disputed by subject experts?

**None of this requires a new field.** The capability arrives as a byproduct of provenance data stored for entirely different reasons. It cannot be prevented by omitting anything, because nothing was added.

### Why this is not merely an ethics question

Armature's data quality depends on candor. The design rationale it exists to capture is produced at moments when someone is willing to be direct — a designer declining an expert's suggested change and stating why, a reviewer saying plainly that an item is wrong.

Both behaviours are suppressible. A designer who knows declines are counted declines less often. A reviewer who knows comments are tallied writes fewer and softer ones. **The instrument perturbs what it measures, and what it perturbs is precisely the behaviour that generates the data.**

So performance surveillance does not just create a labour-relations problem alongside the research goal. It degrades the research goal directly. A graph whose participants are performing for it records performances.

The ethical argument stands independently — practitioners have a legitimate interest in their design process not becoming a productivity dashboard, and in an organisational deployment, data that *can* support performance evaluation eventually *will*. But the measurement-integrity argument is the one specific to Armature's purpose.

### Why this cannot be enforced structurally

The only structural guarantee would be to drop attribution. That is not available: `createdBy` answers "who should I ask about this?" and establishes what standing a claim has. An unattributed `DesignFinding` is markedly weaker evidence. Provenance is a core capability, not an incidental field.

So the commitment must be a **policy**, recorded so that it is inherited rather than rediscovered. That is why this is an ADR with no schema change attached: there is nothing to change, and that is exactly the problem it addresses.

## Decision

**1. Armature does not model practitioner performance.** No schema field, computed value, or API endpoint exists to characterise an individual's work across artifacts. This is a permanent non-goal, not a deferral.

**2. `createdBy` is provenance about the artifact, not a performance record about the person.** The distinction is between two queries over the same stored data:

| Query | Character |
|---|---|
| *Who created this artifact?* | Provenance. Supported, and a primary capability |
| *What do this person's artifacts look like in aggregate?* | Performance data. Out of scope |

**3. The API exposes no person-scoped aggregate endpoints.** Traversal from an artifact to its author is supported. Enumeration from an author across their work as an analytic is not.

This is friction, not a barrier — anything reachable through bulk reads can be aggregated client-side. It is recorded anyway, because the difference between *possible with deliberate effort* and *one endpoint away* determines what people actually build.

**4. Tools built on Armature inherit this norm.** A plugin may track its own operational state, including per-user workflow. It should not surface practitioner comparisons derived from graph data, and it should not push such derivations back into the graph.

**5. Research on the graph is conducted at the level of the process, not the individual.** *"How often do subject experts dispute designers' cognitive-level judgments?"* is a question about the field and is in scope. The same query narrowed to one person is a performance question and is not.

The boundary is genuinely fuzzy — the two are the same query with a different filter, and only intent separates them. This ADR does not pretend otherwise. It states the norm so that crossing it requires a decision rather than a default.

## Deferred: anonymisation

Worth building eventually; premature now. No multi-user deployment exists, no authentication system is implemented (`User` resolution is designed but unbuilt), and the right design depends on knowing actual sharing and export patterns. Recorded so the direction is not rediscovered from scratch.

### The tension to resolve first

ADR-0015 deliberately optimised for **interpretability on export**: `User` documents travel with the graph, and `externalId`, `email`, and `institution` exist so identities remain meaningful without the original auth system.

Anonymisation pulls the opposite way. This is not a flaw in ADR-0015 — it is that two export purposes want different things:

| Export purpose | Wants |
|---|---|
| Handing a course to another institution for reuse | Interpretable attribution — who to contact, what expertise stands behind an item |
| Contributing to a research corpus | Pseudonymity — patterns without persons |

**The likely resolution: anonymisation is a property of an export mode, not of the graph.** One stored graph, several export profiles.

### Options recorded

**Pseudonymisation at export.** Replace `User` references with stable opaque tokens. Preserves "the same person made these forty decisions" — analytically valuable — while removing identity. *Caveat:* with three designers on a course, a pseudonym is trivially re-identifiable from context. Small-N defeats pseudonymisation, and most instructional design teams are small-N.

**Institution-only attribution.** Strip `displayName` and `email`, retain `institution`. *"Verified by an expert at Memorial Health"* preserves warrant — the thing that makes a verification worth having — without personal identity. Cheapest option, and it reuses a field that already exists.

**Aggregation thresholds.** Refuse queries resolving to fewer than *k* individuals. Standard analytics practice, and it works only if the API is genuinely the sole access path — which Armature's architecture already asserts.

**Differential privacy.** Noted and set aside. Disproportionate at the scale of a design team.

**Opt-in attribution.** Rejected as a primary mechanism. In a workplace, opting out of attribution is not costless, so consent is not meaningfully free — and inconsistent attribution damages the provenance record for everyone.

## Consequences

**Positive**

- The norm is inherited by future contributors and plugin authors rather than depending on whoever is present at the time.
- Participants can be told, accurately, what the system does and does not do with their attributed activity — which is a precondition for the candour the data depends on.
- Crossing the line requires an explicit decision that supersedes this ADR, leaving a record.

**Negative**

- Unenforceable by construction. Anyone with graph access can compute what this forbids.
- Forecloses analyses that would be genuinely interesting, including some with defensible purposes — identifying where a practitioner would benefit from support, for instance.
- The process/individual boundary is a matter of interpretation, and this ADR supplies a principle rather than a test.

**Neutral**

- No schema change. Nothing to implement, verify, or migrate.

## Related

- ADR-0010 — deliberate deferrals and non-goals; the precedent for recording what Armature will not do
- ADR-0015 — `User` and `createdBy`; the source of both the capability and the export-interpretability goal this trades against
- ADR-0020 — `DesignFinding`, which extends attributed activity into review
