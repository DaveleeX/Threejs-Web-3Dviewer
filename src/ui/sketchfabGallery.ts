import { sketchfabEmbedSrc } from '../loaders/sketchfab';
import type { Project } from './projectWindow';

const models = [
  { title: 'Cyberpunk City', uid: 'a3b87f160df744928097d86d7e1ad0b5', short: '6XoBH',
    thumbnail: 'da36630aa73f4d0183f407ebdbb5e728/d3e7fb759a7e4f64b8795b8e5116eeec.jpeg' },
  { title: 'Ironman Prototype', uid: 'd20403f4e3734082a26b0aecd15927f1', short: '6UnGs',
    thumbnail: '1d01e62702f24cbd9b1ce2deb649b211/81691d01ba554467a00247633c99d13a.jpeg' },
  { title: 'A wheel of Lamborghini', uid: 'd9c4b5a2f333467f94a043b539605331', short: '6xzEA',
    thumbnail: '766f311bc60c40e7912573138c02b850/956c4bdf79d54589b1eca773fbc24a8d.jpeg' },
  { title: 'Venom', uid: '73c2a6fd21074c488477b6dba4c6908d', short: '6XqEI',
    thumbnail: 'af19f4e5b0ab47eaa54392b1c7dad798/c3bea9ef5f60470fb9e8c48c2693aa49.jpeg' },
];

export function appendSketchfabCards(track: HTMLElement, open: (project: Project, source: HTMLElement) => void): void {
  for (const model of models) {
    const poster = `https://media.sketchfab.com/models/${model.uid}/thumbnails/${model.thumbnail}`;
    const card = document.createElement('article');
    card.className = 'project-card';
    card.dataset.previewId = model.short;
    card.innerHTML = `
      <button class="project-poster" type="button" aria-label="预览 ${model.title}">
        <img src="${poster}" alt="${model.title}" draggable="false" loading="lazy" />
        <span class="project-caption"><strong>${model.title}</strong></span>
      </button>
      <div class="project-card-footer"><a href="https://skfb.ly/${model.short}" target="_blank" rel="noopener noreferrer" aria-label="${model.title} 的 Sketchfab 主页" title="Sketchfab">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10"/></svg>
      </a></div>`;
    const button = card.querySelector('button')!;
    button.addEventListener('click', () => open({
      title: model.title, poster, url: sketchfabEmbedSrc(model.uid), github: '',
    }, button));
    card.querySelector('img')!.addEventListener('error', (event) => {
      // The title remains usable if the image CDN is temporarily unavailable.
      (event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
    }, { once: true });
    track.append(card);
  }
}
