import '../styles/xpull-download.css';

/** The hit area stays still while only the decorative logo tilts. */
export function mountXpullDownload(): void {
  const link = document.createElement('a');
  link.className = 'xpull-download';
  link.href = `${import.meta.env.BASE_URL}downloads/Xpull-1.6.0.zip`;
  link.download = 'Xpull-1.6.0.zip';
  link.setAttribute('aria-label', '下载 Xpull 1.6.0 浏览器扩展安装包（ZIP）');
  link.title = '下载 Xpull · Chrome / Edge 扩展';
  link.innerHTML = `
    <span class="xpull-emblem" aria-hidden="true">
      <span class="xpull-depth"></span>
      <img src="${import.meta.env.BASE_URL}projects/xpull-logo.png" alt="" width="128" height="128" />
      <span class="xpull-iridescence"></span>
    </span>
    <span class="xpull-label">Xpull <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg></span>
    <span class="xpull-hint">X帖子下载器</span>`;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  link.addEventListener('pointermove', (event) => {
    if (reduceMotion.matches || event.pointerType === 'touch') return;
    const bounds = link.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    link.style.setProperty('--xpull-rx', `${-y * 44 - 8}deg`);
    link.style.setProperty('--xpull-ry', `${x * 56 - 16}deg`);
  });
  link.addEventListener('pointerleave', () => {
    link.style.removeProperty('--xpull-rx');
    link.style.removeProperty('--xpull-ry');
  });
  document.getElementById('app')!.append(link);
}
