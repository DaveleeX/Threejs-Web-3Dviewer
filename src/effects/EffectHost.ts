import type { Scene } from 'three';

export interface SceneEffect {
  readonly id: string;
  readonly presetId?: string;
  readonly modelScoped?: boolean;
  mount(scene: Scene): void;
  update(delta: number): void;
  dispose(): void;
}

/** Optional effects share the viewer clock; they never own the renderer. */
export class EffectHost {
  readonly events = new EventTarget();
  private readonly effects = new Map<string, SceneEffect>();
  constructor(private readonly scene: Scene) {}

  add(effect: SceneEffect): void {
    this.remove(effect.id);
    try {
      effect.mount(this.scene);
      this.effects.set(effect.id, effect);
      this.events.dispatchEvent(new Event('change'));
    } catch (error) {
      effect.dispose();
      throw error;
    }
  }

  remove(id: string): void {
    this.effects.get(id)?.dispose();
    this.effects.delete(id);
    this.events.dispatchEvent(new Event('change'));
  }

  has(id: string): boolean { return this.effects.has(id); }
  activePreset(id: string): string | undefined { return this.effects.get(id)?.presetId; }
  clearModelEffects(): void {
    for (const [id, effect] of this.effects) if (effect.modelScoped) this.remove(id);
  }

  update(delta: number): void {
    for (const effect of this.effects.values()) {
      try { effect.update(Math.min(Math.max(delta, 0), 0.05)); }
      catch (error) {
        this.remove(effect.id);
        this.events.dispatchEvent(new CustomEvent('error', { detail: error }));
      }
    }
  }

  dispose(): void {
    for (const id of this.effects.keys()) this.remove(id);
  }
}
