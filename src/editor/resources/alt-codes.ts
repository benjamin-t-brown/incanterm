// The main table at https://www.alt-codes.net/, in numeric order within each page.
// \0 marks an unlisted code. The table's "spc" entries are space (32) and NBSP (255, 0160).
export const ALT_CODE_PAGES = [
  {
    title: 'OEM Alt 1–127',
    start: 1,
    prefix: '',
    glyphs:
      '☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼' +
      ' !"#$%&\'()*+,-./0123456789:;<=>?' +
      '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_' +
      '`abcdefghijklmnopqrstuvwxyz{|}~⌂',
  },
  {
    title: 'OEM Alt 128–255',
    start: 128,
    prefix: '',
    glyphs:
      'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
      'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝\0╛┐' +
      '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
      'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0',
  },
  {
    title: 'Windows Alt 0128–0255',
    start: 128,
    prefix: '0',
    glyphs:
      '€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ' +
      '\u00a0¡¢£¤¥¦§¨©ª«¬\0®¯°±²³´µ¶·¸¹º»¼½¾¿' +
      'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß' +
      'àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ',
  },
] as const;
