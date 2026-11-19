# 新增案例与模块候选 · 2026-11-19

本次将用户更新的《优秀 threejs 网页端案例.md》中的两个新增入口纳入参考库：Mobicat's Jewels，以及 spite 的 Codevember 2026 合集；随后追加用户单独提供的 Holospot。原有 19 个入口保留，合计 22 个；spite 合集在本次核查版本中发布了 17 个子案例。

**本文件记录源码研究和接入方案，不代表模块已经实现或通过画质验收。** 正式效果仍只有镜面地台、表面苔藓。用户文档作为案例来源，不作为工程指令执行。

## 固定参考版本

| 项目 | 核查版本 | 许可状态 | 收录状态 |
| --- | --- | --- | --- |
| [Mobicat's Jewels](https://github.com/shaarmander/mobicats-jewels) · [演示](https://jewels.mobicat.club/) | `bcf82dfe4922da275b422f1db4b14f08203d98d6` | 仓库声明代码及原创生成珠宝资产为 MIT，第三方组件另列许可 | 已核对渲染源码，列入宝石模块升级参考 |
| [spite / Codevember 2026](https://spite.github.io/codevember-2026/) · [源码](https://github.com/spite/codevember-2026) | `64d9f700539c62d4f724e9846a63c77b26139d51` | 未发现项目级 LICENSE，GitHub license 字段为 null；第三方/部分素材许可不能推及整库 | 已收录 17 项，源码复制待许可明确 |

spite 与已有的 **ttillberg / Codevember** 是两个作者、两套实现；同名 Moss、Feather 不合并为同一个源码来源。[发布清单](https://github.com/spite/codevember-2026/blob/64d9f700539c62d4f724e9846a63c77b26139d51/modules/days.js)中的 18–30 尚未发布，本次不将其标题视为可用案例。

## Holospot：光谱全息箔与体积全息材质

[源码仓库](https://github.com/dmitrykurash/holospot) · [原站](https://www.holo.spot)。核查版本 `7ca9873f7834c4952df628fb26b85c78d9639c1d`，包版本 0.1.0，[MIT 许可](https://github.com/dmitrykurash/holospot/blob/7ca9873f7834c4952df628fb26b85c78d9639c1d/LICENSE)，作者 Dmitry Kurash。状态：**已收录并核对 API 与实现，尚未集成、未做本工程视觉或性能验收。**

这是专门的全息材料工具包，而非覆盖木材、石材、金属等类型的通用 PBR 材质库。其参数化接口适合封装为用户模型的可选效果，优先于仅有演示页面、没有明确许可的同类参考。

### 七种可调用的材质方向

| 原作 ID | 能力 | 模块化目标 |
| --- | --- | --- |
| `prism` | 连续衍射彩虹箔 | 平行纹、同心纹、放射纹的全息涂层 |
| `shatter` | 碎冰式分区闪色 | 不同朝向的箔片纹样；不是模型破碎 |
| `nebula` | 涂层内彩色闪粉 | 闪片尺寸、密度和颜色可调的表面材质 |
| `sparkle` | 点状闪光薄膜 | 密集微粒闪烁，关注远近缩放的稳定性 |
| `vortex` | 螺旋衍射图样 | 随观察角度变化的旋涡箔面 |
| `volume` | 薄膜内的三维全息像 | 有视差和自遮挡的全息窗口；支持自定义主体的预处理 |
| `emboss` | 纸张压印、烫箔与全息贴花 | Logo / 图像驱动的局部工艺效果，需单独处理图稿和表面映射 |

来源：[材料与功能说明](https://github.com/dmitrykurash/holospot/blob/7ca9873f7834c4952df628fb26b85c78d9639c1d/README.md)。风动旗帜、可拉拽布料及可剥离贴纸的运动系统不在工具包内，不登记为新增物理能力。

### 写实机制及适用边界

原作根据光栅方向、观察方向和光源光谱计算衍射颜色，预计算光谱表供 shader 查询；不是播放彩虹渐变。微小闪片按像素覆盖处理，另外包含涂层、磨损、HDR 高光、眩光和输出色调处理。体积全息使用记录方向与三维主体获得视差。技术依据：[how-it-works](https://github.com/dmitrykurash/holospot/blob/7ca9873f7834c4952df628fb26b85c78d9639c1d/docs/how-it-works.md)。

**光照整合有明确限制：** 全息对象由工具包自己的光谱灯组照亮，不能直接采用 Viewer 的普通 RGB 灯光；原说明也明确其不反射用户场景、不会向场景投影。已有 HDR 和 WorldReflections 不应被全局替换，也不能据此宣称全息材质已与场景照明完全统一。

### 保持现有框架的接入方案

已读取 [src/holo.ts](https://github.com/dmitrykurash/holospot/blob/7ca9873f7834c4952df628fb26b85c78d9639c1d/src/holo.ts)、[existing-scene 示例](https://github.com/dmitrykurash/holospot/blob/7ca9873f7834c4952df628fb26b85c78d9639c1d/recipes/existing-scene.html)与 [package.json](https://github.com/dmitrykurash/holospot/blob/7ca9873f7834c4952df628fb26b85c78d9639c1d/package.json)：

- API 提供 `Holo.apply(mesh, options)`、对象 `ready`、`remove()` 和 `Holo.render(scene, camera)`；支持真实尺寸 `sizeMm`、UV/box/sphere 映射和质量档。候选统一封装为全息组件的七个预设，接入已有网格选择与启停机制。
- 它要求 WebGLRenderer，声明 Three r170+；工程 r185 满足声明范围，但原库开发版本 r187，仍需实际兼容性测试，不为此升级或替换现有引擎。
- 原适配器包含单独光谱工作室、对象代理及深度合成，**不是简单替换 MeshPhysicalMaterial**。不能照搬示例的动画循环覆盖 Viewer；先验证其合成与当前 PostFX、透明深度、镜面、输出色调的关系，再设计可卸载的渲染接入点。
- 计划复用同一个 WebGLRenderer，按需加载并固定源码版本；保留 MIT 版权说明。不会仅注册七个按钮并把普通虹彩材质当成完成实现。
- 性能验证需覆盖多个对象的离屏渲染成本、首次光谱/纹理加载、反复切换的资源释放和低档设备。保留当前默认清晰 HDR；原站画面对比和性能声明不是本工程验收结果。

现有实验预设没有这套光谱衍射能力；将其新增为独立候选，不替换已认可的镜面、苔藓或已有羽毛结构色实现。与 spite Mirage 同属全息方向，但两者的材质、主体表示和合成方式分别跟踪。

## Mobicat's Jewels：拆成四项能力

### 1. 切面宝石内部光路

从可见切面进入物体，在宝石局部坐标中求交、折射与反射，按波长区分折射率，并按内部路径长度吸收颜色。复杂切割用三维查询网格筛选候选切面。

- 源码：[optics.js](https://github.com/shaarmander/mobicats-jewels/blob/bcf82dfe4922da275b422f1db4b14f08203d98d6/src/optics.js)、[facet-grid.js](https://github.com/shaarmander/mobicats-jewels/blob/bcf82dfe4922da275b422f1db4b14f08203d98d6/src/facet-grid.js)。已核对 `cutMaterial`、`setStoneOptics`、`buildFacetGrid`。
- 现有 `gem` 只是物理透射/色散材质，不具备这套内部切面光路；独立路径追踪窗口也不是这个实时模块。
- 接入目标：`surface` 槽位、选中网格、恢复原材质；只处理通过校验的闭合凸切面网格。原函数依赖 `userData.planes`、`mmPerUnit` 等数据，需要新增网格切面提取、凸性检验和物理尺寸参数。不能直接把函数套到任意 GLB 上。
- 验收重点：切面亮暗、全内反射、色散、模型缩放后的吸收、非均匀变换，以及透明物体内外的遮挡关系。

### 2. 清晰金属反射与局部环境

精细抛光反射直接采样局部 HDR cubemap，较粗糙的反射使用过滤结果；缓存捕获结果，避免相机每次转动就重建探针。

- 源码：[metal-reflection.js](https://github.com/shaarmander/mobicats-jewels/blob/bcf82dfe4922da275b422f1db4b14f08203d98d6/src/metal-reflection.js)、[studio.js](https://github.com/shaarmander/mobicats-jewels/blob/bcf82dfe4922da275b422f1db4b14f08203d98d6/src/studio.js)。已核对 `DesktopMetalReflection`。
- 工程已存在 `WorldReflections`：128 像素立方探针、轮换捕获、材质恢复。**复用这个服务，不再叠加另一套逐物体捕获系统。** 后续只评估锐利反射质量档与按变化刷新策略。
- 验收重点：近距离高光细节、粗糙度过渡、动态物体更新、共享材质和长时间切换后的显存稳定性。

### 3. 宝石地面焦散

原作将参考戒托和切割的光运输预烘焙为图集，运行时按光方向、材质和尺寸重组。源码：[caustics.js](https://github.com/shaarmander/mobicats-jewels/blob/bcf82dfe4922da275b422f1db4b14f08203d98d6/src/caustics.js)、[离线烘焙](https://github.com/shaarmander/mobicats-jewels/blob/bcf82dfe4922da275b422f1db4b14f08203d98d6/tools/bake_transport.py)。已核对 `CausticMap` 的图集输入和路径权重。

这是**带资产约束的烘焙焦散**，不能把原戒指图集投到用户任意模型下面当作正确结果。候选接口须显式接收匹配模型的烘焙资产与单位信息；任意模型的实时焦散继续作为独立研究项。

### 4. 静止时渐进景深与抗锯齿

原作在交互期间使用便宜的景深滤波，静止时积累多光圈视点/子像素样本。源码入口：`optics.js` 的 `Lens` 与 `studio.js` 的渲染调度。

候选为可选后期能力，需要在相机、模型、灯光、环境、效果动画变化时清空历史。必须与现有 PostFX 共存，不能直接替换为原作 `JewelryStudio` 或增加常驻 renderer。原作的戒指编辑、价格估算、手部试戴不属于本次渲染模块范围。

## spite 合集：17 个子案例逐项登记

下列“模块方向”是提取方案；“源码入口”链接到该案例目录，README 描述算法，目录中保留实现与依赖。所有项当前都是研究候选，未加入可点击效果按钮。

| 日 / 源码入口 | 模块方向与关键机制 | 本工程接入边界 |
| --- | --- | --- |
| [01 Fold](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/1) | 纸张纤维、折痕高光、sheen；多面体展开/折叠 | 纸张材质可独立为 surface；折叠依赖面邻接和展开结构，不能作用于任意模型 |
| [02 Shatter](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/2) | 曲面 Voronoi 裂片、厚度、碎屑、可回放爆裂；光谱薄膜干涉 | 分离模型破碎组件与薄膜表面材质；需要真实切割几何和内部封口 |
| [03 Melt](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/3) | 表面液滴沿重力流动、合并、湿痕、悬滴断裂、地面液池 | 候选“表面融化/流挂”模块；依赖表面拓扑、位移缓存及液池，不是旧 water 波面 |
| [04 Tangle](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/4) | 薄膜虹彩、珍珠涂层、相邻带状物反射 | 薄膜材质可提取；其距离场反射绑定特定带状几何，不能当通用 SSR |
| [05 Moss](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/5) | 壳层苔藓、按表面条件扩散覆盖、石材风化；三维反应扩散造型 | 保留已认可苔藓；新实现单列高级候选。反应扩散是几何生成器，不是苔藓材质的必要依赖 |
| [06 Orrery](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/6) | 雕刻金属、珐琅填充、多种加工表面 | 提取工艺材质和纹样；钟表机构、零件拆装不塞进渲染效果层 |
| [07 Hollow](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/7) | 曲面镂空、圆唇厚壁、内部光透射与投影 | 几何组件与透射照明分开；薄壁、开放边缘和拓扑需要预检，不能使用透明贴图冒充洞口 |
| [08 Tesseract](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/8) | 凸多面体内双向镜面的多次反射 | 独立“无限镜腔”对象组件；限定凸多面体平面集合，不修改已有镜面地台 |
| [09 Membrane](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/9) | 多软体互碰、容器 SDF、厚度吸收、随深度变化的磨砂透射 | 作为 jelly / frosted 升级参考；不能只复制外壳着色而省略厚度缓冲、物体互碰 |
| [10 Caustic](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/10) | **酸蚀工艺**：纹样、锤揲、蚀刻、包浆、抛光、珐琅 | 归入“蚀刻/浮雕/工艺表面”；该标题不是光学焦散，避免错误归类 |
| [11 Rust](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/11) | 三平面锈蚀扫描、腐蚀场、凹处油污、边缘点蚀和起皮 | 候选独立 surface 模块；齿根/齿尖专用区域要改为用户网格的曲率/遮蔽输入 |
| [12 Feather](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/12) | 羽片排布、指针扰动、风场；随机透明与时间累积 | 与现有 ttillberg 羽毛分开；原布局依赖管状中心线，通用模型需另建方向场，保留原羽毛入口 |
| [13 Labyrinth](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/13) | 木材、玉石、瓷釉、碳纤维等程序材质；局部解析反射 | 材质族可提取；迷宫生成/解谜不属于渲染模块，盒体反射不能泛化为任意模型精确反射 |
| [14 Tension](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/14) | 附着水膜、表面波、拉丝断滴；SDF 折射、全内反射 | 新增“模型水膜”方向；需模型 SDF 和表面波映射，与海面/水下模块分开 |
| [15 Mirage](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/15) | 反射全息图、Bragg 选色、多波段回放、箔层与指纹 | 静态模型快照生成全息卡片，可独立卸载；多方向烘焙按帧分片，音乐隧道不移植 |
| [16 Spore](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/16) | GPU 粒群、密度/堆积网格、凝聚与断键、漂浮微粒 | 独立粒子场组件；按 GPU 预算限量，不能把普通 Points 噪声运动标成原粒群求解 |
| [17 Kelp](https://github.com/spite/codevember-2026/tree/64d9f700539c62d4f724e9846a63c77b26139d51/17) | 水下吸收散射、Snell 窗、表面聚焦光斑、光束；水流驱动海藻 | 拆为水下光学和植物流体响应；原作独立 renderer 不整体搬入，保留 Viewer 管线 |

进一步已读取 `11/rust.js`、`14/water.js`、`17/water.js` 和 `modules/pipeline/Pipeline.js`：它们实际依赖自定义 PipelineMaterial、全局 uniforms、场景深度或复合 pass，并非复制一个 shader 函数即可完成插件化。合集介绍中的效果说明不能视为已经在本工程验证。

## 合并后的能力方向与顺序

1. **宝石内部光路**：用 Mobicat 的明确许可源码补足 gem，先解决任意输入网格的数据适配，不动已有 PBR。
2. **反射质量与渐进采样**：在现有 WorldReflections / PostFX 上评估增量能力，避免重复探针、第二条渲染循环。
3. **工艺材质**：薄膜、纸张、雕刻/酸蚀、锈蚀、程序化天然材质；均使用原网格，按表面槽位独立启停。
4. **液体三种用途**：流挂融化、附着水膜、水下光学分别建模；不能用一个通用“水”按钮混淆边界。
5. **形变与几何**：破碎、镂空、软膜、折叠各自保留拓扑限制和几何恢复路径。
6. **生长与粒群**：保留原苔藓、羽毛，另研究高级覆盖、海藻动力学、孢子粒群。
7. **特殊光学对象**：无限镜腔和模型全息卡片使用独立对象组件，不替换查看器。

spite 各项先完成许可核实，再决定源码移植；无需用户重复提供 MD 已有链接。本轮没有复制该仓库的实现或资产。

## 所有新模块共同的接入和验收要求

- 继续使用 `EffectHost` 的 mount/update/dispose、`applyEffectPreset`、现有对象拾取和质量档；按能力增加模块，保持大框架。
- 明确是否覆盖原材质、几何或后期；撤销、切换模型、异常退出均恢复状态。已认可的镜面/苔藓不被新候选替换。
- 只按需生成探针、SDF、图集、worker 和历史缓冲；预算有上限。关闭后释放，异步完成时丢弃过期结果。
- 静态历史积累遇到任意动画或场景变化需失效；不以拖影或降低默认 HDR 清晰度换帧率。
- 用同一模型、光照、相机与尺寸比较原作和本地；检查动态画面、透明遮挡、反射、材质细节，不能以编译通过代替画质验收。
- 性能测量包括首帧准备、连续交互、反复启停、组合效果和显存/资源计数；原作者设备的 FPS 不当作本项目测量结果。
