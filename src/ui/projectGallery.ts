import { createProjectWindow } from './projectWindow';
import { appendSketchfabCards } from './sketchfabGallery';
import { mountCardMotion } from './cardMotion';
import { mountCardPreviewVideos } from './cardPreviewVideo';
import '../styles/project-gallery.css';

/** Add a project here to include it in the home gallery. Posters live in public/projects. */
export const projects = [
  {
    id: 'iron-front', title: '废土战线', name: 'AI World of Tank',
    description: '驾驶装甲小队，进入 5v5 战场', tag: '交互游戏',
    poster: 'iron-front.jpg', url: 'https://ai3dworldoftank.vercel.app/',
    github: 'https://github.com/DaveleeX/AI-WorldOfTank',
  },
  {
    id: 'armour-atlas', title: '装甲蓝图', name: 'Armour Atlas',
    description: '程序化建模 · 分解结构 · 自由环绕', tag: '程序化模型',
    poster: 'armour-atlas.png', url: 'https://procedural-tank-web.vercel.app/',
    github: 'https://github.com/DaveleeX/Procedural-Tank-web',
  },
  {
    id: 'tank-museum', title: '微缩坦克博物馆', name: 'Tank Museum',
    description: '漫步五大展区，探索昼夜中的装甲世界', tag: '三维空间',
    poster: 'tank-museum.png',
    url: 'https://procedural-tank-web-git-tank-museum-live-daveleexs-projects.vercel.app/',
    github: 'https://github.com/DaveleeX/tank-museum',
  },
  {
    id: 'drink-and-run', title: '喝一杯就撤', name: 'NOCTURNE',
    description: '威士忌酒吧 · 玻璃光影 · 实时交互', tag: '光影场景',
    poster: 'drink-and-run.svg', url: 'https://1-drink-and-run.vercel.app/',
    github: 'https://github.com/DaveleeX/1-drink-and-run',
  },
] as const;

export function mountProjectGallery(onActive: (active: boolean) => void): void {
  const openProject = createProjectWindow(onActive);
  const gallery = document.createElement('section');
  gallery.className = 'project-gallery';
  gallery.setAttribute('aria-label', 'Three.js 项目精选');
  gallery.innerHTML = `
    <div class="project-gallery-heading">
      <h2>作品</h2>
      <div class="project-gallery-controls">
        <button type="button" aria-label="上一个项目">←</button>
        <button type="button" aria-label="下一个项目">→</button>
      </div>
    </div>
    <div class="project-track" tabindex="0" aria-label="项目海报，可上下滚动">
      <article class="project-card" data-preview-id="materials">
        <button class="project-poster" type="button" data-demo aria-label="预览示例场景">
          <img src="${import.meta.env.BASE_URL}projects/material-demo.svg" alt="材质示例" draggable="false" />
          <span class="project-play" aria-hidden="true">▷</span>
          <span class="project-caption"><strong>材质实验室</strong></span>
        </button>
      </article>
      ${projects.map((project, index) => `
        <article class="project-card" data-preview-id="${project.id}">
          <button class="project-poster" type="button" data-project="${index}" aria-label="预览${project.title}">
            <img src="${import.meta.env.BASE_URL}projects/${project.poster}" alt="${project.title}项目海报" draggable="false" />
            <span class="project-play" aria-hidden="true">↗</span>
            <span class="project-caption"><strong>${project.title}</strong></span>
          </button>
          <div class="project-card-footer">
            <a href="${project.github}" target="_blank" rel="noopener noreferrer" aria-label="${project.title}的 GitHub 仓库" title="GitHub"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.6 9.6 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg></a>
          </div>
        </article>`).join('')}
    </div>`;
  document.getElementById('app')!.append(gallery);

  const warmedOrigins = new Set<string>();
  const warmPreview = (event: Event) => {
    const poster = (event.target as Element).closest<HTMLButtonElement>('[data-project]');
    if (!poster) return;
    const origin = new URL(projects[Number(poster.dataset.project)].url).origin;
    if (warmedOrigins.has(origin)) return;
    warmedOrigins.add(origin);
    const hint = document.createElement('link');
    hint.rel = 'preconnect';
    hint.href = origin;
    document.head.append(hint);
  };
  gallery.addEventListener('pointerover', warmPreview, { passive: true });
  gallery.addEventListener('focusin', warmPreview);

  const track = gallery.querySelector<HTMLDivElement>('.project-track')!;
  appendSketchfabCards(track, openProject);
  mountCardMotion(track);
  mountCardPreviewVideos(track);
  const [previous, next] = gallery.querySelectorAll<HTMLButtonElement>('.project-gallery-controls button');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scroll = (direction: number) => track.scrollBy({
    top: direction * (track.querySelector<HTMLElement>('.project-card')!.offsetHeight + parseFloat(getComputedStyle(track).rowGap)),
    behavior: reducedMotion.matches ? 'instant' : 'smooth',
  });
  const updateControls = () => {
    previous.disabled = track.scrollTop < 2;
    next.disabled = track.scrollTop + track.clientHeight >= track.scrollHeight - 2;
  };
  previous.addEventListener('click', () => scroll(-1));
  next.addEventListener('click', () => scroll(1));
  track.addEventListener('scroll', updateControls, { passive: true });
  new ResizeObserver(updateControls).observe(track);
  track.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    scroll(event.key === 'ArrowDown' ? 1 : -1);
  });
  // Mouse dragging supplements native touch/trackpad scrolling.
  let drag: { x: number; left: number; moved: boolean } | undefined;
  let suppressClick = false;
  track.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as Element).closest('.project-card-footer a')) return;
    drag = { x: event.clientY, left: track.scrollTop, moved: false };
  });
  track.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const distance = event.clientY - drag.x;
    if (Math.abs(distance) > 5) {
      drag.moved = true;
      track.setPointerCapture(event.pointerId);
      track.classList.add('is-dragging');
    }
    if (drag.moved) track.scrollTop = drag.left - distance;
  });
  const endDrag = () => {
    suppressClick = drag?.moved ?? false;
    drag = undefined;
    track.classList.remove('is-dragging');
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('pointerleave', () => { if (!drag?.moved) drag = undefined; });

  gallery.addEventListener('click', (event) => {
    if (suppressClick && event.detail !== 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    suppressClick = false;
  }, { capture: true });
  gallery.addEventListener('click', (event) => {
    const demo = (event.target as Element).closest<HTMLButtonElement>('[data-demo]');
    if (demo) {
      const url = new URL(import.meta.env.BASE_URL, location.origin);
      url.searchParams.set('showcase', 'materials');
      openProject({ title: '材质实验室', poster: 'material-demo.svg', url: url.href, github: '' }, demo);
      return;
    }
    const poster = (event.target as Element).closest<HTMLButtonElement>('[data-project]');
    if (poster) { event.preventDefault(); openProject(projects[Number(poster.dataset.project)], poster); return; }
    const link = (event.target as Element).closest<HTMLAnchorElement>('a');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Open synchronously to retain the user gesture in embedded browsers.
    let popup: Window | null = null;
    try {
      popup = window.open('about:blank', '_blank');
      if (popup) {
        popup.opener = null;
        popup.location.replace(link.href);
        return;
      }
    } catch {
      popup?.close();
    }
    window.location.assign(link.href);
  });
}
