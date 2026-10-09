import { CLASS_FIELDS, VALID_BloomsLevel, type FieldShape } from '@/lib/types';
import { DOCUMENT_SCHEMAS } from '@/lib/schemas';
import { inheritsFrom } from '../classes';
import { StoreError, type Store, type TerminusDocument } from '../store';

/**
 * A read-only view of the graph at one ref for the intelligence routes
 * (plan §3 layer 4). Every read goes through the store adapter (architecture
 * decision record ADR-0055) and is cached for the life of the request, so a
 * route that walks the same objective from three items fetches it once.
 * `commit` is the commit the first read was served from; every read in one
 * request is at the same ref, so it is the ETag (entity tag) for the response.
 *
 * Reverse lookups are schema-driven: `referencing` reads CLASS_FIELDS for
 * every reference field whose declared class the target is or inherits
 * from, and `where` answers "documents of this type whose field names this
 * id". A required scalar reference is a template query the store filters.
 * An Optional reference is listed and filtered here: the store answers a
 * template on an Optional reference field with a 500, unknown_type_casting_error
 * (platform check Y2, plan §9). A Set or List is listed and filtered too:
 * a template on a Set reference field is a 500 in both value forms (Y3). All
 * are a few reads at demo scale; a WOQL (TerminusDB's Web Object Query
 * Language) query over the adapter is where this goes when it is not.
 */
export class Graph {
  private readonly docs = new Map<string, Promise<TerminusDocument | undefined>>();
  private readonly lists = new Map<string, Promise<TerminusDocument[]>>();
  commit: string | undefined;

  constructor(readonly store: Store) {}

  private served(commit: string | undefined): void {
    if (!this.commit && commit) this.commit = commit;
  }

  /** One document, or undefined when the ref has none with that id. */
  get(id: string): Promise<TerminusDocument | undefined> {
    let p = this.docs.get(id);
    if (!p) {
      p = this.store
        .getDocument(id)
        .then((r) => {
          this.served(r.commit);
          return r.document;
        })
        .catch((err: unknown) => {
          if (err instanceof StoreError && err.type === 'api:DocumentNotFound') return undefined;
          throw err;
        });
      this.docs.set(id, p);
    }
    return p;
  }

  /** Several documents in one read; ids the ref lacks are left out. */
  async getMany(ids: Iterable<string>): Promise<TerminusDocument[]> {
    const wanted = [...new Set(ids)];
    const missing = wanted.filter((id) => !this.docs.has(id));
    if (missing.length) {
      const fetched = this.store.getDocuments(missing).then((r) => {
        this.served(r.commit);
        return r.documents;
      });
      for (const id of missing) {
        this.docs.set(id, fetched.then((docs) => docs.find((d) => d['@id'] === id)));
      }
    }
    const out: TerminusDocument[] = [];
    for (const id of wanted) {
      const doc = await this.docs.get(id);
      if (doc) out.push(doc);
    }
    return out;
  }

  /** The documents of `type` matching `template` (all of them when it is empty). */
  list(type: string, template: Record<string, unknown> = {}): Promise<TerminusDocument[]> {
    const key = `${type} ${JSON.stringify(template)}`;
    let p = this.lists.get(key);
    if (!p) {
      p = this.store.queryDocuments(type, template).then((r) => {
        this.served(r.commit);
        for (const doc of r.documents) this.docs.set(doc['@id'], Promise.resolve(doc));
        return r.documents;
      });
      this.lists.set(key, p);
    }
    return p;
  }

  /**
   * The documents of `type` whose reference `field` names `id`. The store
   * filters a required scalar reference; an Optional or a Set/List field is
   * listed and filtered here (see the class comment).
   */
  async where(type: string, field: string, id: string): Promise<TerminusDocument[]> {
    const shape = fieldsOf(type)[field];
    if (!shape) throw new Error(`${type} has no field ${field}`);
    if (shape.many) return (await this.list(type)).filter((d) => idsIn(d[field]).includes(id));
    if (shape.optional) return (await this.list(type)).filter((d) => d[field] === id);
    return this.list(type, { [field]: id });
  }

  /**
   * Every document whose reference field names `targetId`, with the field.
   * `targetType` decides which fields can hold it: those declared on the
   * target's class or one of its ancestors (the inverse of constraint 0).
   */
  async referencing(targetId: string, targetType: string): Promise<Array<{ document: TerminusDocument; field: string }>> {
    const out: Array<{ document: TerminusDocument; field: string }> = [];
    for (const type of CONCRETE_DOCUMENT_TYPES) {
      for (const [field, shape] of Object.entries(fieldsOf(type))) {
        if (shape.kind !== 'reference' || !inheritsFrom(targetType, shape.type)) continue;
        for (const document of await this.where(type, field, targetId)) out.push({ document, field });
      }
    }
    return out;
  }
}

/** The concrete document classes: what the store can list and the write routes accept. */
const CONCRETE_DOCUMENT_TYPES = Object.keys(DOCUMENT_SCHEMAS);

const fieldsOf = (type: string): Record<string, FieldShape> =>
  (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[type] ?? {};

/** The reference fields of a class other than `except`, with their current ids. */
export function otherReferences(doc: TerminusDocument, except: string): Array<{ field: string; id: string }> {
  const out: Array<{ field: string; id: string }> = [];
  for (const [field, shape] of Object.entries(fieldsOf(doc['@type']))) {
    if (field === except || shape.kind !== 'reference' || shape.many) continue;
    const value = doc[field];
    if (typeof value === 'string') out.push({ field, id: value });
  }
  return out;
}

/** A node as the intelligence routes report it: identity, label and the attributes that bear on judgment. */
export interface Summary {
  id: string;
  type: string;
  label?: string;
  bloomsLevel?: string;
  status?: string;
  state?: string;
  role?: string;
  confidence?: string;
  method?: string;
  value?: number;
  unit?: string;
}

const SUMMARY_KEYS = ['label', 'bloomsLevel', 'status', 'state', 'role', 'confidence', 'method', 'value', 'unit'] as const;

export function summarize(doc: TerminusDocument): Summary {
  const out: Record<string, unknown> = { id: doc['@id'], type: doc['@type'] };
  for (const key of SUMMARY_KEYS) {
    const value = doc[key];
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out as unknown as Summary;
}

/** Position in Bloom's taxonomy, lowest first; -1 when the document has no level. */
export const bloomsRank = (level: unknown): number =>
  typeof level === 'string' ? (VALID_BloomsLevel as readonly string[]).indexOf(level) : -1;

export const idsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
