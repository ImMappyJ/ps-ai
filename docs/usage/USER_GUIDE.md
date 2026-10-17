<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">PS-AI 使用说明</h1>
<p align="center"><strong>简体中文</strong> · <a href="USER_GUIDE.en.md">English</a></p>

这份指南使用同一张 **3F3F3F.webp** 的独立副本演示九种模式。截图来自 Windows Photoshop 27.0 中的实际 Portable 面板；结果图来自 Photoshop 合成后的像素。点击图片可看原始 PNG，面板截图保留 541 像素宽，没有放大补画。

**对应版本：0.4.0（实验版）。** 0.3.0 不包含配置向导、范围预览和可选 16 位输出。安装见 [README](../../README.md#安装发行包)，后端与模型见 [ComfyUI 配置](../setup/COMFYUI.md)。

以下截图与九种模式验收使用 ComfyUI。平台适配的配置和限制见 [百炼](../providers/BAILIAN.md)、[Gemini / Nano Banana](../providers/GEMINI.md) 与 [OpenAI Images](../providers/OPENAI.md)；这些平台路径尚未完成真图和宿主验收，不能套用下面的已测结果。

开发版把原 **COSPLAY** 分类改为“人像”，增加第十种模式“光影重塑”。下面九种图例仍是 v0.4.0 的实测记录，旧截图中的分类名尚未改变。新版四个平台与 Key 操作见 [平台配置](../setup/PLATFORMS.md)。

## 先连接，再准备副本

1. 启动 ComfyUI，在浏览器确认地址可以打开。
2. 从 Photoshop 的“增效工具”打开 PS-AI，Portable 入口是 **PS-AI (Portable)**。
3. 展开“模型与连接”，填写完整地址，例如 `http://localhost:8188`。可以改主机和端口；不要填账号、路径或查询参数。
4. 点“扫描模型”，选择配套的 Qwen 2.1 生成模型、视觉／文本编码器和 VAE，再点“保存配置”“连接”。其他架构不能只改文件名就接入。
5. 初次可按“配置向导”测试地址、检查环境、运行生成示例。最后一步使用后端，在独立测试文档中生成并应用图片。
6. 打开样图并先存 PSD 副本。开发版新增：[10 · 光影重塑](#relight)。

每个例子都从原图重新复制，避免前一轮修改影响下一轮。

语言和输出位深切换后保存；地址和模型需点“保存配置”。导出／导入 JSON 可以迁移设置，不包含模型权重和图片历史。CCX 与 Portable 的数据各自独立。

来源要有正确 ICC，支持已标记的 RGB／灰度 8/16 位。未标记图片会被拦截；CMYK、Lab、索引色、位图、多通道、32 位 HDR 请先准备 RGB 副本。本例原 WebP 是 8 位，副本转为 **RGB / 16 位、sRGB IEC61966-2.1** 验证回填；转换不会补回原图没有的细节。

## 本例统一参数

**候选 1 张、分辨率 992、25 步、锁定种子 42、上下文边距 15%、关闭颜色匹配、16-bit SDR 输出。** 使用兼容清单中的 Qwen 2.1 Q4_K_M、Qwen3-VL INT8 和 Qwen 2.1 VAE。编辑候选按来源长宽比生成，不一定是正方形。精确提示词、开关和实际尺寸见 [示例参数 JSON](../../assets/guide/recipes.json)。

没有配置 16 位保存节点时，保持默认 **8-bit（兼容）** 即可。切换 16-bit SDR 前，按 [后端指南](../setup/COMFYUI.md) 安装 `PS_AISavePNG16` 并重启 ComfyUI。网页预览为 8 位，不能用于判断 16 位文件精度。

## 选区编辑的共同步骤

选中范围后点“预览选区”：**橙色可编辑，蓝色为手动保护，灰色只提供上下文**。生成时重新捕获。要保护脸或手，先选中它们“设为保护区”，再重新圈选编辑区。换文档或恢复旧参数后要重新设保护区。

点“生成候选”，等进度结束，检查缩略图和“100% 查看”，再“应用为新图层”。结果带可编辑蒙版，来源图层保留。下文橙色图根据实际蒙版制作，是范围示意；面板截图单独展示。对比图均为左侧原图、右侧结果。

## 模式索引

| 修改与移除 | 服装、参考与场景 | 素材与文字生图 |
| --- | --- | --- |
| [01 · 局部物体／材质](#edit) | [04 · 服装／道具](#costume) | [07 · 特效](#effect) |
| [02 · 移除](#remove) | [05 · 角色参考](#reference) | [08 · 氛围](#atmosphere) |
| [03 · 背景](#background) | [06 · 场景](#scene) | [09 · 文字生图](#generate) |

每个例子先看效果，再按步骤操作。选区和面板截图放在 **选区与面板设置** 中，点击展开；所有图片都能点击查看原图。

<a id="edit"></a>

## 01 · 局部物体／材质

<p align="center">
  <a href="../../assets/guide/01-edit-compare.png"><img src="../../assets/guide/01-edit-compare.png" width="760" alt="左侧原图，右侧白色过膝袜"></a>
  <br><sub>左：原图 · 右：白色过膝袜</sub>
</p>

1. 复制原样图，选中双腿，从膝盖上方到鞋口，给袜口留一点余量。
2. 选择“局部修图 → 局部物体 / 材质修改”，应用位置选“原选区新图层”，输入下面的提示词。
3. 开启“范围辅助图”“编辑保留原透明轮廓”和“对齐透明主体大小与位置”，关闭颜色匹配。预览选区后生成。
4. 检查双腿都有白袜、袜口高于膝盖、鞋子和腿部姿势没有变，再应用。若对齐导致比例变化，关闭对齐后重新生成。

本次实测提示词：

> 给双腿穿上白色过膝袜，袜口位于膝盖上方；保留腿部姿势、鞋子、原有衣服和透明背景。

实测得到白色过膝袜，原透明轮廓和选区外可见像素保持不变。候选为 800×1216，回填时恢复来源坐标，不需要手工放大来填满画布。

<details>
<summary>选区与面板设置</summary>

<table>
  <tr>
    <th width="50%" align="center">可编辑范围</th>
    <th width="50%" align="center">面板设置</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/01-edit-selection.png"><img src="../../assets/guide/01-edit-selection.png" width="360" alt="橙色表示本次实际可编辑范围"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/01-edit-panel.png"><img src="../../assets/guide/01-edit-panel.png" width="360" alt="真实 Portable 面板：局部物体／材质"></a></td>
  </tr>
</table>

</details>

<a id="remove"></a>

## 02 · 移除

<p align="center">
  <a href="../../assets/guide/02-remove-compare.png"><img src="../../assets/guide/02-remove-compare.png" width="560" alt="左侧原图，右侧移除胸前玩偶"></a>
  <br><sub>左：原图 · 右：移除胸前玩偶</sub>
</p>

1. 复制原样图，套索选中胸前黑色玩偶的头、身体和四肢，稍带周围白色衣料。不要只圈住玩偶中间。
2. 选择“局部修图 → 移除杂物”，应用到原选区，输入下面的提示词。
3. 开启范围辅助，关闭透明轮廓保留、主体对齐和颜色匹配，预览后生成。
4. 放大检查黑色残片、白色衣褶是否连续、金属链条是否保留，满意后应用。

本次实测提示词：

> 移除胸前的黑色毛绒玩偶挂件，包括头和四肢，在原位置补齐连续的白色褶皱衣料；保留金属链条、人物姿势和其他衣物。

本次玩偶移除，白色衣褶接续，金属链条仍在。复杂遮挡未必一次补全；残片处可缩小选区再修一次。

<details>
<summary>选区与面板设置</summary>

<table>
  <tr>
    <th width="50%" align="center">可编辑范围</th>
    <th width="50%" align="center">面板设置</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/02-remove-selection.png"><img src="../../assets/guide/02-remove-selection.png" width="280" alt="橙色表示本次实际可编辑范围"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/02-remove-panel.png"><img src="../../assets/guide/02-remove-panel.png" width="360" alt="真实 Portable 面板：移除"></a></td>
  </tr>
</table>

</details>

<a id="background"></a>

## 03 · 背景

<p align="center">
  <a href="../../assets/guide/03-background-compare.png"><img src="../../assets/guide/03-background-compare.png" width="760" alt="左侧原图，右侧浅紫摄影棚背景"></a>
  <br><sub>左：原图 · 右：浅紫摄影棚背景</sub>
</p>

1. 复制透明样图。Ctrl+单击人物图层缩略图载入不透明范围，再 Ctrl+Shift+I 反选背景；选区覆盖整张画布的透明部分。
2. 选择“局部修图 → 换背景”，应用到原选区，输入下面的提示词。
3. 开启范围辅助，关闭透明轮廓保留、主体对齐和颜色匹配。预览应显示背景可编辑，人物实心部分被排除。
4. 生成并应用，检查四周填满、双脚落地、头发边缘和接触阴影。选中人物会改到人物，不能靠提示词反转选区。

本次实测提示词：

> 只将透明背景替换为浅薰衣草紫色的简洁摄影棚，柔和均匀的墙面与地面，脚下有轻微接触阴影；完整保留原人物、发丝、衣服、姿势和构图。

本次整张透明背景换为浅紫摄影棚，脚下有阴影，人物不透明部分保留来源像素。半透明发丝属于过渡边缘，会与新背景混合，需要时在结果蒙版上修边。

<details>
<summary>选区与面板设置</summary>

<table>
  <tr>
    <th width="50%" align="center">可编辑范围</th>
    <th width="50%" align="center">面板设置</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/03-background-selection.png"><img src="../../assets/guide/03-background-selection.png" width="360" alt="橙色表示本次实际可编辑范围"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/03-background-panel.png"><img src="../../assets/guide/03-background-panel.png" width="360" alt="真实 Portable 面板：背景"></a></td>
  </tr>
</table>

<p align="center">
  <a href="../../assets/guide/03-background-workspace.png"><img src="../../assets/guide/03-background-workspace.png" width="760" alt="实际 Photoshop 整窗截图"></a>
  <br><sub>Photoshop 原始整窗截图，点击查看。</sub>
</p>

</details>

<a id="costume"></a>

## 04 · 服装／道具

<p align="center">
  <a href="../../assets/guide/04-costume-compare.png"><img src="../../assets/guide/04-costume-compare.png" width="620" alt="左侧原图，右侧深紫色衣摆"></a>
  <br><sub>左：原图 · 右：深紫色衣摆</sub>
</p>

1. 复制原样图，套索圈住画面右侧粉色外套的下半段，包括需要改材质的完整衣摆。
2. 选择“人像 → 服装 / 道具修复”，应用到原选区，输入下面的提示词。
3. 开启范围辅助和透明轮廓保留，关闭主体对齐和颜色匹配，预览后生成。
4. 检查菱形镂空、金边、褶皱和透明轮廓，再应用。选区外的上半段仍为粉色，想整件换色就要覆盖整件。

本次实测提示词：

> 只将选中的画面右侧粉色外套衣摆改为深紫色丝绒，保留原有褶皱、菱形镂空、金色饰边和衣摆轮廓；保持人物姿势、其他衣服及透明背景不变。

选中的衣摆变为深紫色，金边和镂空保留。这验证了服装局部编辑；道具可用相同流程，但本例没有单独重建武器或复杂机械结构。

<details>
<summary>选区与面板设置</summary>

<table>
  <tr>
    <th width="50%" align="center">可编辑范围</th>
    <th width="50%" align="center">面板设置</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/04-costume-selection.png"><img src="../../assets/guide/04-costume-selection.png" width="310" alt="橙色表示本次实际可编辑范围"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/04-costume-panel.png"><img src="../../assets/guide/04-costume-panel.png" width="360" alt="真实 Portable 面板：服装／道具"></a></td>
  </tr>
</table>

</details>

<a id="reference"></a>

## 05 · 角色参考

<p align="center">
  <a href="../../assets/guide/05-reference-compare.png"><img src="../../assets/guide/05-reference-compare.png" width="760" alt="左侧原图，右侧参考白袜特征"></a>
  <br><sub>左：原图 · 右：参考白袜特征</sub>
</p>

1. 复制原样图，选择双腿。参考图使用同一张样图已经穿白袜的版本：[下载本次参考 PNG](../../assets/guide/reference-white-socks-icc.png)。
2. 选择“人像 → 角色参考辅助”。展开“参考图”，点“选择图片”导入 PNG，“参考用途”选“服装”，输入下面的提示词。
3. 保持该模式默认关闭范围辅助，开启透明轮廓保留，关闭主体对齐与颜色匹配。预览腿部选区后生成。
4. 对照参考检查袜口、颜色和原姿势，再应用。做完点“清除参考”；独立素材和文字生图提交前也要求清除参考。

本次实测提示词：

> 参考图片中的白色过膝袜，为原图选区内的双腿添加同类白色袜子；袜口在膝盖上方，保留原人物的腿部姿势、鞋子、衣服和透明背景。

本次参考成功带入白袜特征，人物姿势和鞋子保留。验证的是服装参考辅助，不等于身份锁定、精确复刻角色或多角度一致性。

**导入提示未标记颜色时：** 本轮一张只有 PNG sRGB 标记、没有嵌入 ICC 的 PNG16，被 PS 27 读成未标记图片，因此安全检查拦截。确认真实来源色彩空间后，在副本中用“编辑 → 指定配置文件”指定正确配置，保存时嵌入 ICC，再导入。不要给未知来源随意指定 sRGB 或改后缀绕过。本次补入匹配的 sRGB ICC 后导入成功，图像压缩数据没有改变。

<details>
<summary>选区与面板设置</summary>

<table>
  <tr>
    <th width="50%" align="center">本次参考图</th>
    <th width="50%" align="center">面板设置</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/reference-white-socks-icc.png"><img src="../../assets/guide/reference-white-socks-icc.png" width="360" alt="实测使用的白袜参考图"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/05-reference-panel.png"><img src="../../assets/guide/05-reference-panel.png" width="360" alt="真实 Portable 面板：角色参考"></a></td>
  </tr>
</table>

</details>

<a id="scene"></a>

## 06 · 场景

<p align="center">
  <a href="../../assets/guide/06-scene-compare.png"><img src="../../assets/guide/06-scene-compare.png" width="760" alt="左侧原图，右侧紫藤花园场景"></a>
  <br><sub>左：原图 · 右：紫藤花园场景</sub>
</p>

1. 复制原样图，清除参考图和旧保护区。Ctrl+单击人物图层缩略图，再 Ctrl+Shift+I 反选整张透明背景。
2. 选择“人像 → 场景替换”，应用到原选区，输入下面的提示词。
3. 开启范围辅助，关闭透明轮廓保留、主体对齐和颜色匹配，确认背景范围后生成。
4. 应用并检查花架、石板路透视、脚下接触阴影及发丝边缘。人物原有光照不会自动变成新的环境光，需要时用 PS 调整层收尾。

本次实测提示词：

> 只将透明背景替换为晴日下午的紫藤花园小径：远处紫藤花架、柔和的绿色植物和透视自然的浅色石板路，人物双脚稳稳站在路面上并有接触阴影；保持原人物、服装、姿势与构图不变。

本次得到完整花园和路面，没有只在腿部周围填一小块；人物不透明部分保持来源像素。

<details>
<summary>选区与面板设置</summary>

<p align="center">
  <a href="../../assets/guide/06-scene-panel.png"><img src="../../assets/guide/06-scene-panel.png" width="400" alt="真实 Portable 面板：场景"></a>
  <br><sub>点击截图，查看原始分辨率的面板设置。</sub>
</p>

<p align="center">
  <a href="../../assets/guide/06-scene-workspace.png"><img src="../../assets/guide/06-scene-workspace.png" width="760" alt="实际 Photoshop 整窗截图"></a>
  <br><sub>Photoshop 原始整窗截图，点击查看。</sub>
</p>

</details>

<a id="effect"></a>

## 07 · 特效

<table>
  <tr>
    <th width="50%" align="center">独立素材</th>
    <th width="50%" align="center">在样图中合成</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/effect-preview.png"><img src="../../assets/guide/effect-preview.png" width="320" alt="生成的特效素材"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/07-effect-result.png"><img src="../../assets/guide/07-effect-result.png" width="320" alt="样图中的 Photoshop 实际合成"></a></td>
  </tr>
</table>

1. 选择“人像 → 特效素材”，应用位置选“新文档”。清除参考图；独立素材不需要人物选区。
2. 输入下面的提示词，生成后检查曲线是否开放、是否混入人物、背景是否真的透明，再点“新文档查看”。本次打开 992×992、sRGB / 16 位素材。
3. 选择素材生成层，用“图层 → 复制图层”复制到原样图副本。Ctrl+T 等比缩放为 900×900 px，左上角 X=50、Y=555 px。
4. 设为“正常”混合、不透明度约 85%。用图层蒙版处理前后遮挡；发光、滤色等按实际需要另外调整。

本次实测提示词：

> 单独一缕紫色绸带形魔法烟雾，开放的 S 形曲线从左下方流向右上方，两端逐渐变细并消散，不闭合、不形成圆环；孤立透明背景，自然半透明边缘，无人物、无文字。

首轮“围绕腿部、中心留空”的描述生成了闭合圆环，未采纳。明确写开放曲线后得到本次素材，再完成实际 PS 合成。它更接近半透明紫色绸带，仍有曲线断点和很淡的 alpha 残留，需要合成修整。

<details>
<summary>查看 Photoshop 工作区</summary>

<p align="center">
  <a href="../../assets/guide/07-effect-asset-workspace.png"><img src="../../assets/guide/07-effect-asset-workspace.png" width="760" alt="实际 Photoshop 整窗截图"></a>
  <br><sub>Photoshop 原始整窗截图，点击查看。</sub>
</p>

</details>

<a id="atmosphere"></a>

## 08 · 氛围

<table>
  <tr>
    <th width="50%" align="center">独立素材</th>
    <th width="50%" align="center">在样图中合成</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/atmosphere-preview.png"><img src="../../assets/guide/atmosphere-preview.png" width="320" alt="生成的氛围素材"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/08-atmosphere-result.png"><img src="../../assets/guide/08-atmosphere-result.png" width="320" alt="样图中的 Photoshop 实际合成"></a></td>
  </tr>
</table>

1. 选择“人像 → 氛围素材”，应用位置选“新文档”，清除参考图。
2. 输入下面的提示词。生成后检查顶部留空、底部有薄雾、没有人物和文字，再“新文档查看”。本次素材为 992×992、sRGB / 16 位。
3. 将生成层复制到原样图副本，等比变换到 900×900 px，左上角 X=50、Y=555 px。
4. 保持“正常”混合，不透明度约 35%。检查雾是否太厚、脸部是否清晰；用蒙版或不透明度减弱多余区域。

本次实测提示词：

> 柔和的浅紫色薄雾与少量漂浮的柔光尘点，雾气集中在画面底部，向上逐渐淡出，顶部留空；透明背景，无人物、无文字、无实心底色。

本次薄雾集中在下方，脸部仍清晰。素材有实际 alpha，但看似空白处仍有很低透明度像素。放到深色底检查，需要时用蒙版清理；写“透明背景”不能代替检查。

<details>
<summary>选区与面板设置</summary>

<p align="center">
  <a href="../../assets/guide/08-atmosphere-panel.png"><img src="../../assets/guide/08-atmosphere-panel.png" width="400" alt="真实 Portable 面板：氛围"></a>
  <br><sub>点击截图，查看原始分辨率的面板设置。</sub>
</p>

</details>

<a id="generate"></a>

## 09 · 文字生图

<p align="center">
  <a href="../../assets/guide/generate-preview.png"><img src="../../assets/guide/generate-preview.png" width="560" alt="文字生图结果"></a>
  <br><sub>文字描述生成的新立绘，不以原样图作为模型输入。</sub>
</p>

1. 选择“生图 → 文字生图”，应用位置选新文档，清除参考图。
2. 观察 3F3F3F.webp 的外观后写成下面的描述。文字生图不会把原图作为模型输入，不需要选区。
3. 候选 1、分辨率 992、25 步、锁定种子 42，生成后检查全身、双脚完整、衣服和背景是否符合描述。
4. 点“新文档查看”，在独立 992×992、sRGB / 16 位文档中继续编辑或保存。

本次实测提示词：

> 全身二次元角色立绘，一位成年女性，粉色长卷发，白色褶皱上衣，粉色与深蓝色长外套，黑色金边短裙，红色手套，黑色系带高跟鞋；一只手抬至脸旁，另一只手自然伸开，精细柔和的动漫插画，单人居中，完整显示双脚，干净的浅紫色背景，无文字。

本次生成包含粉发、白色上衣、粉蓝外套和完整双脚。它是新的角色图，不会保持原图身份、姿势或每个配饰；在原人物上修改衣服请用选区编辑。

<details>
<summary>选区与面板设置</summary>

<p align="center">
  <a href="../../assets/guide/09-generate-panel.png"><img src="../../assets/guide/09-generate-panel.png" width="400" alt="真实 Portable 面板：文字生图"></a>
  <br><sub>点击截图，查看原始分辨率的面板设置。</sub>
</p>

<p align="center">
  <a href="../../assets/guide/09-generate-workspace.png"><img src="../../assets/guide/09-generate-workspace.png" width="760" alt="实际 Photoshop 整窗截图"></a>
  <br><sub>Photoshop 原始整窗截图，点击查看。</sub>
</p>

</details>

<a id="relight"></a>

## 10 · 光影重塑（开发版）

这是通过提示词修改选区光线的编辑模式，不是一键滤镜。目前有离线路径验证，本节不把新效果当作已经完成的宿主实测，也不提供补画的截图。

1. 打开已保存的副本，选中要调整光影的范围。需要保护的细节先设为保护区，再重新圈选编辑范围。
2. 选择“人像 → 光影重塑”，应用位置为“原选区新图层”。
3. 描述方向、软硬与色温，例如：“左上方暖色柔光，右侧保留冷色阴影，保留五官、服装结构和背景。”
4. 透明人物素材保留原透明轮廓。为了避免抵消有意改变的色彩，先关闭上下文颜色匹配；需要指定光线时再添加参考图。
5. 先生成一张，检查五官、边缘与选区外区域，确认后应用为带蒙版的新图层。用不透明度调整强度，需要时一次撤销。

ComfyUI 使用现有编辑工作流；平台需要模型声明支持编辑。平台输出仍为 8 位，步数与种子受各自能力限制。不增加磨皮、去痘等常规人像精修。

## 候选、进度和撤销

- **进度**：模型加载和文本编码显示阶段；采样开始显示真实步数和百分比，完成显示“候选已保存”。编码可能较久，不要反复提交。
- **多候选**：1–4 张依次生成，锁定种子时批次种子依次递增。点击缩略图或下拉框切换。截图的“候选 4”等编号包含面板之前的结果，不代表本次提交四张。
- **回填**：首次新增带蒙版图层，同次捕获切换候选后可“替换本轮候选图层”。来源尺寸、内容或会话变化时拒绝旧快照，防止写错位置。
- **撤销**：一次 Ctrl+Z 撤销一次应用。不透明度修改有自己的记录；PS 撤销后面板滑块不会实时同步。
- **导出**：“另存 PNG”导出处理后候选，尺寸对应捕获上下文，不是整张来源画布。“新文档查看”打开独立 sRGB 文档。预览是 8 位，导出仍按选择的位深。
- **历史**：“读取候选”加载图片，“复用参数”恢复文字和设置；选区、保护区和参考图要重新准备。重启后的旧结果可以导出／新建文档，不能直接回填重开的原稿。
- **取消／断线**：按当前任务 ID 取消并停止后续候选，保留已完成结果。断线后选原记录“恢复任务”，查询原 ID，不重提交；需切回原后端地址。取消未确认时继续查询，不要连续开新任务。

## 参数与颜色

| 参数 | 怎么用 |
| --- | --- |
| 分辨率 | 768、992、1024；编辑保留长宽比并对齐工作流尺寸。 |
| 步数 | 默认 25，可设 1–100；更高不保证更好。 |
| 上下文边距 | 默认 15%；周边内容供模型参考，不会变成可编辑范围。 |
| 范围辅助图 | 视觉参考；严格保护由最终 PS 灰度蒙版完成。参考图模式默认关闭。 |
| 保留原透明轮廓 | 适合衣服、材质编辑；换背景、移除或扩大轮廓时关闭。 |
| 对齐透明主体 | 按透明边界调整大小位置，可能改变局部比例；背景和场景示例关闭。 |
| 颜色匹配 | 只校正小幅整体偏色，本轮关闭。 |

16 位结果可另存 PNG16、新建 RGB16 文档、写入已有 16 位文档；写入 8 位文档会降为 8 位，不自动转换来源。模型输入、参考图和选区蒙版仍为 8 位；高位深输出减少后续量化损失，不代表模型有完整 16 位有效精度，也不是 HDR 或原生宽色域生成。生成区仍可能需要 PS 调色。

## 排错与使用边界

| 现象 | 处理 |
| --- | --- |
| 没有选区／编辑区全被保护 | 重新圈选、检查预览，清除不需要的保护区。 |
| 参考图颜色检查失败 | 在副本中确认并嵌入正确 ICC，见角色参考一节。 |
| 透明图有白底 | 衣服材质编辑开启透明轮廓保留；背景模式关闭。检查原白边和候选 alpha，独立素材仍需清理。 |
| 回填缩小或没填满 | 检查选区、上下文、比例，尝试关闭主体对齐；背景要反选完整背景。不要改工作流尺寸绕过检查。 |
| 来源状态变化，拒绝应用 | 重新捕获生成；旧候选另存 PNG 或新建文档后手工合成。 |
| 半透明多图层无法安全回填 | 保存副本并合并可见层后再生成，或导出手工合成。 |
| 连接、模型、位深错误 | 核对服务、映射、可选保存节点，展开“技术详情”，修正后重试。 |
| PS 整体退出 | 保存工作、记录阶段，结合 Photoshop 事件／转储检查宿主、GPU、驱动和插件。一次成功不能证明永久解决。 |

“宿主诊断 → 图像往返验证”在自己的测试文档中检查选区、保护、蒙版、撤销和回滚；“保存报告”导出结果。“导出运行日志”记录插件阶段，不代替 Photoshop 崩溃转储。

2026-10-17 本轮使用 Windows Photoshop 27.0、GPU 开启及同一张样图：九种模式完成实际生成，六种编辑应用到副本；特效、氛围、文字生图打开 16 位新文档，前两种再与样图实际合成。八份编辑／合成副本的来源图层逐通道一致。六种编辑在有效蒙版外的可见像素及 alpha 无差异，透明保留三例的全画布 alpha 无差异。完全透明像素下不可见的 RGB 不用于合成外观比较，来源图层本身仍逐通道核对。

通过范围限于这些具体操作和效果。服装验证了衣摆编辑，参考验证了白袜迁移；复杂道具重建、身份一致性、其他模型、校准显示器色准、长时间稳定性尚未覆盖。测试期间未发生 Photoshop 整体退出，不能保证以后不崩溃。角色参考、特效和氛围仍属实验能力；不做常规磨皮和去痘。

只连接可信后端，本地 ComfyUI 也保存输入和输出。分享截图前检查隐私与图片授权。代码许可不替代权重和素材许可，版本和来源见 [兼容清单](../../config/compatibility.json)。
