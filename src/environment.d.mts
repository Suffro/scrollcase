/**
 * Merges environment maps in precedence order and removes case-only duplicates on Windows.
 *
 * @param {'macos' | 'linux' | 'windows' | NodeJS.Platform} platform
 * @param {...NodeJS.ProcessEnv} layers
 * @returns {Record<string, string>}
 */
export function mergeEnvironmentLayers(platform: "macos" | "linux" | "windows" | NodeJS.Platform, ...layers: NodeJS.ProcessEnv[]): Record<string, string>;
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
export function resolveEnvironment(options: {
    platform: "macos" | "linux" | "windows";
    layers: readonly {
        source: EnvironmentSource;
        values?: NodeJS.ProcessEnv;
    }[];
    executionAffectingVariables?: readonly string[];
    expanded?: boolean;
    revealHostValues?: boolean;
}): {
    environment: Record<string, string>;
    report: EnvironmentReport;
};
/**
 * Returns whether the compact default has anything actionable to say.
 * @param {EnvironmentReport} report
 */
export function shouldReportEnvironment(report: EnvironmentReport): boolean;
/**
 * Formats one report for stderr. Signed values are visible; inherited host values stay masked.
 * @param {EnvironmentReport} report
 */
export function formatEnvironmentReport(report: EnvironmentReport): string[];
export type EnvironmentSource = "host" | "caller" | "validation" | "release";
export type EnvironmentSourceValue = {
    source: EnvironmentSource;
    /**
     * exact spelling supplied by that source
     */
    name: string;
    /**
     * masked for inherited host values unless explicitly revealed
     */
    value: string;
};
export type EnvironmentVariableReport = {
    /**
     * exact spelling of the winning variable
     */
    name: string;
    /**
     * winning source
     */
    source: EnvironmentSource;
    /**
     * winning value, subject to host-value masking
     */
    value: string;
    /**
     * whether an inherited host variable can change executed code
     */
    executionAffecting: boolean;
    /**
     * whether sources supplied different values
     */
    conflict: boolean;
    /**
     * values in precedence order
     */
    sources: readonly EnvironmentSourceValue[];
};
export type EnvironmentReport = {
    mode: "summary" | "full";
    hostValuesRevealed: boolean;
    releaseVariableCount: number;
    conflictCount: number;
    dangerousHostVariables: readonly string[];
    /**
     * variables omitted from the compact summary
     */
    remainingVariableCount: number;
    variables: readonly EnvironmentVariableReport[];
};
