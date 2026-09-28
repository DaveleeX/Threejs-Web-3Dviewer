# 项目海报

Sketchfab 作品配置在 `src/ui/sketchfabGallery.ts`。四个短链接已解析为固定模型 UID，封面直接引用对应模型页面的 `og:image`；点击卡片使用官方 `/models/{uid}/embed`，不依赖运行时短链接解析。模型仅在弹窗打开时加载，关闭时释放 iframe。

- `drink-and-run.svg`：为“喝一杯就撤”制作的矢量主题封面（非运行截图）。预览地址来自仓库 About：https://1-drink-and-run.vercel.app/。

- `iron-front.jpg`：AI-WorldOfTank 仓库的 `docs/screenshots/garage.jpg`。
- `armour-atlas.png`：2026-09-28 截取自 https://procedural-tank-web.vercel.app/ 的实际运行画面。
- `tank-museum.png`：tank-museum 仓库的 `docs/vercel-preview.png`。

项目列表配置在 `src/ui/projectGallery.ts` 的 `projects` 中。新增项目时，将海报放到本目录，并配置标题、说明、海报文件名、在线预览地址和 GitHub 地址。

点击海报在当前页的浮动窗口中加载 Vercel 地址，带打开、关闭和加载淡入过渡；关闭后释放 iframe。GitHub 入口单独跳转到源码仓库。
