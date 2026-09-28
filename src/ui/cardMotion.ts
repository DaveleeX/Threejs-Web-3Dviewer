/** Small pointer-driven tilt, with all motion suspended outside the homepage. */
export function mountCardMotion(track: HTMLElement): void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  for (const card of track.querySelectorAll<HTMLElement>('.project-card')) {
    // Keep the hit area and scroll-snap box still. Only this inner surface tilts,
    // so its changing bounds cannot feed back into pointer coordinates.
    const surface = document.createElement('div');
    surface.className = 'project-card-surface';
    surface.append(...Array.from(card.childNodes));
    card.append(surface);
    let raf = 0;
    let x = 0;
    let y = 0;
    const reset = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      card.classList.remove('is-following');
      for (const key of ['--tilt-x', '--tilt-y', '--shift-x', '--shift-y', '--shine-x', '--shine-y']) card.style.removeProperty(key);
    };
    card.addEventListener('pointermove', (event) => {
      if (reduced.matches || !finePointer.matches || event.buttons || document.body.classList.contains('project-preview-open')) return;
      const rect = card.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        card.classList.add('is-following');
        card.style.setProperty('--tilt-x', `${2 - y * 3}deg`);
        card.style.setProperty('--tilt-y', `${-5 + x * 4}deg`);
        card.style.setProperty('--shift-x', `${x * 4}px`);
        card.style.setProperty('--shift-y', `${y * 3}px`);
        card.style.setProperty('--shine-x', `${(x + 1) * 50}%`);
        card.style.setProperty('--shine-y', `${(y + 1) * 50}%`);
      });
    }, { passive: true });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointerdown', reset);
    track.addEventListener('scroll', reset, { passive: true });
    reduced.addEventListener('change', reset);
  }
}
