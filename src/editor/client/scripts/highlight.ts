// Color lexical forms, including partially typed lines. Syntax validation belongs to the compiler.
const tokens = /(?<comment>\/\/[^\n]*)|(?<string>"[^"\n]*"?|'[^'\n]*'?)|(?<header>[#@][\w@-]+)|(?<speaker>^[ \t]*[A-Za-z_][\w. -]*(?:&[\w-]+)?(?=:[ \t]*["']))|(?<reference>\[[\w-]+\]|\{[\w.-]+\})|(?<control>[?!][\w-]+)|(?<call>\b[A-Za-z_][\w-]*(?=[ \t]*\())|(?<event>^[ \t]*[A-Za-z]+(?=,))|(?<value>\b(?:true|false|\d+(?:\.\d+)?)\b)/gm;

function getEscapedMarkup(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderScriptHighlight(source: string): string {
  const parts: string[] = [];
  let end = 0;
  for (const match of source.matchAll(tokens)) {
    const kind = Object.keys(match.groups ?? {}).find((key) => match.groups?.[key] !== undefined);
    parts.push(getEscapedMarkup(source.slice(end, match.index)), `<span class="rpg-${kind}">`, getEscapedMarkup(match[0]), '</span>');
    end = match.index + match[0].length;
  }
  return parts.join('') + getEscapedMarkup(source.slice(end));
}
