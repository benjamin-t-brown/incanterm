import { pageShell } from './shell.js';

export function mountIndex(root: HTMLElement): void {
  root.innerHTML = pageShell(
    'Index',
    `<h1 class="page-title">Incanterm Editor</h1>
    <p class="page-copy">Author sprites, animations, props, scenes, sounds, and scripts. Run the game from the Game zone.</p>
    <section class="zone"><h2>AUTHORING</h2><div class="tool-grid">
      <a class="tool-card" href="/art"><strong>ART</strong><span>Paint sprite cells with the project palette.</span></a>
      <a class="tool-card" href="/animation"><strong>ANIMATION</strong><span>Arrange sprites into a clip and play it.</span></a>
      <a class="tool-card" href="/props"><strong>PROPS</strong><span>Define reusable world objects from sprites and animations.</span></a>
      <a class="tool-card" href="/soundboard"><strong>SOUNDBOARD</strong><span>Play each sound file in the project.</span></a>
      <a class="tool-card" href="/scripts"><strong>SCRIPT WRITER</strong><span>Edit RPGScript and read diagnostics.</span></a>
      <a class="tool-card" href="/scenes"><strong>SCENE</strong><span>Place backgrounds and props, and define triggers.</span></a>
    </div></section>
    <section class="zone"><h2>GAME</h2><div class="tool-grid">
      <a class="tool-card" href="/game"><strong>GAME</strong><span>Run and test the browser client.</span></a>
    </div></section>`,
  );
}
