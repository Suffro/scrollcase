---
title: JSON Schemas
description: Public schema URLs, package imports, offline registration, generated types, and compatibility.
---

# JSON Schemas

The shipped JSON Schemas are available both from the package and at stable public URLs:

```text
https://scrollcase.dev/schema/target.schema.json
https://scrollcase.dev/schema/recipe.schema.json
https://scrollcase.dev/schema/box-manifest.schema.json
https://scrollcase.dev/schema/release-manifest.schema.json
https://scrollcase.dev/schema/channel-manifest.schema.json
https://scrollcase.dev/schema/revocations-manifest.schema.json
https://scrollcase.dev/schema/signed-document.schema.json
```

The documentation build fails unless these public files are byte-identical to
`src/contract/schema/`, so the npm package remains the single source.

## Package imports

Node can import an individual schema through the package export:

```js
import recipeSchema from 'scrollcase/contract/schema/recipe.schema.json'
  with { type: 'json' };
```

Or resolve a shipped file without relying on JSON module syntax:

```js
import { readFile } from 'node:fs/promises';
import { schemaUrl } from 'scrollcase/contract';

const recipeSchema = JSON.parse(await readFile(schemaUrl('recipe'), 'utf8'));
```

## Offline validation

Absolute `$id` and `$ref` values identify the same schemas whether validation is online or offline.
An offline validator must register every referenced document locally under its published `$id`;
it must not fetch the network during validation.

```js
import Ajv2020 from 'ajv/dist/2020.js';
import targetSchema from 'scrollcase/contract/schema/target.schema.json'
  with { type: 'json' };
import recipeSchema from 'scrollcase/contract/schema/recipe.schema.json'
  with { type: 'json' };

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(targetSchema);
const validateRecipe = ajv.compile(recipeSchema);

if (!validateRecipe(recipe)) throw new Error(ajv.errorsText(validateRecipe.errors));
```

Register `release-manifest.schema.json` before `box-manifest.schema.json`, because the latter
references the release provenance definition. Fragment references after `#` resolve inside the
registered document.

## Generated TypeScript types

`scrollcase/contract/types` contains declarations generated from these schemas. Contributors run:

```sh
npm run types
npm test
```

Never hand-edit `src/contract/types/index.d.ts`; the drift test checks the generated output.

## Compatibility

All current schemas describe `schemaVersion: 1`. Target IDs, document-kind strings, payload
encoding, the signature algorithm, and golden fixtures are frozen for that version. A breaking
format change requires a new schema version; it is never introduced by silently changing a schema
at an existing `$id`.
