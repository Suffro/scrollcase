/**
 * Argument parsing at the CLI edge.
 *
 * The `--` separator is a hard boundary: every string after it belongs unchanged to the box
 * application, even when it looks like a Scrollcase flag or contains shell syntax.
 */

/** Parses `--name=value`, `--name value`, bare flags, and an application argument tail. */
export function parseArgs(values) {
  const positional = [];
  const flags = new Map();
  let passthrough = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--') {
      passthrough = values.slice(index + 1);
      break;
    }
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else flags.set(name, true);
  }
  return { positional, flags, passthrough };
}
