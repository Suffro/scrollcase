/**
 * Returns the first structural disagreement with a schema, or null when the value matches.
 *
 * @param {unknown} value
 * @param {object} schema
 * @param {object[]} [relatedSchemas]
 * @returns {string | null}
 */
export function schemaValidationError(value: unknown, schema: object, relatedSchemas?: object[]): string | null;
