export function getAnimationChoiceLabels(
  ids: readonly string[],
  labels: Readonly<Record<string, string>>,
  available: readonly string[],
): Map<string, string> {
  const names = ids.map((id) => available.includes(id) ? labels[id] || id : 'Missing animation');
  const reserved = new Set(names);
  const used = new Set<string>();
  const choices = new Map<string, string>();
  for (const [index, id] of ids.entries()) {
    const name = names[index];
    let display = name;
    for (let count = 2; used.has(display) || (display !== name && reserved.has(display)); count++) {
      display = `${name} (${count})`;
    }
    used.add(display);
    choices.set(id, display);
  }
  return choices;
}
