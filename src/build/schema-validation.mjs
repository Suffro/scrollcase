/**
 * Runtime validation for the JSON Schemas Scrollcase ships.
 *
 * Ajv remains a development dependency because adding a fourth runtime package would widen the
 * installed surface for one narrow job. This validator implements the 2020-12 keywords used by the
 * recipe and target schemas, including local and absolute references and target conditionals. The
 * schemas remain the source of truth; this module deliberately contains no recipe field list.
 */

import { isDeepStrictEqual } from 'node:util';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const objectValue = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === 'object') return objectValue(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function decodePointerPart(part) {
  return decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveReference(reference, rootSchema, registry) {
  const [id, fragment = ''] = reference.split('#', 2);
  const document = id ? registry.get(id) : rootSchema;
  if (!document) throw new Error(`Schema reference is not registered: ${reference}`);
  if (!fragment) return { schema: document, rootSchema: document };
  if (!fragment.startsWith('/')) throw new Error(`Unsupported schema fragment: #${fragment}`);
  const schema = fragment.slice(1).split('/').map(decodePointerPart)
    .reduce((current, part) => current?.[part], document);
  if (!schema) throw new Error(`Schema reference does not resolve: ${reference}`);
  return { schema, rootSchema: document };
}

function validate(value, schema, context, path, errors) {
  if (schema.$ref) {
    const resolved = resolveReference(schema.$ref, context.rootSchema, context.registry);
    validate(value, resolved.schema, { ...context, rootSchema: resolved.rootSchema }, path, errors);
    if (errors.length > 0) return;
  }

  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.some((candidate) => isDeepStrictEqual(value, candidate))) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${schema.type}, received ${valueType(value)}`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`);
      return;
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path} does not match the required pattern`);
      return;
    }
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push(`${path} must be finite`);
      return;
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
      return;
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path} must be greater than ${schema.exclusiveMinimum}`);
      return;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
      return;
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
      return;
    }
    if (schema.items) {
      for (let index = 0; index < value.length && errors.length === 0; index += 1) {
        validate(value[index], schema.items, context, `${path}[${index}]`, errors);
      }
    }
  }

  if (objectValue(value)) {
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      errors.push(`${path} must contain at least ${schema.minProperties} property`);
      return;
    }
    for (const required of schema.required ?? []) {
      if (!own(value, required)) {
        errors.push(`${path}.${required} is required`);
        return;
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (own(value, key)) validate(value[key], propertySchema, context, `${path}.${key}`, errors);
      if (errors.length > 0) return;
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const unexpected = Object.keys(value).find((key) => !allowed.has(key));
      if (unexpected) {
        errors.push(`${path}.${unexpected} is not allowed`);
        return;
      }
    }
    for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
      if (!own(value, key)) continue;
      const missing = dependencies.find((dependency) => !own(value, dependency));
      if (missing) {
        errors.push(`${path}.${missing} is required when ${key} is present`);
        return;
      }
    }
  }

  for (const branch of schema.allOf ?? []) {
    validate(value, branch, context, path, errors);
    if (errors.length > 0) return;
  }

  if (schema.if) {
    const conditionErrors = [];
    validate(value, schema.if, context, path, conditionErrors);
    const branch = conditionErrors.length === 0 ? schema.then : schema.else;
    if (branch) validate(value, branch, context, path, errors);
  }

  if (schema.not) {
    const forbiddenErrors = [];
    validate(value, schema.not, context, path, forbiddenErrors);
    if (forbiddenErrors.length === 0) errors.push(`${path} matches a forbidden shape`);
  }
}

/**
 * Returns the first structural disagreement with a schema, or null when the value matches.
 *
 * @param {unknown} value
 * @param {object} schema
 * @param {object[]} [relatedSchemas]
 * @returns {string | null}
 */
export function schemaValidationError(value, schema, relatedSchemas = []) {
  const registry = new Map([schema, ...relatedSchemas]
    .filter((candidate) => candidate.$id)
    .map((candidate) => [candidate.$id, candidate]));
  const errors = [];
  validate(value, schema, { registry, rootSchema: schema }, '$', errors);
  return errors[0] ?? null;
}
