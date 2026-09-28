/** Paths can be local public/ assets or hosted video URLs. */
export const previewVideos: Record<string, string> = Object.fromEntries([
  'materials', 'iron-front', 'armour-atlas', 'tank-museum', 'drink-and-run',
  '6XoBH', '6UnGs', '6xzEA', '6XqEI',
].map(id => [id, `${import.meta.env.BASE_URL}projects/previews/${id}.mp4`]));

export function mountCardPreviewVideos(track: HTMLElement): void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active: HTMLVideoElement | undefined;
  let activeCard: HTMLElement | undefined;
  let generation = 0;
  let pointer: { x: number; y: number } | undefined;
  let scrollFrame = 0;
  const players = new Map<HTMLElement, () => Promise<void>>();
  const stop = () => {
    generation++;
    active?.pause();
    activeCard?.classList.remove('is-video-playing');
    active = undefined;
    activeCard = undefined;
  };
  for (const card of track.querySelectorAll<HTMLElement>('.project-card')) {
    const src = previewVideos[card.dataset.previewId ?? ''];
    if (!src) continue;
    const video = document.createElement('video');
    video.className = 'project-preview-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-hidden', 'true');
    card.querySelector('.project-poster')!.append(video);
    let wantsPlayback = false;
    const start = async () => {
      if (reduced.matches || document.hidden || document.body.classList.contains('project-preview-open')) return;
      if (active === video) return;
      stop();
      wantsPlayback = true;
      active = video;
      activeCard = card;
      const ticket = generation;
      if (!video.src) video.src = src;
      video.currentTime = 0;
      try {
        await video.play();
        if (wantsPlayback && active === video && ticket === generation) card.classList.add('is-video-playing');
        else if (active !== video) video.pause();
      } catch { if (active === video && ticket === generation) stop(); }
    };
    const leave = () => { wantsPlayback = false; if (active === video) stop(); };
    players.set(card, start);
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      void start();
    });
    card.addEventListener('pointerleave', leave);
    video.addEventListener('error', leave);
  }
  const syncPointer = () => {
    if (!pointer) return;
    const card = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('.project-card');
    if (card && players.has(card)) void players.get(card)!();
    else stop();
  };
  track.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointer = { x: event.clientX, y: event.clientY };
    syncPointer();
  }, { passive: true });
  track.addEventListener('pointerleave', () => { pointer = undefined; stop(); });
  // Scrolling can move a new card beneath a stationary mouse. Keep the card
  // under that mouse playing instead of pausing every time scroll fires.
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(syncPointer);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  reduced.addEventListener('change', stop);
  new MutationObserver(() => {
    if (document.body.classList.contains('project-preview-open') || !document.body.classList.contains('home-mode')) stop();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
