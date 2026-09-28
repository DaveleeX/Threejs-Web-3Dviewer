# 项目实景预览视频

这些静音 MP4 来自 2026-09-28 实际打开项目后的浏览器画面录制，并加入项目介绍字幕。每段约 8 秒，960×540、24 fps、H.264，支持网页按需播放。

| 文件 | 录制内容 |
| --- | --- |
| materials.mp4 | 本地材质实验室，开启自动旋转 |
| iron-front.mp4 | AI World of Tank 坦克展示场景 |
| armour-atlas.mp4 | Armour Atlas 结构分解与环绕 |
| tank-museum.mp4 | 微缩坦克博物馆自动导览 |
| drink-and-run.mp4 | Nocturne 吧台、烟雾与光影 |
| 6XoBH.mp4 | Cyberpunk City，实际拖动视角 |
| 6UnGs.mp4 | Ironman Prototype，实际拖动视角 |
| 6xzEA.mp4 | A wheel of Lamborghini，实际拖动视角 |
| 6XqEI.mp4 | Venom 角色动画 |

Sketchfab 模型对应关系见 `src/ui/sketchfabGallery.ts`，网页项目地址见 `src/ui/projectGallery.ts`。

原始帧和采集时间轴放在被 Git 忽略的 `smoke-out/recordings/`；使用 `scripts/build-preview-videos.py --ffmpeg <FFmpeg路径>` 可重新编码现有录制。成片作为正式静态资源随工程发布。
