# @armature/types

Armature's schema as TypeScript. Everything here is **generated** from `schema/schema.json` by `scripts/generate-types.js`; never edit `src/` by hand. Run `npm run generate:types` at the repository root after a schema change, and `npm run check:types` (CI runs it) to confirm the two agree.

| Import | What it gives |
|---|---|
| `@armature/types` | One interface per class, enum union types with their `VALID_*` arrays, and the schema as data: `CLASS_CATEGORY`, `SUBDOCUMENT_CLASSES`, `CLASS_ANCESTORS`, `CLASS_KEY`, `CLASS_FIELDS` |
| `@armature/types/schemas` | One strict Zod request schema per concrete class, as the write routes check a body |

The package ships TypeScript source and no build: a bundler (Next.js with `transpilePackages`, Vite, Vitest) compiles it with the code that imports it. Inside this repository the app depends on it as a workspace; another repository can install it by git reference (pnpm: `github:mossglenn/armature#path:packages/types`). A built `dist/` can be added when a consumer without a bundler appears.

The API reference is `docs/api.md`; the conceptual guide to the schema is `docs/schema-guide.md`; the field-by-field appendix, also generated, is `docs/SCHEMA_APPENDIX.md`.
