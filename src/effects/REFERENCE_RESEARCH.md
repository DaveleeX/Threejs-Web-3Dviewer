# 参考源码复现与验收记录

2026-11-18。用户验收基线：仅镜面地台、表面苔藓保留正式入口；其余旧预设均为实验原型，不能代表参考案例画质。编译、按钮可用和无报错不等于画质验收。

## 第三轮：源码物理、降雨、湿表面与长期运行

本节为当前进展，优先于下方旧记录；没有把所有实验项标成完成。

- **JellyEffect**：原 Jelly-Baby 的 neo-Hookean XPBD、耦合弹性/体积约束、接触摩擦、防翻转、休眠和表面法线变形接入用户静态网格。新增局部体素四面体笼及重心绑定，Shift 拖动；固定 1/240 秒，最多每帧 12 步。默认轻推去除水平整体抛射，保持预览对象在镜头内。网格笼是近似，非任意拓扑的自动修复。光学仍为 MeshPhysicalMaterial，**没有原 WebGPU 厚度/焦散运输**。GPL-3.0 源码保留许可证，版本 a030ccf097584472c792d7f0a97010add5b937c9，详情 vendor/jelly。
- **CollisionRainEffect**：来自 ektogamat/threejs-conference，版本 8cc20593b2270e2ce832e7b7b44356705daddec4，MIT。WebGL ping-pong 代替原 TSL storage buffer，保留雨带轮廓、速度扰动、重生、区域环绕、顶视高度碰撞。范围适配用户模型；碰撞图在几何/变换变化时刷新，也识别软体可见附件。五帧水花图集接口保留；原 public 纹理未获 MIT 覆盖，未捆绑，缺省不显示水花。
- **WetSurfaceEffect / wet**：同一项目 rainRipples.js 九邻格波纹导数 GLSL 移植，原 PBR 材质与贴图保留，在朝上表面叠加涟漪法线与湿润粗糙度。可与 rain 组合；不宣称已有参考城市的积水贴图、遮挡、粗糙路面反射全链路。
- **镜面、苔藓**：外观参数与算法保持。镜面复用每场景的反射相机，防止 Three r185 按新 camera.id 永久增加透射缓冲。

### 性能和默认环境

环境强度/旋转调整复用 PMREM；HDR 请求合并、缓存最多三个条目，渐变缓存最多两个；替换/清除 LUT 释放旧纹理。异步 HDR/LUT 完成后检查销毁/请求状态。GPUComputationRenderer 未释放的内部拷贝材质由模块补充释放。透镜减少逐帧临时对象，并按档位限制捕获分辨率。暂停后恢复重置时钟，避免追赶暂停期间时间。

默认背景为室内会场 HDR、blur=0。原 1024×512 照明图保持，背景另用用户本地已有的 3561×1779 原图；build-hdri.mjs 同步保留原图。首载增加约 19 MB HDR 文件，后续复用。没有通过降低默认清晰度掩盖性能问题。

### 本轮验证

- build / typecheck 通过；实时 UI 测试覆盖 15 项启停、互斥槽位、组合清理。
- source-physics-smoke：球、盒、环形模型各 1200 步，体积比 0.9973 / 0.9963 / 0.9904，最小 Jacobian 均 >0.55，落地高度 0.00015，球/盒休眠；绑定静止误差 <1e-6。
- 非对称雨碰撞高度 2 / 0.6001，移动后 3；渲染器 target/viewport/scissor/clear 状态恢复，GPU 粒子保持有限值。
- effects-memory-smoke：90 次单项开关后稳定在 geometries=15、textures=9、programs=14；再做三轮组合切换稳定在 15/10/14。首次组合多一张由 Three 缓存的反射透射图，后续不递增。
- 硬件测量脚本 effects-gpu-benchmark：本机 RTX 5080、D3D11、1440×900、DPR 1、高档，两个完整开关循环。结果保存在 smoke-out/effects/gpu-benchmark.json。这是内置材质展示场景的测试，不能外推到任意大模型或手机。

### 剩余项逐项核查

| 项目 | 实际状态与剩余工作 |
| --- | --- |
| 水（两个旧预设） | Oscar 原站普通访问仍被 Cloudflare 拦截；搜索没有定位到作者源仓库。旧双正弦波没有升级成该案例，继续实验，不冒称完成。 |
| 气球 / cloth | 已读发布包中的 GPU XPBD 距离、压力、体积、空间哈希碰撞与绳子流程。完整接入与资产许可尚未完成；旧双角布片绝不是气球实现。 |
| 高折射晶体 | 原 raytracing6 是 WebGPU BVH 光谱路径追踪加 photon caustics；现有 gem 和路径追踪预览均不等价，尚未移植完整流程。 |
| 原“毛发”链接 | 实际视频是纹理玻璃，不是毛发；尚无相应可核实毛发源码，旧 fur 不能视为文档案例复现。 |
| 磨砂 / 纹理玻璃 | 当前只是物理材质实验；原视频纹理玻璃着色器未取得，尚未升级。 |
| 金属 / 车漆 / Rolex | 已读三个站的发布脚本。Toyota 与 Rolex 基于 WebGI + 模型材质配置，Rolex 使用 SSRPlugin / BloomPlugin 并在移动端减半 SSR 步数。GSI 独立 Three 配置含专用资产/HDR。Viewer 已有 PBR、clearcoat、环境和后期，不重复替换；资产微结构与反射链路尚未做到相同。 |

源码接入、功能测试、画质验收分开记录。正式库仍只有用户已认可的 mirror / moss。

## 第二轮：从案例展示进入用户模型/场景

本节更新优先于下方第一轮历史记录。

### 羽毛模型附件

`FeatherEffect.ts` 已替换 `feather` 旧入口。使用原 `Builder.add/build`、`specFromLook`、`createPlumageMaterial` 和共享根部铰链阴影。挂在用户静态网格下，不打开独立窗口、不增加 renderer、不替换模型材质。

UI 支持覆盖对象、原版 body/gorget/crown 三种羽色、三种梳理方向；API 支持向量、数量、种子与 meshIds。以世界面积分配数量，建立初始逆变换，支持非均匀缩放和后续父级移动。共享 uniforms 更新抖羽；方向光深度与点光距离 pass 使用相同形变。撤销、换模型、切换着色时沿既有 EffectHost 清理。

**仍未达到所有模型的原案例外观**：通用表面采用面积采样而不是鸟体解剖羽区行列；没有原鸟的绒毛壳层，也不支持 SkinnedMesh/Morph 绑定。它是已经接入模型的源码羽片模块，仍为画质待验收候选。

验证：`feather-attachment-smoke.mjs` 通过，覆盖原材质/几何引用保持、原光学 attributes、非均匀变换、父级移动、确定性分布、dispose、目标选择、同槽替换和无独立弹窗。截图 `smoke-out/effects/feather-on-model.png` 已人工查看。

### 液态玻璃透镜

通过发布包的动态 chunk 继续定位到原案例实际参数与 TSL 逻辑；另找到 [Cody Hergenroeder 的 MIT 复现](https://github.com/codyhxyz/infinite-liquid-glass)，其 config 明确标注参数来自原发布包。使用该可复用源码完成 WebGL GLSL 适配，保留 Lamé 厚度曲线、球面曲率、梯度法线、斜率钳制、五波长三角响应色散、Fresnel 上限和边缘高光。

`LiquidGlassEffect.ts` 替换 `glass` 旧参数预设：透镜自动放在模型前，也可通过 API 指定尺寸/位置/旋转；输入改为当前场景捕获和原有 PMREM，沿用原 Viewer 的色调映射。附加 pass 用 try/finally 恢复 render target、viewport、scissor、tone mapping 和阴影状态。关闭释放自有资源，不释放用户 HDR。

这是**场景内透镜**，不是任意网格的多次内部折射。捕获范围外内容不可见，多层玻璃互相折射尚未实现；不等价于 raytracing6。原 gallery 的媒体、排布、拖拽未复制；来源及转换边界在 vendor/liquid-glass/NOTICE.md。

验证：`liquid-glass-smoke.mjs` 通过，检查实际渲染像素变化、着色器编译、场景捕获、PMREM、渲染状态恢复和移除。曾发现并修复 CUBEUV_MAX_MIP 整数宏导致的 shader 编译错误。截图 `smoke-out/effects/liquid-glass-lens.png` 已人工查看。仍未移入正式区。

### 新取得的其他源码证据

- **雨夜原作者仓库已定位**：[ektogamat/threejs-conference](https://github.com/ektogamat/threejs-conference)。检查了 `src/world/weather/createCollisionHeight.js`、`createCollisionRain.js`、`src/world/ground/createGround.js`、`src/tsl/rainRipples.js`。流程是世界高度纹理 → GPU 粒子积分/碰撞重生 → 飞溅 atlas → 湿地粗糙度与平面反射。代码 MIT；README 明确 public 中模型/纹理不在 MIT 内。未将它冒充已完成的雨模块，也未复制未知许可的纹理。
- **气球求解器已定位**：原站 `/_next/static/immutable/chunks/215-ommkx982a.js`，SHA256 `cd6abca7f2bf581d8cc17e9e94f51a35087134e5fdc22c3eb42f3c4371702a80`。含 rest volume、pressure、structural compliance、volume compliance、bending、碰撞 bucket 和字符串约束；默认 2 substeps、3 solver iterations、pressure=.27、inflation=3。文本体由 SDF、投影和重网格构建；不是两角固定布片。目前只核查发布代码，未直接拷入未知许可实现。
- **液态玻璃原发布包**：`/_next/static/immutable/chunks/1x7vnkskt2893.js`，SHA256 `4c7a378491836318b3140964e6e35bd7d549c87ecf1237ee97793d7e9db23e6e`。已定位自定义参数与材质函数，而非只读到 Three.js 引擎 transmission。
- **水**：MD 只有 oscardumlao.com 演示链接。本机 fetch 和普通 Chromium 访问均遇到 Cloudflare 拦截，未尝试绕过；搜索尚未定位原作者仓库。**毛发**：MD 是作者 X 视频链接，仍未定位可核验源码。不要求用户重复提供 MD 已有链接。

`scripts/research-source-bundles.mjs` 只下载/检查发布 JS，不执行下载代码；缓存于系统临时目录。初始网页 chunk 的子依赖也要追踪，否则会漏掉应用本体。

### 原始 MD 的“毛发”条目纠正

进一步追溯 `0xrinx/status/2119507326348779632` 的媒体来源，实际发布者为 `neilsonks/status/2118757539957633115`。已用浏览器查看原视频封面及第 3、6 秒画面：画面是本地 `/glass/` 页面的细密凹凸纹理玻璃，背景透过玻璃可见，不是毛发。截图位于 `smoke-out/effects/fur-reference-thumbnail.png`、`fur-reference-3.png` 和 `fur-reference-6.png`。这只纠正案例对应关系，并不证明已取得作者源码。旧 fur 原型没有得到这条参考的支持，不应继续宣称“复现 MD 毛发案例”。

本轮回归最终分开运行：`effects-smoke.mjs <url> --realtime-only`、`--trace-only`、`feather-attachment-smoke.mjs`、`liquid-glass-smoke.mjs` 均通过。一次串行全量运行在 SwiftShader 的路径追踪等待阶段超过 120 秒；独立重跑采样、导出与关闭恢复通过，未据此宣称真实 GPU 性能已验收。

## 第一项：Codevember 12 羽毛

- [原场景](https://ttillberg.github.io/codevember-2026/12/)、[源码](https://github.com/ttillberg/codevember-2026/tree/main/12)、[MIT 授权](https://github.com/ttillberg/codevember-2026/blob/main/LICENSE)。作者 Theo Tillberg。
- 已导入原版 bird 模块及依赖、backdrop、branch、post，共 29 个 TypeScript 文件，许可证单独保留。原版分层羽毛几何、骨骼蒙皮、羽轴/羽片细节、结构色、绒毛、匹配的阴影深度材质和行为层均保留。
- 使用原版树枝 GLB、环境 PMREM、主光与轮廓光参数，保留原版 CoC、分块最大模糊、景深采样、调色管线。没有用散布平面代替原版羽毛。
- 在框架中增加 `openFeatherReference(viewer)` 按需加载会话。独立 renderer/scene，打开时暂停 Viewer，关闭后释放资源并恢复 Viewer。未修改原 PostFX 顺序、用户模型或现有着色设置。
- 该入口位于实验区，名称为“源码复现 · 羽毛场景（待验收）”。这是参考场景适配器，**尚不是任意模型通用羽毛覆盖器**。后续通用化需明确定义羽区、方向场、物种参数、骨骼映射，不能把原作者为鸟构建的羽毛直接散布到任意模型后称为同等效果。
- 当前未迁入外围的投喂 UI、昆虫、环境音、树枝受力摆动与相机轻微抖动；原 bird 内部动作保留。动态图景和原站仍有差异，尚未通过用户画质验收。
- 本地改动范围见 vendor/feather/NOTICE.md；源码原始 SHA256 见 provenance.json。

## 其余模块的证据与缺口

补充源码核查：Jelly-Baby 的 `src/physics/soft-body.js` 实现 SI 单位 neo-Hookean XPBD，采用体积加权四面体弹性约束及 barrier；`constants.js` 的固定步长为 1/240，3 次迭代，shear=1200、bulk=65000。`graphics/character/baby.ts` 以 IOR=1.35、dispersion=.025 和吸收系数指数衰减构建材质；`transport.ts` 明确区分异步 view thickness 与 GPU 帧同步焦散。通用接口因此至少要同时管理体积 cage、表面绑定、固定步长求解、厚度更新和光学接收面，不能只暴露一个“弹性强度”。这些文件只用于核查，未拷入工程。

| 模块 | 已核查证据 | 下一步与发布门槛 |
| --- | --- | --- |
| 玻璃、宝石、焦散 | [raytracing6](https://r3f.maximeheckel.com/raytracing6) 发布 JS 中的 WGSL：WebGPU BVH 光线求交、波长色散、光子采样、irradiance ping-pong、时间累积；默认 16384 photons/frame，768² 焦散纹理。作者说明 BRDF 使用归一化 Blinn–Phong。 | 旧 gem transmission 与独立 WebGL pathtrace 不等价。先核实可复用源码许可证，再评估隔离 WebGPU 会话，不替换整个 Viewer 后端。需对比折射轮廓、彩色焦散、接收面能量、累积收敛。 |
| 果冻、软体 | [Jelly-Baby runtime](https://github.com/scottstts/Jelly-Baby/blob/main/src/app/runtime.ts)：WebGPU、软体 cage、光学表面同步、BVH transport worker、吸收、局部反射、焦散接收层。仓库 GPL-3.0。 | 原版是物理与光学联动，不是顶点正弦动画。尚未复制代码到工程；需明确许可集成方式及碰撞/体积保持/拖拽后的光学同步。 |
| 水 | [Oscar Dumlao](https://oscardumlao.com/) 本轮自动访问返回 403，尚未获得可核验的应用源码。 | 保持实验；不能将双波叠加包装成参考水面。取得源码后核实反射、折射、深度吸收、交互波场与合成。 |
| 液态玻璃 | [Infinite Liquid Glass](https://infinite-liquid-glass.shader.se/?v=2) 可访问发布资源，但尚未定位并核验自定义算法及其许可。 | Three.js 引擎代码里的 transmission 不能当成作者算法证据。需查出实际距离场/形变/折射实现后再移植。 |
| 气球、布料 | [Balloons](https://balloons.shader.se/) 可访问应用资源，尚未核实源码授权与求解器。 | 两角固定布片不等于充气膜。需要体积/压力约束、碰撞、材质及反射的一致表现。 |
| 毛发 | 文档的 0xrinx 视频链接尚未获得可复用实现。 | 保持实验，需核实几何表示、各向异性散射、阴影和运动；不能用线段散布替代。 |
| 金属、车漆、产品棚拍 | GSI、Toyota、Rolex 案例尚未完成源码与资产管线核查。 | Viewer 已有 PBR/clearcoat/HDR/阴影，不重复改写。研究资产、微表面细节、环境光布置、接触阴影与镜头的配套预设。 |
| 雨、湿地、夜景 | Threejs-Punk 案例尚未完成源码管线核查。 | 镜面地台保留；雨点原型仍实验。需要湿润材质、动态反射、雨滴与光照联动的参考对比。 |

上表“尚未”是待办，不代表已研究完成或已达到案例效果。参考站可访问也不等于其源码和资产可直接复制。

## 本轮验证证据

- `npm run build` 通过；既有 Vite 配置兼容提示与大 chunk 提示仍存在。
- `scripts/effects-smoke.mjs` 通过：正式区只有 moss/mirror；14 项启停、槽位互斥、材质几何恢复、路径追踪采样与导出正常。
- `scripts/feather-smoke.mjs` 通过：原 shader 编译和渲染、抖羽交互、关闭、重开、恢复 Viewer，无 console/page error。
- 已实际查看 `smoke-out/effects/feather-source-port.png` 和 `feather-upstream.png`：层叠轮廓、紫色颈羽/绿色胸羽结构色、树枝和背景景深具有相同核心表现。两张图的动画时刻不同，不能用于像素误差评分；外围动态差异尚存在，仍标待验收。
- 原站截图脚本等待 55 个实际动画帧，避免把开场线稿过渡误作最终画面。测试使用 Chromium SwiftShader，不能据此承诺用户 GPU 帧率。

## 每项验收顺序

1. 留存来源、许可、源码快照哈希，列出真实算法、资产和后处理依赖。
2. 原管线独立运行，固定相机、光照、尺寸与时间，留存原站/本地截图及动态图景证据。
3. 核对轮廓、微表面、反射折射、阴影、运动；缺失关键环节继续实验，不以调色掩盖。
4. 在本工程中验证打开/关闭/重开、错误恢复、模型切换和资源释放。记录硬件、分辨率、帧耗时；软件 GPU 的功能测试不能代替真实性能结论。
5. 在可复用输入契约明确后封装模块；通过画质验收后才移入正式区。
