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
