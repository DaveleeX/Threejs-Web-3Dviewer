import type { Vector3 } from 'three';
import type { JellyCage } from '../../JellyCage';
export class SoftBody {
  constructor(cage: JellyCage);
  x: Float64Array;
  rest: Float64Array;
  velocity: Float64Array;
  mass: Float64Array;
  totalMass: number;
  surfaceDirty: boolean;
  sleeping: boolean;
  center: Vector3;
  lastMinJacobian: number;
  step(h: number): boolean;
  updateSurface(): void;
  nudge(): void;
  reset(): void;
  wake(): void;
  isFinite(): boolean;
  volumeRatio(): number;
  grab: { weights: Array<[number, number]>; point: Vector3; target: Vector3; lambda: Float64Array } | null;
}
