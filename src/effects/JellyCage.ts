import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface JellyCage {
  pos: Float64Array;
  tets: number[][];
  volumes: number[];
  totalVolume: number;
  contactBindings: Array<Array<[number, number]>>;
  surface: {
    geometry: THREE.BufferGeometry; positions: Float32Array; restNormals: Float32Array;
    bindingIds: Uint32Array; bindingWeights: Float64Array;
  };
}

/** Voxel volume cage with conforming six-tet cells, bound to the user's actual mesh.
 * The upstream solver consumes this cage without changing its constitutive law.
 */
export function createJellyCage(geometry: THREE.BufferGeometry, resolution = 4): JellyCage {
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const bounds = geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  if (Math.min(size.x, size.y, size.z) < span * .001) throw new Error('软体需要具有体积的模型，不能使用单层平面');
  bounds.expandByScalar(span * .0001); bounds.getSize(size);
  const positions = geometry.attributes.position.array as Float32Array;
  const n = resolution, stride = n + 1, index = (x: number, y: number, z: number) => x + stride * (y + stride * z);
  const nodes: number[] = [], cells = new Map<number, number[][]>();
  for (let z = 0; z <= n; z++) for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++)
    nodes.push(bounds.min.x + size.x * x / n, bounds.min.y + size.y * y / n, bounds.min.z + size.z * z / n);
  const cellAt = (x: number, y: number, z: number) => [x, y, z].map((v, axis) =>
    Math.max(0, Math.min(n - 1, Math.floor((v - bounds.min.getComponent(axis)) / size.getComponent(axis) * n))));
  const key = (x: number, y: number, z: number) => x + n * (y + n * z);
  const occupied = new Set<number>();
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = cellAt(positions[i], positions[i + 1], positions[i + 2]);
    occupied.add(key(x, y, z));
  }
  // Include interior cells; rays are only used during setup and accelerated by BVH.
  const tree = new MeshBVH(geometry, { indirect: true });
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, .0137, .0071).normalize());
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = key(x, y, z);
    if (!occupied.has(k)) {
      ray.origin.set(bounds.min.x + size.x * (x + .5) / n, bounds.min.y + size.y * (y + .5) / n, bounds.min.z + size.z * (z + .5) / n);
      const hits = tree.raycast(ray, THREE.DoubleSide).sort((a, b) => a.distance - b.distance);
      const crossings = hits.filter((hit, i) => i === 0 || hit.distance - hits[i - 1].distance > span * 1e-7).length;
      if (crossings % 2) occupied.add(k);
    }
    if (!occupied.has(k)) continue;
    const a = index(x, y, z), b = index(x + 1, y, z), c = index(x, y + 1, z), d = index(x + 1, y + 1, z);
    const e = index(x, y, z + 1), f = index(x + 1, y, z + 1), g = index(x, y + 1, z + 1), h = index(x + 1, y + 1, z + 1);
    cells.set(k, [[a,b,d,h],[a,d,c,h],[a,c,g,h],[a,g,e,h],[a,e,f,h],[a,f,b,h]]);
  }
  const ids = new Uint32Array(positions.length / 3 * 4), weights = new Float64Array(ids.length);
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  const matrix = new THREE.Matrix3(), bary = new THREE.Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    p.fromArray(positions, i * 3);
    const xyz = cellAt(p.x, p.y, p.z), tets = cells.get(key(xyz[0], xyz[1], xyz[2]))!;
    let found = false;
    for (const tet of tets) {
      a.fromArray(nodes, tet[0] * 3); b.fromArray(nodes, tet[1] * 3).sub(a);
      c.fromArray(nodes, tet[2] * 3).sub(a); d.fromArray(nodes, tet[3] * 3).sub(a);
      matrix.set(b.x,c.x,d.x,b.y,c.y,d.y,b.z,c.z,d.z).invert();
      bary.copy(p).sub(a).applyMatrix3(matrix);
      const w = [1 - bary.x - bary.y - bary.z, bary.x, bary.y, bary.z];
      if (w.every(value => value >= -1e-6)) {
        ids.set(tet, i * 4); weights.set(w, i * 4); found = true; break;
      }
    }
    if (!found) throw new Error('无法将表面绑定到软体体积网格');
  }
  // Remove unused lattice nodes so the original solver never receives zero mass.
  const tets = [...cells.values()].flat(), used = [...new Set(tets.flat())].sort((a,b) => a-b);
  const remap = new Map(used.map((value, i) => [value, i]));
  const compact = new Float64Array(used.length * 3);
  used.forEach((value, i) => compact.set(nodes.slice(value * 3, value * 3 + 3), i * 3));
  for (const tet of tets) for (let i = 0; i < 4; i++) tet[i] = remap.get(tet[i])!;
  for (let i = 0; i < ids.length; i++) ids[i] = remap.get(ids[i])!;
  const volume = size.x * size.y * size.z / (n * n * n * 6);
  const contacts: JellyCage['contactBindings'] = used.map((_id, i) => [[i, 1]]);
  return { pos: compact, tets, volumes: tets.map(() => volume), totalVolume: volume * tets.length,
    contactBindings: contacts, surface: { geometry, positions, restNormals: new Float32Array(geometry.attributes.normal.array),
      bindingIds: ids, bindingWeights: weights } };
}
