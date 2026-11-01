# Requirements Document — NAI 直连与生图管线增强

Feature: nai-pipeline-upgrade
Updated: 2026-10-31

## Introduction

为小艺绘画（单文件 PWA）接入 NovelAI（NAI）原生图像 API，并补齐生图管线的四项能力：同 seed 变体矩阵、局部重绘、Service Worker 离线缓存、PNG 元数据读写。全部改动保持在 `xiaoyi-paint.html` 单文件架构与「用户自带 API Key」的产品约定内。

## Glossary

- **Provider（提供方）**: 生图后端类型。取值 `openai`（现有 OpenAI 兼容 API）或 `nai`（NovelAI 原生 API）。
- **NAI Token**: NovelAI 持久访问令牌（persistent API token），用于 `Bearer` 鉴权。
- **变体矩阵**: 锁定同一 seed，用多组画师串/提示词差异各生成一张，按网格并排对比的视图。
- **局部重绘（Inpainting）**: 对已有图片涂抹蒙版，仅重绘蒙版区域。
- **Vibe Transfer**: NAI 的参考图风格迁移机制（reference_image_multiple）。
- **NAI UC 预设**: NovelAI 官方负面词预设（Heavy / Light / Human Focus / None）。
- **characterPrompts**: NAI v4 系模型的多角色提示词结构，每个角色带独立 prompt、uc 与画布位置。
- **tEXt 块**: PNG 文件内的文本元数据块。

## Requirements

### R1 NAI 直连配置与鉴权

**User Story:** AS 画师串研究者，I want 直接用我的 NAI 订阅出图，so that 免去中转 API 的格式损耗，用上 NAI 原生参数。

#### Acceptance Criteria

1. WHEN 用户在「配置」页将提供方切换为 `nai`，系统 SHALL 显示 NAI Token 输入框、NAI 模型列表与 NAI 专属参数区（采样器、CFG scale、steps、UC 预设、CFG rescale、Variety+、画质标签开关）。
2. THE system SHALL 将 NAI Token 保存在 localStorage（沿用现有 `xy_presets` 存储约定），并在界面上以密码框遮蔽。
3. WHEN 用户使用 `nai` 提供方生成图片，system SHALL 向 `https://image.novelai.net/ai/generate-image` 发送 POST 请求，请求体包含 `input`、`model`、`action`、`parameters`，鉴权头为 `Authorization: Bearer <token>`。
4. WHEN NAI 返回 ZIP 压缩包，system SHALL 在浏览器内解压并提取其中的 PNG 显示为生成结果。
5. IF 生成请求返回 401，system SHALL 提示「Token 无效或已过期」。
6. IF 生成请求返回 402，system SHALL 提示「Anlas 不足或分辨率/步数超出订阅额度」。
7. WHEN 用户提供 NAI Token，system SHALL 调用 `https://api.novelai.net/user/subscription` 验证订阅状态，并区分 Opus（免费额度 1024×1024 且 steps≤28）与普通订阅。
8. THE system SHALL 提供 NAI 模型静态清单（含 `nai-diffusion-4-5-full`、`nai-diffusion-4-5-curated`、`nai-diffusion-4-full`、`nai-diffusion-4-curated`、`nai-diffusion-3`、`nai-diffusion-3-inpainting`、`nai-diffusion-4-full-inpainting`、`nai-diffusion-4-5-full-inpainting`），并标注各模型的默认尺寸与支持能力。

### R2 NAI 参数映射

**User Story:** AS NAI 用户，I want 在小艺绘画里直接调 NAI 原生参数，so that 出图效果与 NAI 官网一致。

#### Acceptance Criteria

1. WHEN 使用 `nai` 提供方生成，system SHALL 将通用参数映射为 NAI 参数：尺寸→`width`/`height`、步数→`steps`、负面词→`negative_prompt`、seed→`seed`、采样器→NAI 采样器枚举（`k_euler`、`k_euler_ancestral`、`k_dpmpp_2s_ancestral`、`k_dpmpp_2m`、`k_dpmpp_sde`）。
2. THE system SHALL 在 `parameters` 中携带 `params_version: 3`、`n_samples: 1`、`cfg_rescale`、`noise_schedule`，以及 Variety+ 对应的 `skip_cfg_above_sigma`。
3. WHEN 用户选择 UC 预设，system SHALL 按模型版本（v3/v4/v4.5 各自的预设串）拼接官方 UC 前缀与用户自定义负面词。
4. WHEN 模型为 v4 系且用户已选中形象卡，system SHALL 将每张形象卡映射为一个 `characterPrompts` 条目（`prompt`、`uc`、`center` 坐标），并同步构造 `v4_prompt.caption.char_captions` 与 `v4_negative_prompt`。
5. WHEN v4 系模型选中形象卡且用户开启「锁定站位」，system SHALL 设置 `use_coords: true`；默认 SHALL 使用 `use_coords: false`。
6. IF 画师串中出现 NAI 权重语法不兼容的片段，system SHALL 原样透传提示词（NAI 与本工具的 `artist:xxx` / 权重括号写法一致）。

### R3 同 seed 变体矩阵

**User Story:** AS 画师串研究者，I want 用同一 seed 并排对比多组画师串，so that 精确分辨每组串对画面的影响。

#### Acceptance Criteria

1. WHEN 用户在生成结果或小样库触发「变体矩阵」，system SHALL 以当前图的 seed 为锁定值，为用户挑选的 2~4 组画师串各生成一张图。
2. THE system SHALL 按网格并排展示变体结果，每格标注对应的画师串摘要与 seed。
3. WHEN 用户点击矩阵中某一格，system SHALL 提供操作：查看大图、把该格画师串存入词库、以该格参数继续聊天生成。
4. IF 某一格生成失败，system SHALL 在该格显示失败原因并提供单格重试。
5. THE system SHALL 保证矩阵内所有请求使用同一 seed 与同一组通用参数（尺寸、steps、sampler、负面词），仅提示词不同。
6. WHEN 提供方为 `openai`，矩阵功能 SHALL 等价可用（seed 随 OpenAI 兼容 API 是否支持而降级提示）。

### R4 局部重绘

**User Story:** AS 画师，I want 在生成图上涂抹蒙版后只重画选中区域，so that 修手修脸且保住画面其余部分。

#### Acceptance Criteria

1. WHEN 用户对图库或聊天中的图片触发「局部重绘」，system SHALL 打开蒙版编辑器，提供画笔、橡皮、画笔粗细调节、撤销与清空。
2. THE system SHALL 以半透明高亮显示蒙版区域，蒙版保存为黑白 PNG（重绘区域为白色）。
3. WHEN 提供方为 `nai`，system SHALL 以 `action: "infill"` 发送，携带 `mask`（base64）、`image`（base64）、`add_original_image: true`，并提示需要重绘模型；用户选择重绘模型时自动切换。
4. WHEN 提供方为 `openai`，system SHALL 以 `/images/edits` 发送 `image` 与 `mask` 双文件。
5. WHEN `nai` 重绘请求发起，system SHALL 附带 `strength`（重绘强度）与 `noise` 参数供用户调节。
6. IF 未涂抹任何蒙版就确认，system SHALL 阻止提交并提示先涂抹区域。
7. WHEN 重绘完成，system SHALL 将结果图入库，并在记录中关联原图与蒙版缩略信息。

### R5 Vibe Transfer（NAI 参考图）

**User Story:** AS NAI 用户，I want 把参考图作为 Vibe 传给 NAI，so that 画风可控且不受提示词长度挤压。

#### Acceptance Criteria

1. WHEN `nai` 提供方下用户附加参考图并选择「Vibe 模式」，system SHALL 将参考图转 base64 填入 `reference_image_multiple`，并暴露 `reference_information_extracted_multiple`（默认 0.7）与 `reference_strength_multiple`（默认 0.6）两个系数。
2. THE system SHALL 支持最多 4 张 Vibe 参考图。

### R6 Service Worker 离线缓存

**User Story:** AS 手机用户，I want 应用能安装且弱网/离线可用，so that 随时打开就能继续调串。

#### Acceptance Criteria

1. THE system SHALL 注册 Service Worker，预缓存应用壳（`index.html`、`xiaoyi-paint.html`、`manifest.webmanifest`、图标）。
2. WHEN 请求命中静态资源（图标、`samp/` 小样图），Service Worker SHALL 采用缓存优先策略并回填缓存。
3. WHEN 请求命中 HTML 文档，Service Worker SHALL 采用网络优先、失败回退缓存的策略。
4. WHEN API 请求（生成、聊天）在离线时发出，system SHALL 直接失败并提示当前处于离线状态。
5. WHEN 应用代码发版（HTML 内容变化），Service Worker SHALL 在下次访问时更新缓存版本。

### R7 PNG 元数据写入与读取

**User Story:** AS 画师串研究者，I want 出图的 PNG 自带完整提示词与参数，so that 任何图都能随时还原生成条件。

#### Acceptance Criteria

1. WHEN 任意提供方生成图片成功，system SHALL 在 PNG 内写入 tEXt 块：`Software`、`Source`（模型名）、`Description`（正向提示词）、`Comment`（JSON：prompt、steps、width、height、scale、seed、sampler、negative_prompt、provider、ucPreset 等）。
2. THE system SHALL 写入 A1111 风格的 `parameters` 文本块，保证主流工具可读。
3. WHEN 用户导入或长按一张带元数据的 PNG（含 NAI 官网出图），system SHALL 解析元数据并提供「还原提示词与参数」操作。
4. WHEN 还原操作确认，system SHALL 将解析出的提示词、负面词、seed、尺寸、采样器填入当前生成配置。
5. IF PNG 无元数据，system SHALL 提示该图未包含生成信息。
6. THE system SHALL 保证往返一致性：由本工具生成的 PNG 经导入还原后，提示词、负面词、seed、尺寸、采样器与生成时完全一致。

## Parsers / Serializers（显式清单）

- **ZIP 解析器**：解析 NAI 返回的 ZIP（提取首个 PNG 成员）。验收：对 NAI 真实返回样例解出完整 PNG 字节。
- **PNG tEXt 写入器**：向 PNG 字节流插入/更新 tEXt 块（写入 `IHDR` 后、`IDAT` 前）。验收：写入后文件可被标准 PNG 解码器正常打开。
- **PNG tEXt 读取器**：遍历 chunk 提取全部 tEXt 键值。验收：读回本工具写入的全部键值一致（round-trip）；能读出 NAI 官网出图的 `Comment`/`Description`。
- **NAI 请求序列化器**：通用参数 → NAI `parameters` JSON。验收：R2 各条映射正确。

## Scope Confirmation（2026-10-31 用户确认）

- 本期范围：R1~R2（NAI 直连作为矩阵/重绘的底层通道）、R3（变体矩阵）、R4（局部重绘）、R6（Service Worker）、R7（PNG 元数据）。
- NAI 鉴权采用持久 Token 方案。
- 变体矩阵采用「锁 seed 对比画师串」形态（2~4 格）。
- NAI v4.5 多角色提示词（characterPrompts）本期不做，R2 条款 4/5 顺延至下期。

## Out of Scope（本期不做）

- NAI 文本生成（谈天/翻译走现有 chat 模型）。
- ControlNet、ControlNet Mask 等高阶 NAI 接口。
- NAI v4.5 多角色提示词 characterPrompts（R2.4、R2.5 顺延下期）。
- Anlas 精确计费预估表（仅做 Opus 免费额度判断与 402 提示）。
