---
title: JSON Schemas
description: Public schema URLs, package imports, offline registration, generated types, and compatibility.
---

# JSON Schemas

The shipped JSON Schemas are available both from the package and at stable public URLs:

```text
https://scrollcase.dev/schema/v2/target.schema.json
https://scrollcase.dev/schema/v2/scroll.schema.json
https://scrollcase.dev/schema/v2/box-manifest.schema.json
https://scrollcase.dev/schema/v2/release-manifest.schema.json
https://scrollcase.dev/schema/v2/channel-manifest.schema.json
https://scrollcase.dev/schema/v2/revocations-manifest.schema.json
https://scrollcase.dev/schema/v2/signed-document.schema.json
```

The documentation build fails unless these public files are byte-identical to
`src/contract/schema/`, so the npm package remains the single source.

## Package imports

Node can import an individual schema through the package export:

```js
import scrollSchema from 'scrollcase/contract/schema/scroll.schema.json'
  with { type: 'json' };
```

Or resolve a shipped file without relying on JSON module syntax:

```js
import { readFile } from 'node:fs/promises';
import { schemaUrl } from 'scrollcase/contract';

const scrollSchema = JSON.parse(await readFile(schemaUrl('scroll'), 'utf8'));
```

## Offline validation

Absolute `$id` and `$ref` values identify the same schemas whether validation is online or offline.
An offline validator must register every referenced document locally under its published `$id`;
it must not fetch the network during validation.

```js
import Ajv2020 from 'ajv/dist/2020.js';
import targetSchema from 'scrollcase/contract/schema/target.schema.json'
  with { type: 'json' };
import scrollSchema from 'scrollcase/contract/schema/scroll.schema.json'
  with { type: 'json' };

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(targetSchema);
const validateScroll = ajv.compile(scrollSchema);

if (!validateScroll(scroll)) throw new Error(ajv.errorsText(validateScroll.errors));
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

All active schemas describe `schemaVersion: 2`. A v2 verifier rejects v1 rather than interpreting
it through the new contract; historical v1 boxes remain usable with the immutable Scrollcase
versions that produced them. Target IDs, document-kind strings, payload encoding, signature
algorithm, and golden fixtures do not change silently at an existing `$id`. A future breaking
change requires another schema version.
