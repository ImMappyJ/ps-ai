<p align="center"><img src="assets/brand/avatar.png" width="72" alt="PS-AI"></p>
<h1 align="center">PS-AI 品牌资源</h1>
<p align="center"><strong>简体中文</strong> · <a href="BRAND.en.md">English</a> · <a href="README.md">返回首页</a></p>

Morph Frame 把开放的编辑框与翻转的曲面连在一起。直线提供边界，曲线从框内向外展开，表现图像正在被重新生成。顶端开口与内部负空间属于图形结构，换成单色时也要保留。

![Morph Frame 图形、横标、原尺寸图标与单色版本](assets/brand/overview.svg)

## 选择合适的文件

| 用途 | 文件 |
| --- | --- |
| 主图形，透明背景 | [mark.svg](assets/brand/mark.svg) |
| 浅色／深色底板 | [浅色](assets/brand/mark-on-light.svg) · [深色](assets/brand/mark-on-dark.svg) |
| 单色图形 | [深色](assets/brand/mark-mono-dark.svg) · [浅色](assets/brand/mark-mono-light.svg) |
| 图文横标 | [浅色界面](assets/brand/lockup-on-light.svg) · [深色界面](assets/brand/lockup-on-dark.svg) |
| 单色横标 | [深色](assets/brand/lockup-mono-dark.svg) · [浅色](assets/brand/lockup-mono-light.svg) |
| 字标轮廓 | [wordmark.svg](assets/brand/wordmark.svg) |
| 社交头像 | [512px PNG](assets/brand/avatar.png) |
| 浏览器图标 | [favicon.ico](assets/brand/favicon.ico)，包含 16／32／48px PNG |

透明图形 PNG：[16](assets/brand/icons/mark-16.png) · [24](assets/brand/icons/mark-24.png) · [32](assets/brand/icons/mark-32.png) · [48](assets/brand/icons/mark-48.png) · [64](assets/brand/icons/mark-64.png) · [128](assets/brand/icons/mark-128.png) · [256](assets/brand/icons/mark-256.png) · [512](assets/brand/icons/mark-512.png)。

应用图标使用深色底板：[48](assets/brand/icons/app-48.png) · [96](assets/brand/icons/app-96.png) · [512](assets/brand/icons/app-512.png)。Photoshop 侧栏另有 23／46px 深浅单色导出，由清单按宿主主题选择；面板顶部使用 32px 图形和 2× PNG。

## 尺寸与边距

- 图形使用 128×128 坐标，主要线宽为 16，顶端开口宽 12。24px 下分别约为 3px 和 2.25px，16px 也保留可见开口。
- 按可见轮廓计算，四周至少留 12 个坐标单位的空白，约为图形画布宽度的十分之一。横标也遵守这一边距，不把按钮、分隔线或其他图形挤进来。
- 普通界面优先使用 24px 以上的图形；16px 仅用于 favicon 等空间受限的位置。横标建议宽度不低于 112px。
- 使用 PNG 时选择足够大的原始尺寸：24px 显示可用 48px 资源。不要放大 16px 文件充当大图。
- 字标为独立绘制的无衬线矢量轮廓，没有外部字体依赖。单独组合时保持字重与留白，不重新输入相似字体替代正式字标。

## 配色

| 色彩 | 色值 | 用法 |
| --- | --- | --- |
| Electric Violet | `#7C5CFF` | 主渐变起点 |
| Creative Magenta | `#E35DCC` | 主渐变终点 |
| Digital Cyan | `#49CFFF` | 可用于扩展视觉的小面积点缀，主 Logo 不使用 |
| Deep Space | `#121423` | 深色底板与深色单色标识 |
| Soft White | `#F8F9FC` | 浅色底板与反白标识 |

渐变从左上到右下，两个图形共用同一坐标，不分别改变颜色。复杂照片、高对比度界面和受限印刷场景使用单色版本，或加上提供的底板。面板当前沿用深色布局；浅色资源不代表整套插件已提供浅色主题。

## 不要这样使用

不要拉伸、倾斜、旋转或剪断开口；不要改变各部分比例、另加描边、阴影或发光；不要用绿色替换主色。也不要把图形放进 Adobe 的 Ps 蓝色方块，或与 Adobe 官方标识拼接成同一产品。

旧版真实截图保留原样，并标注对应版本。Logo 更换没有改动图像工作流、插件 ID、面板 ID 或安装目录；0.3.0 的历史资源可以在 Git 记录中找到。

## 修改与导出

`mark.svg` 与 `wordmark.svg` 是几何源文件。其他颜色版本、横标、PNG、ICO 和预览图由脚本导出：

```sh
npm ci
npm run brand:export
npm run brand:check
npm run package
```

SVG 导出使用 [resvg-js](https://github.com/thx/resvg-js)，只在开发时使用，不进入 Photoshop 运行代码。正常构建复制已提交的 PNG，无需在宿主中渲染 SVG。修改后检查 24／32／48px、单色、深浅背景和实际面板，再一并提交源文件与导出结果。
