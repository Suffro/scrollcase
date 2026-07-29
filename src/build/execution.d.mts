/**
 * Confirms that optional execution metadata names runnable regular files in a payload/archive.
 *
 * `files` must contain only regular archive entries. Both collectFiles() during build and the ZIP
 * entry classifier during verify provide exactly that representation.
 */
export function assertExecutionFiles({ execution, adapter, pythonVersion, files, }: {
    execution: any;
    adapter: any;
    pythonVersion: any;
    files: any;
}): void;
