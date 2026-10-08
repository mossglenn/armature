// platform_checks.js
// Probes the TerminusDB behaviours Phase 1 of docs/development-plan.md depends on,
// in a scratch database that is created and deleted by this script. Nothing here
// touches the armature database.
//
// Checks (each prints PASS / FAIL / INFO with the evidence):
//   A. An abstract class with no properties is a valid inheritance root (ADR-0017 §3)
//   B. Four-level inheritance; a reference typed as the abstract root accepts a
//      leaf instance (ADR-0017 §1)
//   C. @metadata survives schema load and is readable from the schema graph (ADR-0017 §2, ADR-0027)
//   D. Subdocuments: are they returned inline by default, and what does unfold do (ADR-0022)
//   E. A List of subdocuments typed as an abstract subdocument accepts subtypes
//      polymorphically (ADR-0033)
//   F. An Optional single subdocument typed as the abstract accepts a subtype (ADR-0033)
//   G. sys:JSON on a subdocument stores and returns an arbitrary object (ADR-0033)
//   H. A subdocument cannot be inserted as a top-level document (ADR-0022 §2)
//   I. Subdocument IRIs nest under the parent (ADR-0023 context)
//   J. A diff between two commits of one document reports the changed nested option (ADR-0022)
//   K. A class with an explicit @key Random accepts a client-supplied @id on insert, and a
//      second insert under the same @id is rejected while PUT replaces it (ADR-0024)
//   L. Whether a reference field typed to class X rejects an existing document of class Y.
//      Found 2026-10-07: it does not. The store checks that the target exists, not its class.
//      Typed references are documentation and generator input; the API enforces the class
//      (ADR-0006, ADR-0014 and ADR-0017 amended, plan §9).
//
// Phase 2 checks (ADR-0025, ADR-0055), added 2026-10-08:
//   M. Data-version tokens: the form returned on a branch read and on a commit read; a write
//      with the current token succeeds; a write with a stale token is rejected and with what
//      @type; whether a bare commit id is accepted as the token
//   N. /api/history with diff=true returns author, identifier, message, timestamp and a
//      per-commit diff; paging with start/count; the default-branch path form
//   O. A branch created from a commit path starts at that commit with the same identifier;
//      reads at local/commit/<id> return the state then and reject writes; branch listing
//   P. apply as a three-way merge: a clean merge creates a commit on the target carrying
//      commit_info author and message; a conflicting field change is reported, not resolved
//   Q. rebase replays commits and gives them new identifiers; the pre-rebase commit remains
//      readable at its old id (candidate 0036's concern)
//   R. /api/diff between two data versions with no document_id yields the changed document
//      ids; which token forms it accepts (bare id, branch:<id>, branch name)
//   S. /api/log entry shape
//   T. Deleting a branch keeps its commits readable at local/commit/<id>
//   U. A commit can be checked for existence by reading ValidCommit/<id> from the commit graph
//      (local/_commits); a document read at a commit path that does not exist is a 500
//
// Usage: node scripts/platform_checks.js [--keep]
// Env:   TERMINUS_URL, TERMINUS_USER, TERMINUS_PASS (defaults for local dev)

const URL  = process.env.TERMINUS_URL  || "http://localhost:6363";
const USER = process.env.TERMINUS_USER || "admin";
const PASS = process.env.TERMINUS_PASS || "admin";
const DB   = "armature_platform_checks";
const KEEP = process.argv.includes("--keep");
const AUTH = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, dataVersion: res.headers.get("terminusdb-data-version") };
}
const docs   = (q) => `/api/document/admin/${DB}?${q}`;
const commit = (msg) => `author=platform_checks&message=${encodeURIComponent(msg)}`;
const results = [];
function record(id, verdict, evidence) { results.push({ id, verdict, evidence }); console.log(`${verdict.padEnd(4)} ${id}: ${evidence}`); }
const short = (v) => JSON.stringify(v).slice(0, 300);

const schema = [
  { "@type": "@context", "@base": "terminusdb:///pc/data/", "@schema": "terminusdb:///pc/schema#" },
  // A, B, C: four levels, abstract root with no properties, metadata on every level
  { "@type": "Class", "@id": "L1", "@abstract": [], "@metadata": { armature: { category: "root" } } },
  { "@type": "Class", "@id": "L2", "@abstract": [], "@inherits": "L1", "label": "xsd:string", "@metadata": { armature: { category: "artifact" } } },
  { "@type": "Class", "@id": "L3", "@abstract": [], "@inherits": "L2", "@metadata": { armature: { category: "artifact" } } },
  { "@type": "Class", "@id": "L4", "@inherits": "L3", "@key": { "@type": "Lexical", "@fields": ["label"] }, "extra": "xsd:string", "@metadata": { armature: { category: "artifact" } } },
  { "@type": "Class", "@id": "Note", "@key": { "@type": "Random" }, "subject": { "@type": "Set", "@class": "L1", "@min_cardinality": 1 } },
  { "@type": "Class", "@id": "Artifact", "@key": { "@type": "Random" }, "label": "xsd:string" },
  { "@type": "Class", "@id": "Other", "@key": { "@type": "Random" }, "label": "xsd:string" },
  { "@type": "Class", "@id": "Holder", "@key": { "@type": "Random" }, "one": "Artifact", "many": { "@type": "Set", "@class": "Artifact" } },
  // D–J: abstract subdocument with typed and generic specialisations
  { "@type": "Class", "@id": "Fragment", "@subdocument": [], "@abstract": [], "@key": { "@type": "Random" },
    "fragmentId": "xsd:string", "kind": "xsd:string", "text": { "@type": "Optional", "@class": "xsd:string" } },
  { "@type": "Class", "@id": "ItemOption", "@subdocument": [], "@inherits": "Fragment", "@key": { "@type": "Random" }, "isCorrect": "xsd:boolean" },
  { "@type": "Class", "@id": "GenericFragment", "@subdocument": [], "@inherits": "Fragment", "@key": { "@type": "Random" }, "payload": { "@type": "Optional", "@class": "sys:JSON" } },
  { "@type": "Class", "@id": "Item", "@key": { "@type": "Lexical", "@fields": ["name"] }, "name": "xsd:string",
    "stem": { "@type": "Optional", "@class": "Fragment" },
    "options": { "@type": "List", "@class": "ItemOption" },
    "parts": { "@type": "List", "@class": "Fragment" } },
];

async function main() {
  console.log(`TerminusDB at ${URL}, scratch database ${DB}\n`);
  await api("DELETE", `/api/db/admin/${DB}`);
  let r = await api("POST", `/api/db/admin/${DB}`, { label: "platform checks", comment: "scratch", schema: true });
  if (r.status !== 200) throw new Error(`create db: ${r.status} ${short(r.json)}`);

  // Schema load (A: abstract root with no properties; abstract subdocument with @key)
  r = await api("POST", docs(`graph_type=schema&full_replace=true&${commit("probe schema")}`), schema);
  if (r.status !== 200) {
    record("A", "FAIL", `schema with empty abstract root / abstract subdocument rejected: ${short(r.json)}`);
    throw new Error("schema load failed; see above");
  }
  record("A", "PASS", "schema with an empty abstract root (L1) and an abstract @subdocument (Fragment) loaded");

  // C: metadata survives
  r = await api("GET", docs(`graph_type=schema&id=L4`));
  const meta = r.json?.["@metadata"];
  record("C", meta?.armature?.category === "artifact" ? "PASS" : "FAIL", `schema read of L4 has @metadata ${short(meta)}`);
  r = await api("GET", docs(`graph_type=schema&id=L1`));
  record("C2", r.json?.["@metadata"]?.armature?.category === "root" ? "PASS" : "FAIL", `abstract root L1 @metadata ${short(r.json?.["@metadata"])}`);

  // B: four-level instance, and a Set<L1> reference accepting an L4
  r = await api("POST", docs(commit("insert L4")), { "@type": "L4", label: "leaf", extra: "x" });
  record("B1", r.status === 200 ? "PASS" : "FAIL", `insert L4 (4 levels deep): ${r.status} ${short(r.json)}`);
  r = await api("POST", docs(commit("insert Note")), { "@type": "Note", subject: ["L4/leaf"] });
  record("B2", r.status === 200 ? "PASS" : "FAIL", `Note.subject: Set<L1> accepts an L4 instance: ${r.status} ${short(r.json)}`);
  r = await api("GET", docs(`id=L4/leaf`));
  record("B3", r.json?.label === "leaf" && r.json?.extra === "x" ? "PASS" : "FAIL", `L4 read back with inherited label and own field: ${short(r.json)}`);

  // E, F, G: polymorphic subdocument list, optional abstract subdocument, sys:JSON payload
  const item = {
    "@type": "Item", name: "q1",
    stem: { "@type": "GenericFragment", fragmentId: "stem", kind: "stem", text: "Which is true?" },
    options: [
      { "@type": "ItemOption", fragmentId: "a", kind: "option", text: "Alpha", isCorrect: true },
      { "@type": "ItemOption", fragmentId: "b", kind: "option", text: "Beta", isCorrect: false },
    ],
    parts: [
      { "@type": "ItemOption", fragmentId: "c", kind: "option", text: "Gamma", isCorrect: false },
      { "@type": "GenericFragment", fragmentId: "img1", kind: "image", payload: { src: "x.png", alt: "a picture", box: [1, 2, 3] } },
    ],
  };
  r = await api("POST", docs(commit("insert Item")), item);
  const insertOk = r.status === 200;
  record("E1", insertOk ? "PASS" : "FAIL", `Item with List<Fragment> holding ItemOption + GenericFragment: ${r.status} ${short(r.json)}`);
  const v1 = r.dataVersion;

  // D: default read vs unfold
  r = await api("GET", docs(`id=Item/q1`));
  const def = r.json;
  const inlineDefault = Array.isArray(def?.options) && typeof def.options[0] === "object";
  record("D1", "INFO", `default read: options are ${inlineDefault ? "inline objects" : "references"}; first option = ${short(def?.options?.[0])}`);
  r = await api("GET", docs(`id=Item/q1&unfold=true`));
  const unf = r.json;
  record("D2", "INFO", `unfold=true read: first option = ${short(unf?.options?.[0])}`);
  r = await api("GET", docs(`id=Item/q1&unfold=false`));
  record("D3", "INFO", `unfold=false read: first option = ${short(r.json?.options?.[0])}`);
  const chosen = inlineDefault ? def : unf;
  record("D", inlineDefault || (Array.isArray(unf?.options) && typeof unf.options[0] === "object") ? "PASS" : "FAIL",
    inlineDefault ? "subdocuments return inline by default" : "subdocuments need unfold=true to return inline");

  // E2: both subtypes survive the round trip in the polymorphic list
  const kinds = (chosen?.parts || []).map((p) => p["@type"]);
  record("E2", kinds.join(",") === "ItemOption,GenericFragment" ? "PASS" : "FAIL", `parts @types after round trip: ${kinds.join(",")}`);
  // F: optional abstract single subdocument
  record("F", chosen?.stem?.["@type"] === "GenericFragment" && chosen?.stem?.text === "Which is true?" ? "PASS" : "FAIL", `stem (Optional<Fragment>) round trip: ${short(chosen?.stem)}`);
  // G: sys:JSON payload
  const payload = chosen?.parts?.[1]?.payload;
  record("G", payload?.src === "x.png" && Array.isArray(payload?.box) ? "PASS" : "FAIL", `GenericFragment.payload (sys:JSON) round trip: ${short(payload)}`);
  // I: subdocument IRI nests under parent
  const subId = chosen?.options?.[0]?.["@id"];
  record("I", typeof subId === "string" && subId.startsWith("Item/q1/") ? "PASS" : "INFO", `first option @id = ${subId}`);
  // order preserved
  const texts = (chosen?.options || []).map((o) => o.text).join(",");
  record("E3", texts === "Alpha,Beta" ? "PASS" : "FAIL", `List order preserved: ${texts}`);

  // H: subdocument as a top-level document
  r = await api("POST", docs(commit("insert bare option")), { "@type": "ItemOption", fragmentId: "z", kind: "option", text: "Zeta", isCorrect: false });
  record("H", r.status !== 200 ? "PASS" : "FAIL", `inserting an ItemOption as a top-level document: ${r.status} ${short(r.json)}`);

  // J: replace the item with one option's text changed, diff the two states
  const edited = structuredClone(item);
  edited.options[1].text = "Beta (revised)";
  r = await api("PUT", docs(commit("edit option b")), edited);
  record("J1", r.status === 200 ? "PASS" : "FAIL", `PUT replace of Item with one option text changed: ${r.status} ${short(r.json)}`);
  const v2 = r.dataVersion;
  record("J2", "INFO", `data versions before/after: ${v1} -> ${v2}`);
  if (v1 && v2) {
    r = await api("POST", `/api/diff/admin/${DB}`, { before_data_version: v1, after_data_version: v2, document_id: "Item/q1" });
    const d = JSON.stringify(r.json);
    record("J3", r.status === 200 && d.includes("Beta (revised)") ? "PASS" : "INFO", `diff by data version: ${r.status} ${d.slice(0, 400)}`);
  }
  // J4: subdocument ids stable across the replace?
  r = await api("GET", docs(`id=Item/q1${inlineDefault ? "" : "&unfold=true"}`));
  const subId2 = r.json?.options?.[0]?.["@id"];
  record("J4", "INFO", `first option @id after replace: ${subId2} (${subId2 === subId ? "same" : "changed"} vs before) — Random keys regenerate on replace unless the client echoes @id`);

  // K: client-supplied @id with an explicit Random key
  r = await api("POST", docs(commit("insert with client id")), { "@type": "Artifact", "@id": "Artifact/client-chosen", label: "one" });
  record("K1", r.status === 200 && JSON.stringify(r.json).includes("Artifact/client-chosen") ? "PASS" : "FAIL", `insert with @id under @key Random: ${r.status} ${short(r.json)}`);
  r = await api("POST", docs(commit("insert duplicate id")), { "@type": "Artifact", "@id": "Artifact/client-chosen", label: "two" });
  record("K2", r.status !== 200 ? "PASS" : "FAIL", `second POST under the same @id rejected: ${r.status} ${short(r.json?.["api:error"]?.["@type"] ?? r.json)}`);
  r = await api("PUT", docs(commit("replace by id")), { "@type": "Artifact", "@id": "Artifact/client-chosen", label: "two" });
  record("K3", r.status === 200 ? "PASS" : "FAIL", `PUT replaces under the same @id: ${r.status}`);
  r = await api("POST", docs(commit("insert without id")), { "@type": "Artifact", label: "three" });
  record("K4", "INFO", `insert without @id under @key Random mints: ${short(r.json)}`);
  r = await api("PUT", docs(commit("replace other type")), { "@type": "Note", "@id": "Artifact/client-chosen", subject: ["L4/leaf"] });
  record("K5", "INFO", `PUT a different @type under an existing id: ${r.status} ${short(r.json?.["api:error"]?.["@type"] ?? r.json)} (ADR-0024 wants 409 at the hub)`);

  // L: class of a referenced document
  r = await api("POST", docs(commit("insert Other")), { "@type": "Other", "@id": "Other/x", label: "x" });
  r = await api("POST", docs(commit("wrong class single")), { "@type": "Holder", one: "Other/x", many: [] });
  record("L1", r.status === 200 ? "INFO" : "PASS", `Holder.one (typed Artifact) -> existing Other: ${r.status === 200 ? "ACCEPTED: reference class is not checked" : "rejected " + short(r.json?.["api:error"]?.["@type"])}`);
  r = await api("POST", docs(commit("wrong class set")), { "@type": "Holder", one: "Artifact/client-chosen", many: ["Other/x"] });
  record("L2", r.status === 200 ? "INFO" : "PASS", `Holder.many (Set<Artifact>) containing Other: ${r.status === 200 ? "ACCEPTED: reference class is not checked" : "rejected " + short(r.json?.["api:error"]?.["@type"])}`);
  r = await api("POST", docs(commit("missing ref")), { "@type": "Holder", one: "Artifact/does-not-exist", many: [] });
  record("L3", r.status !== 200 ? "PASS" : "FAIL", `reference to a missing document rejected: ${r.status} ${short(r.json?.["api:error"]?.["api:witnesses"]?.[0]?.["@type"])}`);

  // ---------------------------------------------------------------------------
  // Phase 2: data versions, history, branches, merge, rebase (ADR-0025, ADR-0055)
  // ---------------------------------------------------------------------------
  const at = (ref, q) => `/api/document/admin/${DB}/local/${ref}?${q}`;
  const log = async (branch, count = 20) => (await api("GET", `/api/log/admin/${DB}/local/branch/${branch}?count=${count}`)).json;
  const errType = (res) => res.json?.["api:error"]?.["@type"] ?? res.json?.["@type"] ?? short(res.json);
  const artifact = (label) => ({ "@type": "Artifact", "@id": "Artifact/client-chosen", label });

  // S: log entry shape; M: data-version token forms and optimistic concurrency
  const mainLog = await log("main", 3);
  const headId = mainLog?.[0]?.identifier;
  record("S", Array.isArray(mainLog) && headId && mainLog[0].author && mainLog[0].message && mainLog[0].timestamp ? "PASS" : "FAIL",
    `/api/log entry shape: ${short(mainLog?.[0])}`);
  r = await api("GET", `/api/log/admin/${DB}/local/branch/main?start=1&count=1`);
  record("S2", r.json?.[0]?.identifier === mainLog?.[1]?.identifier ? "PASS" : "FAIL", `/api/log pages with start: start=1&count=1 returns the second entry (${r.json?.[0]?.identifier})`);
  r = await api("GET", at("branch/main", "id=Artifact/client-chosen"));
  const tokMain = r.dataVersion || "";
  record("M1", /^branch:\w+$/.test(tokMain) ? "PASS" : "INFO", `data version on a branch read: ${tokMain}`);
  record("M2", tokMain === `branch:${headId}` ? "PASS" : "INFO", `the branch token's commit equals the log head identifier ${headId}`);
  r = await api("GET", at(`commit/${headId}`, "id=Artifact/client-chosen"));
  record("M3", r.status === 200 ? "PASS" : "FAIL", `read at local/commit/<id>: ${r.status}; data version there: ${r.dataVersion}`);
  r = await api("PUT", at("branch/main", commit("fresh token write")), artifact("three"), { "TerminusDB-Data-Version": tokMain });
  record("M4", r.status === 200 ? "PASS" : "FAIL", `PUT with the current token: ${r.status} -> ${r.dataVersion}`);
  const tokAfter = r.dataVersion || "";
  r = await api("PUT", at("branch/main", commit("stale token write")), artifact("four"), { "TerminusDB-Data-Version": tokMain });
  record("M5", r.status !== 200 ? "PASS" : "FAIL", `PUT with a stale token: ${r.status} ${errType(r)}`);
  r = await api("PUT", at("branch/main", commit("bare id token write")), artifact("four"), { "TerminusDB-Data-Version": tokAfter.replace(/^branch:/, "") });
  record("M6", "INFO", `PUT with a bare commit id as the token: ${r.status} ${r.status === 200 ? "accepted" : errType(r)}`);

  // N: per-document history with diffs
  r = await api("GET", `/api/history/admin/${DB}/local/branch/main?id=Artifact/client-chosen&diff=true`);
  const hist = Array.isArray(r.json) ? r.json : [];
  const h0 = hist[0];
  record("N1", r.status === 200 && h0?.identifier && h0?.author && h0?.message && h0?.timestamp ? "PASS" : "FAIL",
    `/api/history: ${r.status}, ${hist.length} entries; first = ${short({ ...h0, diff: undefined })}`);
  record("N2", h0?.diff ? "PASS" : "FAIL", `diff=true attaches a per-commit diff: ${short(h0?.diff)}`);
  const insertEntry = hist.find((h) => h.message === "insert with client id");
  const ancestorId = insertEntry?.identifier;
  record("N3", JSON.stringify(insertEntry?.diff ?? "").includes("Insert") ? "PASS" : "INFO", `the insert commit's diff is an Insert: ${short(insertEntry?.diff)}`);
  const order = hist.length > 1 && hist[0].timestamp > hist[hist.length - 1].timestamp ? "newest first" : "oldest first or single";
  record("N4", "INFO", `history order: ${order}`);
  r = await api("GET", `/api/history/admin/${DB}?id=Artifact/client-chosen&start=0&count=1`);
  record("N5", r.status === 200 && Array.isArray(r.json) && r.json.length === 1 ? "PASS" : "INFO", `history on the default-branch path with start=0&count=1: ${r.status} ${Array.isArray(r.json) ? r.json.length + " entry" : short(r.json)}`);

  // O: branch from a commit; read at a commit
  r = await api("POST", `/api/branch/admin/${DB}/local/branch/from-commit`, { origin: `admin/${DB}/local/commit/${ancestorId}` });
  record("O1", r.status === 200 ? "PASS" : "FAIL", `branch from a commit path: ${r.status} ${short(r.json)}`);
  const fcHead0 = (await log("from-commit", 1))?.[0]?.identifier;
  record("O2", fcHead0 === ancestorId ? "PASS" : "FAIL", `new branch head ${fcHead0} equals the origin commit ${ancestorId} (ids stable across branch creation)`);
  r = await api("GET", at(`commit/${ancestorId}`, "id=Artifact/client-chosen"));
  record("O3", r.json?.label === "one" ? "PASS" : "FAIL", `read at the ancestor commit returns the state then (label=${r.json?.label}); data version ${r.dataVersion}`);
  r = await api("GET", at("branch/from-commit", "id=Artifact/client-chosen"));
  record("O4", r.json?.label === "one" ? "PASS" : "FAIL", `read on the new branch returns the ancestor state (label=${r.json?.label})`);
  r = await api("PUT", at(`commit/${ancestorId}`, commit("write at commit")), artifact("nope"));
  record("O5", r.status !== 200 ? "PASS" : "FAIL", `write at a commit path rejected: ${r.status} ${errType(r)}`);
  r = await api("GET", `/api/db/admin/${DB}?branches=true`);
  record("O6", "INFO", `branch listing via /api/db/admin/<db>?branches=true: ${r.status} ${short(r.json)}`);

  // P: apply as a three-way merge
  r = await api("POST", at("branch/from-commit", commit("insert on branch")), { "@type": "Artifact", "@id": "Artifact/on-branch", label: "branch-only" });
  const fcHead1 = (await log("from-commit", 1))?.[0]?.identifier;
  const applyUrl = `/api/apply/admin/${DB}/local/branch/main`;
  const mainLabelBefore = (await api("GET", at("branch/main", "id=Artifact/client-chosen"))).json?.label;
  // Which reference forms does apply accept for before_commit / after_commit? Probe commit
  // forms first (an explicit three-way merge against the ancestor), then the documented
  // branch forms (whose semantics the probe then reveals: does main's label revert to the
  // ancestor's "one", i.e. a two-way diff applied, or stay, i.e. a true three-way merge?).
  const info = { author: "merger@example", message: "merge from-commit (clean)" };
  const forms = [
    ["commit path", (id) => `admin/${DB}/local/commit/${id}`, (b) => `admin/${DB}/local/branch/${b}`],
    ["bare id", (id) => id, (b) => b],
    ["commit:<id>", (id) => `commit:${id}`, (b) => `branch:${b}`],
    ["branch:<id>", (id) => `branch:${id}`, (b) => `branch:${b}`],
  ];
  let applyForm = null;
  for (const [name, c] of forms) {
    r = await api("POST", applyUrl, { before_commit: c(ancestorId), after_commit: c(fcHead1), commit_info: info });
    const ok = r.status === 200 && r.json?.["api:status"] === "api:success";
    record("P1", ok ? "PASS" : "INFO", `apply with commit refs as ${name}: ${r.status} ${ok ? "success" : errType(r)}`);
    if (ok) { applyForm = ["commit", name, c]; break; }
  }
  if (!applyForm) {
    for (const [name, , b] of forms) {
      r = await api("POST", applyUrl, { before_commit: b("main"), after_commit: b("from-commit"), commit_info: info });
      const ok = r.status === 200 && r.json?.["api:status"] === "api:success";
      record("P1", ok ? "PASS" : "INFO", `apply with branch refs as ${name}: ${r.status} ${ok ? "success" : errType(r)}`);
      if (ok) { applyForm = ["branch", name, b]; break; }
    }
  }
  const mergeCommit = (await log("main", 1))?.[0];
  record("P2", mergeCommit?.author === "merger@example" && mergeCommit?.message === info.message ? "PASS" : "FAIL", `merge commit on main carries commit_info author and message: ${short({ author: mergeCommit?.author, message: mergeCommit?.message, identifier: mergeCommit?.identifier })}`);
  r = await api("GET", at("branch/main", "id=Artifact/on-branch"));
  record("P3", r.json?.label === "branch-only" ? "PASS" : "FAIL", `merged document readable on main: ${short(r.json)}`);
  const mainLabelAfter = (await api("GET", at("branch/main", "id=Artifact/client-chosen"))).json?.label;
  record("P3b", mainLabelAfter === mainLabelBefore ? "PASS" : "INFO", `main's unrelated change survived the merge: label ${mainLabelBefore} -> ${mainLabelAfter} (${applyForm ? applyForm[0] + " refs as " + applyForm[1] : "no form worked"}); ${mainLabelAfter === "one" ? "REVERTED to the ancestor state: apply applied a two-way diff" : "three-way semantics"}`);
  r = await api("PUT", at("branch/from-commit", commit("edit on branch")), artifact("branch-edit"));
  const fcHead2 = (await log("from-commit", 1))?.[0]?.identifier;
  if (applyForm) {
    const [kind, , f] = applyForm;
    const body = kind === "commit"
      ? { before_commit: f(fcHead1), after_commit: f(fcHead2), commit_info: { ...info, message: "merge from-commit (conflict)" } }
      : { before_commit: f("main"), after_commit: f("from-commit"), commit_info: { ...info, message: "merge from-commit (conflict)" } };
    r = await api("POST", applyUrl, body);
    const conflictBody = JSON.stringify(r.json ?? "");
    record("P4", r.json?.["api:status"] === "api:conflict" || conflictBody.includes("witness") ? "PASS" : "FAIL", `apply with a conflicting field change: HTTP ${r.status} ${conflictBody.slice(0, 600)}`);
  } else {
    record("P4", "FAIL", "skipped: no apply form worked");
  }
  const mainAfterConflict = (await log("main", 1))?.[0]?.identifier;
  record("P5", mainAfterConflict === mergeCommit?.identifier ? "PASS" : "FAIL", `main head unchanged by the rejected merge (${mainAfterConflict})`);

  // Q: rebase rewrites identifiers
  r = await api("POST", `/api/branch/admin/${DB}/local/branch/rb`, { origin: `admin/${DB}/local/branch/main` });
  r = await api("POST", at("branch/rb", commit("rb commit")), { "@type": "Artifact", "@id": "Artifact/rb-doc", label: "rb" });
  const rbBefore = (await log("rb", 1))?.[0];
  r = await api("POST", at("branch/main", commit("main diverges")), { "@type": "Artifact", "@id": "Artifact/main-doc", label: "m" });
  const mainBeforeRebase = (await log("main", 1))?.[0]?.identifier;
  r = await api("POST", `/api/rebase/admin/${DB}/local/branch/rb`, { author: "rebaser@example", rebase_from: `admin/${DB}/local/branch/main` });
  record("Q1", r.status === 200 ? "PASS" : "FAIL", `rebase rb onto main: ${r.status} ${short(r.json)}`);
  const rbAfter = (await log("rb", 5)) || [];
  const rbCommitAfter = rbAfter.find?.((c) => c.message === "rb commit");
  const idChanged = rbCommitAfter && rbCommitAfter.identifier !== rbBefore?.identifier;
  record("Q2", idChanged ? "PASS" : "INFO", `the replayed commit's identifier ${rbBefore?.identifier} -> ${rbCommitAfter?.identifier} (${idChanged ? "changed: rebase rewrites ids" : "unchanged or not found"}); rb log now: ${short(rbAfter.map?.((c) => c.message))}`);
  const mainAfterRebase = (await log("main", 1))?.[0]?.identifier;
  record("Q3", mainAfterRebase === mainBeforeRebase ? "PASS" : "INFO", `main head unchanged by rebasing rb (${mainBeforeRebase} -> ${mainAfterRebase})`);
  r = await api("GET", at(`commit/${rbBefore?.identifier}`, "id=Artifact/rb-doc"));
  record("Q4", r.status === 200 ? "PASS" : "INFO", `the pre-rebase commit is still readable at its old id: ${r.status}`);

  // R: branch-level diff and the token forms it accepts
  r = await api("POST", `/api/diff/admin/${DB}`, { before_data_version: ancestorId, after_data_version: mainAfterRebase });
  const entries = Array.isArray(r.json) ? r.json : [];
  const ids = entries.map((d) => d["@id"] ?? d["@insert"]?.["@id"] ?? d["@delete"]?.["@id"]);
  record("R1", r.status === 200 && ids.length ? "PASS" : "FAIL", `diff between two bare commit ids with no document_id: ${r.status}, ${ids.length} changed documents; ops ${short(entries.map((d) => d["@op"] ?? "(field ops)"))}; ids ${short(ids)}`);
  r = await api("POST", `/api/diff/admin/${DB}`, { before_data_version: `branch:${ancestorId}`, after_data_version: `branch:${mainAfterRebase}` });
  record("R2", r.status === 200 ? "PASS" : "INFO", `diff accepts header-style branch:<id> tokens: ${r.status} ${r.status === 200 ? "" : errType(r)}`);
  r = await api("POST", `/api/diff/admin/${DB}`, { before_data_version: ancestorId, after_data_version: "main", document_id: "Artifact/client-chosen" });
  record("R3", r.status === 200 && r.json?.label ? "PASS" : "INFO", `one document, commit id vs branch name: ${r.status} ${short(r.json)}`);

  // T: deleting a branch keeps its commits
  // DELETE with "Content-Type: application/json" and no body returned 500 on v12.0.7; probe
  // the request shapes until one is accepted.
  const delVariants = [
    ["json content-type, no body", () => api("DELETE", `/api/branch/admin/${DB}/local/branch/from-commit`)],
    ["json content-type, {} body", () => api("DELETE", `/api/branch/admin/${DB}/local/branch/from-commit`, {})],
    ["no content-type, no body", () => fetch(`${URL}/api/branch/admin/${DB}/local/branch/from-commit`, { method: "DELETE", headers: { Authorization: AUTH } }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }))],
  ];
  let delOk = null;
  for (const [name, call] of delVariants) {
    r = await call();
    record("T1", r.status === 200 ? "PASS" : "INFO", `delete branch from-commit (${name}): ${r.status} ${r.status === 200 ? short(r.json) : errType(r)}`);
    if (r.status === 200) { delOk = name; break; }
  }
  if (!delOk) record("T1", "FAIL", "no DELETE request shape was accepted");
  r = await api("DELETE", `/api/branch/admin/${DB}/local/branch/rb`, delOk === "json content-type, {} body" ? {} : undefined);
  record("T1b", r.status === 200 ? "PASS" : "INFO", `delete branch rb (rebased): ${r.status} ${r.status === 200 ? "" : errType(r)}`);
  r = await api("GET", `/api/db/admin/${DB}?branches=true`);
  record("T1c", "INFO", `branches after deletes: ${short(r.json?.branches)}`);
  r = await api("GET", at(`commit/${fcHead2}`, "id=Artifact/client-chosen"));
  record("T2", r.json?.label === "branch-edit" ? "PASS" : "INFO", `a commit only the deleted branch reached is still readable at local/commit/<id>: ${r.status} label=${r.json?.label}`);

  // U: commit existence via the commit graph
  r = await api("GET", `/api/document/admin/${DB}/local/_commits?id=ValidCommit/${fcHead2}`);
  record("U1", r.status === 200 && r.json?.identifier === fcHead2 ? "PASS" : "FAIL", `ValidCommit/<id> from local/_commits: ${r.status} ${short({ identifier: r.json?.identifier, author: r.json?.author, message: r.json?.message })}`);
  r = await api("GET", `/api/document/admin/${DB}/local/_commits?id=ValidCommit/nosuchcommit000`);
  record("U2", r.status === 404 && errType(r) === "api:DocumentNotFound" ? "PASS" : "FAIL", `unknown commit in local/_commits: ${r.status} ${errType(r)}`);
  r = await api("GET", at("commit/nosuchcommit000", "id=Artifact/client-chosen"));
  record("U3", "INFO", `document read at a commit path that does not exist: ${r.status} ${errType(r)} (the hub validates commit ids with U1/U2 first)`);

  console.log("\nSummary:");
  for (const x of results) console.log(`  ${x.verdict.padEnd(4)} ${x.id}`);
}

main()
  .catch((e) => { console.error("\nError:", e.message); process.exitCode = 1; })
  .finally(async () => {
    if (KEEP) { console.log(`\nKept ${DB} (--keep)`); return; }
    const r = await api("DELETE", `/api/db/admin/${DB}`);
    console.log(`\nDeleted ${DB}: ${r.status}`);
  });
