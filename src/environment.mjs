/**
 * Environment resolution shared by every place Scrollcase runs a box interpreter.
 *
 * Inheritance is intentionally preserved: this is a provenance and precedence mechanism, not a
 * sandbox. Layers are merged in order, with the signed release last. Windows names are compared
 * case-insensitively because passing both `Path` and `PATH` to Node leaves the winning value to the
 * child-process serializer rather than to this contract.
 */

const MASKED_VALUE = '<masked>';

/** @typedef {'host' | 'caller' | 'validation' | 'release'} EnvironmentSource */

/**
 * @typedef {object} EnvironmentSourceValue
 * @property {EnvironmentSource} source
 * @property {string} name exact spelling supplied by that source
 * @property {string} value masked for inherited host values unless explicitly revealed
 */

/**
 * @typedef {object} EnvironmentVariableReport
 * @property {string} name exact spelling of the winning variable
 * @property {EnvironmentSource} source winning source
 * @property {string} value winning value, subject to host-value masking
 * @property {boolean} executionAffecting whether an inherited host variable can change executed code
 * @property {boolean} conflict whether sources supplied different values
 * @property {readonly EnvironmentSourceValue[]} sources values in precedence order
 */

/**
 * @typedef {object} EnvironmentReport
 * @property {'summary' | 'full'} mode
 * @property {boolean} hostValuesRevealed
 * @property {number} releaseVariableCount
 * @property {number} conflictCount
 * @property {readonly string[]} dangerousHostVariables
 * @property {number} remainingVariableCount variables omitted from the compact summary
 * @property {readonly EnvironmentVariableReport[]} variables
 */

function isCaseInsensitive(platform) {
  return platform === 'windows' || platform === 'win32';
}

function normalizedName(name, platform) {
  return isCaseInsensitive(platform) ? name.toUpperCase() : name;
}

function environmentEntries(values, source) {
  if (values === undefined || values === null) return [];
  if (typeof values !== 'object' || Array.isArray(values)) {
    throw new Error(`Box execution ${source} environment must map strings to strings.`);
  }
  const entries = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined && source === 'host') continue;
    if (name.length === 0 || name.includes('=') || name.includes('\0')
      || typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`Box execution ${source} environment must map valid names to string values.`);
    }
    entries.push([name, value]);
  }
  return entries;
}

/**
 * Merges environment maps in precedence order and removes case-only duplicates on Windows.
 *
 * @param {'macos' | 'linux' | 'windows' | NodeJS.Platform} platform
 * @param {...NodeJS.ProcessEnv} layers
 * @returns {Record<string, string>}
 */
export function mergeEnvironmentLayers(platform, ...layers) {
  const result = {};
  const names = new Map();
  for (const [index, layer] of layers.entries()) {
    const source = index === 0 ? 'host' : 'caller';
    for (const [name, value] of environmentEntries(layer, source)) {
      const normalized = normalizedName(name, platform);
      const previous = names.get(normalized);
      if (previous !== undefined && previous !== name) delete result[previous];
      names.set(normalized, name);
      result[name] = value;
    }
  }
  return result;
}

/**
 * Resolves execution layers and produces the masked diagnostic returned by the consumer APIs.
 *
 * @param {{
 *   platform: 'macos' | 'linux' | 'windows',
 *   layers: readonly { source: EnvironmentSource, values?: NodeJS.ProcessEnv }[],
 *   executionAffectingVariables?: readonly string[],
 *   expanded?: boolean,
 *   revealHostValues?: boolean,
 * }} options
 * @returns {{ environment: Record<string, string>, report: EnvironmentReport }}
 */
export function resolveEnvironment(options) {
  const {
    platform,
    layers,
    executionAffectingVariables = [],
    expanded = false,
    revealHostValues = false,
  } = options;
  const records = new Map();
  const environment = {};
  const environmentNames = new Map();

  for (const layer of layers) {
    for (const [name, value] of environmentEntries(layer.values, layer.source)) {
      const normalized = normalizedName(name, platform);
      const record = records.get(normalized) ?? { sources: [] };
      record.sources.push({ source: layer.source, name, value });
      record.winner = { source: layer.source, name, value };
      records.set(normalized, record);

      const previous = environmentNames.get(normalized);
      if (previous !== undefined && previous !== name) delete environment[previous];
      environmentNames.set(normalized, name);
      environment[name] = value;
    }
  }

  const dangerous = new Set(executionAffectingVariables.map((name) => normalizedName(name, platform)));
  const allVariables = [...records.entries()].map(([normalized, record]) => {
    const hostSource = record.sources.find((entry) => entry.source === 'host');
    const executionAffecting = dangerous.has(normalized) && hostSource !== undefined;
    const conflict = new Set(record.sources.map((entry) => entry.value)).size > 1;
    const visibleValue = (entry) => entry.source === 'host' && !revealHostValues
      ? MASKED_VALUE
      : entry.value;
    return {
      name: record.winner.name,
      source: record.winner.source,
      value: visibleValue(record.winner),
      executionAffecting,
      conflict,
      sources: record.sources.map((entry) => ({
        source: entry.source,
        name: entry.name,
        value: visibleValue(entry),
      })),
      selected: record.sources.some((entry) => entry.source === 'release')
        || executionAffecting
        || conflict,
    };
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  const selected = expanded ? allVariables : allVariables.filter((entry) => entry.selected);
  const variables = selected.map(({ selected: _selected, ...entry }) => entry);
  const dangerousHostVariables = allVariables
    .filter((entry) => entry.executionAffecting)
    .map((entry) => entry.sources.find((source) => source.source === 'host').name);
  return {
    environment,
    report: {
      mode: expanded ? 'full' : 'summary',
      hostValuesRevealed: revealHostValues,
      releaseVariableCount: allVariables.filter((entry) =>
        entry.sources.some((source) => source.source === 'release')).length,
      conflictCount: allVariables.filter((entry) => entry.conflict).length,
      dangerousHostVariables,
      remainingVariableCount: allVariables.length - variables.length,
      variables,
    },
  };
}

/**
 * Returns whether the compact default has anything actionable to say.
 * @param {EnvironmentReport} report
 */
export function shouldReportEnvironment(report) {
  return report.mode === 'full'
    || report.releaseVariableCount > 0
    || report.conflictCount > 0
    || report.dangerousHostVariables.length > 0;
}

/**
 * Formats one report for stderr. Signed values are visible; inherited host values stay masked.
 * @param {EnvironmentReport} report
 */
export function formatEnvironmentReport(report) {
  const lines = ['Environment:'];
  for (const variable of report.variables) {
    const details = [variable.source];
    if (variable.executionAffecting) details.push('host value can change executed code');
    if (variable.conflict) {
      const losers = [...new Set(variable.sources
        .map((source) => source.source)
        .filter((source) => source !== variable.source))];
      details.push(`${variable.source} wins over ${losers.join(', ')}`);
      details.push(`sources: ${variable.sources
        .map((source) => `${source.source}=${source.value}`)
        .join(', ')}`);
    }
    lines.push(`  ${variable.name}=${variable.value} [${details.join('; ')}]`);
  }
  if (report.remainingVariableCount > 0) {
    const noun = report.remainingVariableCount === 1 ? 'variable' : 'variables';
    lines.push(`  + ${report.remainingVariableCount} other inherited ${noun}`);
  }
  return lines;
}
