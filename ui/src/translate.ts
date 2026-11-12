export type Dictionary = Record<string, string>;

/** The text's translation in a dictionary, else the English text itself, with `{name}` placeholders filled. */
export function translate(dictionary: Dictionary, text: string, vars?: Record<string, string | number>): string {
  const out = dictionary[text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}
