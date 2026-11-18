# 可插拔渲染组件

本轮增加源码 XPBD 软体、GPU 高度碰撞降雨和湿表面涟漪；仍在实验区。
默认使用清晰 HDR 背景。长期切换的环境/LUT/镜面透射缓存问题已修复。
完整状态、限制、源码许可和验证见 REFERENCE_RESEARCH.md 的第三轮记录。

```ts
applyEffectPreset(viewer, 'jelly'); // 当前静态模型；Shift + 拖动；自动休眠
viewer.effects.remove('surface');
applyEffectPreset(viewer, 'wet'); // 保留原 PBR 贴图；朝上表面涟漪
applyEffectPreset(viewer, 'rain', {
  rain: { count: 3000, splashAtlas: ownedFiveFrameTexture }, // 图集可省略；不含默认水花素材
});
viewer.effects.remove('atmosphere');
```

雨碰撞依赖当前模型，换模型会移除；jelly 支持最多 8 个静态网格，
使用原 GPL-3.0 物理源码及本地体积笼适配器，光学还未复现完整参考。
湿表面是独立 surface 槽位，不会与其他替换材质的预设叠加。

**画质状态更新（2026-11-18）：正式入口仅保留镜面地台和表面苔藓；其余旧预设均在默认折叠的实验区。下表描述旧原型能力，不代表参考案例的实现或画质。**

羽毛现有两个入口：`applyEffectPreset(viewer, 'feather')` 直接覆盖当前静态模型，使用原羽片生成器、结构色和阴影；`openFeatherReference(viewer)` 保留原鸟场景作为对照。玻璃的 `glass` 预设已替换为场景内透镜，使用 MIT 源码中的倒角厚度曲线、五波长色散和环境反射。两者仍在实验区，模型接入通过不等于画质验收。源码依据、待办和验收标准见 [REFERENCE_RESEARCH.md](./REFERENCE_RESEARCH.md)，第三方许可与改动见各 vendor 目录的 NOTICE.md。

入口：侧栏底部「渲染组件库」。默认全部关闭。点击一次启用，再次点击撤销。
同类预设替换；不同槽位可以组合；「移除全部组件」恢复原有场景。
幅度/长度、速度作用于下一次应用。需要改变已启用效果时，先撤销，再应用。

## 清单覆盖

| 原始 MD 案例 | 处理方式 | 当前边界 |
| --- | --- | --- |
| Oscar Dumlao 水面 | water-calm / water-ocean | 解析波浪＋PBR 环境高光；无液体求解、泡沫 |
| Infinite Liquid Glass | glass / frosted | 模型物理透射材质；无液态 UI 轮廓形变 |
| raytracing6 | gem + 独立路径追踪窗口 | 晶体材质与静态多反弹路径追踪分开实现 |
| Jelly Baby | jelly | 体积保持的弹性脉动＋果冻材质；无拖拽软体求解 |
| Balloons / cloth | cloth | 新增固定角布片，Verlet 约束、风、地面；无充气压力 |
| 0xrinx 毛发 | fur | 表面采样的几何纤维；无梳理、多重散射 |
| Codevember 05 Moss | moss | 实例化叶簇；无原项目的物种笔刷 |
| Codevember 12 Feather | feather | 程序化羽片、虹彩；无鸟模型、骨骼和飞行 |
| GSI 方向盘、Rolex、Toyota | metal / carpaint；玻璃预设复用 | 原灯光、镜头、PBR 保留；不复制产品模型或业务配置器 |
| Threejs-Punk Drive | rain / mirror | 空间雨粒、平面镜面地台；不是完整雨夜驾驶场景 |
| Sublevel Studio | 复用原有灯光、阴影、环境、后期 | 未复制室内场景与小游戏 |
| ACES 配置 | 保留已有 ACES Filmic / AgX / LUT | 不冒充完整 OCIO / ACES 2.0 管线 |
| Shelf Stories | 保留现有模型查看与拾取 | 书架信息架构不是独立渲染组件 |
| dream-loop | 不植入运行时 | 创作与评价工作流，不是渲染算法 |
| cuvii motion、伪 3D 信息/图片案例 | 不植入渲染层 | 页面交互与 UI 动效；原页面框架保持不变 |
| xiaoerzhan GPU 帖子 | 不切换引擎 | 未核实可移植算法；WebGPU 是后端架构，不是一个效果预设 |

旧预设的实现为独立编写的同类原型，并非上述项目的完整复刻。新增 vendor/feather 是保留 MIT 许可的原版源码，不能混同为自主编写。
每个卡片链接的是视觉/功能参考，不表示该项目源码已被集成或授权。
新增依赖 three-gpu-pathtracer 0.0.24 与 three-mesh-bvh 0.9.8 均为 MIT；
选择 WebGL 兼容版本，保留现有 Three.js 版本。未复制第三方模型和纹理。

## 调用

新增模型接入 API：

```ts
applyEffectPreset(viewer, 'feather', {
  strength: 1, speed: 0.5,
  feather: { look: 'gorget', direction: [0, -1, 0], count: 6000,
    meshIds: [viewer.getEffectMeshes()[0].uuid] },
});
viewer.effects.remove('growth');

applyEffectPreset(viewer, 'glass', {
  strength: 1, glass: { size: [2, 1.5], position: [0, 1, 1.5], rotation: [0, 0, 0] },
});
// 不提供 size/position/rotation 时自动放在模型与相机之间。
viewer.effects.remove('surface');
```

羽毛支持静态网格；不为骨骼/Morph 模型生成绑定、不自动推断鸟类羽区，不包含原鸟的绒毛壳层。玻璃是具有明确边界的透镜，不是任意网格体积玻璃：场景捕获不可见的物体和多层互相折射不在本模块能力内。已有环境、相机、后期管线和模型材质不被覆盖。

```ts
import { applyEffectPreset, EFFECT_PRESETS } from './effects/catalog';
applyEffectPreset(viewer, 'moss', { strength: 0.8, speed: 0.5 });
applyEffectPreset(viewer, 'glass');
viewer.effects.remove('growth');
viewer.effects.remove('surface');
viewer.effects.dispose(); // 可再次添加，不销毁 Viewer
```

15 个实时预设的 ID、槽位、描述、来源、工厂均由 `catalog.ts` 注册。
`openPathTracePreview(viewer)` 是另外一个按需加载的渲染会话入口。

## 框架边界

- EffectHost 只管理 mount/update/dispose，复用 Viewer 的 scene 与时钟。
- 模型表面组件使用原模型对象，保存并恢复材质/几何引用，不修改源资产。
- clearModel 和切换着色/通道隔离前清理模型组件，避免悬空引用或覆盖原材质。
- 表面组件目前应用到全部可用静态网格；不支持高斯、骨骼、Morph、InstancedMesh。
- 生长组件最多处理前 32 个可用网格，按质量档共享实例预算；采样在各网格内按面积分布。
- 形变/生长限制总顶点数 30 万。模型使用查看器当前单位；默认自动归一化为 2。
- 水、布片和反射地台独立于模型，换模型后保留；可单独或一键移除。
- 每个模块负责自己的 geometry/material/实例资源；异常更新会停用该模块。
- 现有环境、灯光、阴影、调色、相机、资产加载均继续使用原系统。
- 不新增完整场景编辑器、场景持久化或任何渲染器切换。

## 静帧路径追踪

打开独立对话框，暂停实时 Viewer，快照当前静态模型及主场景方向光。
不包括附加实例、布料、雨、水、辅助网格、接影地面与后期链。
当前模型上应用的玻璃等标准物理材质会进入快照。
HDR/EXR 环境使用原图；程序化环境改为中性天空，界面有说明。
支持低档 3 次／其他档 5 次反弹、最多 64 samples、暂停/继续及 PNG 导出；低档 128×96、中档 512×384、高档 640×480。
限制 30 万三角形。关闭或初始化失败会释放独立资源并恢复实时 Viewer。
不能将该入口视为整个场景的无差异离线渲染或降噪最终出图。

## 验证

```sh
npm run build
# 开启 npm run dev 后执行
node scripts/effects-smoke.mjs
```

测试覆盖 15 个预设启停、同槽位替换、组合清理、原材质/几何恢复、
生长对象卸载、布料数值稳定性、路径追踪采样与 PNG 导出、关闭后实时预览恢复。
截图输出到被 git 忽略的 smoke-out/effects。
