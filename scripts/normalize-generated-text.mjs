/**
 * Text generated from schemas is compared as source, not as a platform-native text file.
 *
 * Windows checkouts may expose committed files with CRLF while generators and formatters return
 * LF, or the reverse. Treating that transport detail as schema drift makes the same contract fail
 * on one host only, so both sides cross this boundary in one canonical form.
 */
export function normalizeGeneratedText(value) {
  return String(value).replace(/\r\n?/g, '\n');
}
