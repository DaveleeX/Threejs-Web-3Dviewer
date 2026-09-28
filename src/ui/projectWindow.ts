export type Project = { title: string; poster: string; url: string; github: string };

export function createProjectWindow(onActive: (active: boolean) => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-window';
  dialog.setAttribute('aria-labelledby', 'project-window-title');
  dialog.innerHTML = `
    <header><div><h2 id="project-window-title"></h2><span data-load-status role="status"></span></div>
      <nav aria-label="预览操作"><button class="btn" data-retry title="重新加载" aria-label="重新加载">↻</button>
      <button class="btn" data-close autofocus aria-label="关闭项目预览">✕</button></nav>
    </header>
    <div class="project-window-content">
      <div class="project-window-cover"><img alt="" /><div><span class="project-window-spinner"></span><p role="status">正在连接项目…</p></div></div>
    </div>`;
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('.project-window-content')!;
  const cover = dialog.querySelector<HTMLElement>('.project-window-cover')!;
  const status = cover.querySelector('p')!;
  const loadStatus = dialog.querySelector<HTMLElement>('[data-load-status]')!;
  let frame: HTMLIFrameElement | undefined;
  let project: Project | undefined;
  let opener: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const load = () => {
    if (!project) return;
    clearTimeout(timer);
    frame?.remove();
    cover.classList.remove('is-ready', 'is-slow');
    status.textContent = '正在连接项目…';
    loadStatus.textContent = '';
    const next = document.createElement('iframe');
    frame = next;
    next.title = `${project.title}交互预览`;
    next.allow = 'fullscreen; autoplay; gamepad';
    next.allowFullscreen = true;
    next.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads allow-forms');
    next.addEventListener('load', () => {
      if (frame !== next || closing || !dialog.open) return;
      clearTimeout(timer);
      next.classList.add('is-ready');
      cover.classList.add('is-ready');
      loadStatus.textContent = '';
    }, { once: true });
    next.src = project.url;
    content.prepend(next);
    timer = setTimeout(() => {
      if (frame !== next || closing || !dialog.open) return;
      // Fonts or other remote resources can delay load after the scene appears.
      // Reveal the frame so a slow resource cannot keep the scene covered.
      next.classList.add('is-ready');
      cover.classList.add('is-ready');
      loadStatus.textContent = '连接较慢，若空白请点 ↻ 重试';
    }, 8000);
  };
  const close = async () => {
    if (closing || !dialog.open) return;
    closing = true;
    clearTimeout(timer);
    dialog.classList.add('is-closing');
    const animation = dialog.animate([
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(12px) scale(.975)' },
    ], { duration: reducedMotion.matches ? 0 : 180, easing: 'ease-in', fill: 'forwards' });
    await animation.finished.catch(() => {});
    dialog.close();
    animation.cancel();
    frame?.remove();
    frame = undefined;
    document.body.classList.remove('project-preview-open');
    onActive(false);
    opener?.focus({ preventScroll: true });
    closing = false;
  };
  dialog.querySelector('[data-close]')!.addEventListener('click', () => void close());
  dialog.querySelector('[data-retry]')!.addEventListener('click', () => { if (!closing) load(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); void close(); });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) void close();
  });
  return (item: Project, source: HTMLElement) => {
    if (dialog.open || closing) return;
    project = item;
    opener = source;
    dialog.querySelector('h2')!.textContent = item.title;
    cover.querySelector('img')!.src = item.poster.startsWith('https://')
      ? item.poster : `${import.meta.env.BASE_URL}projects/${item.poster}`;
    cover.classList.remove('is-ready', 'is-slow');
    dialog.classList.remove('is-closing');
    document.body.classList.add('project-preview-open');
    onActive(true);
    dialog.showModal();
    load();
  };
}
