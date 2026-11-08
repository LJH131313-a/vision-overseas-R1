# R1 第二版整合与交付说明（2026-11-08）

## 一、输入与策略

- 基线：原仓库 LJH131313-a/vision-overseas 只读提交 `81604dc5cce01318284793bbcc18e60ed539e91d`（未修改原仓库任何分支/设置/Pages；交付前已核对原仓库 HEAD 未变）。
- 输入：`D:\文档\千问办公\ai出海\二次提交`（zky / yjh / wjy 三份交付，ZIP 已解压使用，原文件保留）。
- 原站 localStorage 键 `vo-workbench-v2`；R1 独立键 `vo-r1-workbench-v2`，同一 github.io 域名下互不覆盖。

## 二、zky：税费修复合并

- 基线核对：zky 说明所引 blob（js/app.js `a00ac67`、js/engine.js `57225f0`）与 81604dc 完全一致；因 patch 上下文行号漂移无法 `git apply`，改用其整文件（内容 = 基线 + patch 结果，已经 diff 验证为补丁目标形态）。
- 合并内容：js/app.js、js/engine.js、tests/tax-ui-regression.cjs、policy-documents/SG（4 PDF + index.json + README）、TAX_FIX_NOTES.md（存 docs/）。
- 关键行为：
  - HS 候选按市场解析 ID→编码，兼容直接编码；旧项目数据兼容。
  - 最后核验日（2026-11-04）不作为法律失效日；按画像 effective_from/to 匹配，核验日后提示复核风险但不停算；2027 越界仍阻断（覆盖边界 ≠ 法律失效）。
  - 币种/Incoterm/多次销售/优惠切换即时重建依赖表单。
  - 多次销售未确认最后买方/申报主体 → GST 税基与税额为空（null），不填 0。
  - 汇总文案统一「本模型已覆盖法定项目汇总」。
- PDF 归档：4 份逐一 SHA-256 + 大小校验通过（构建时实测，并写入集成测试）；policy-documents/index.html 提供入口（打开 PDF / 官方参考 / 版本标记 / 哈希），并声明「归档 ≠ 全文已结构化 ≠ 规则已生效」。
- 验收复算（引擎直测）：SG 水壶 HS-SG-K1/85167910、CN、2026-11-08、FOB 10000 SGD、运 800 保 100 → 海关价值 10900 / 关税 0 / GST 981 / 已覆盖汇总 981.90 / 操作费 2.29 另列；多次销售 LSP 15000 且主体确认 → GST 1350，未确认 → null；2027-01-05 越界 → 无完整汇总并说明。

## 三、yjh：首页、引导与研究档案

- 布局参考《远见工作台布局交接示例.html》：绿色浅底卡片式工作台；首页封面「让每一款小家电，都有清晰的出海准备路径。」+ 开始项目/浏览研究/新闻雷达入口 + 五步上手说明（均为真实交互：开始项目跳第 1 步、雷达跳新闻页、五步卡片可跳对应步骤）。
- 解析《中国品牌真空吸尘产品与出海研究.html》id=product-data JSON：16 型号、5 结构类型（cat1:3/cat2:4/cat3:3/cat4:3/cat5:3）。
- research/index.html：品牌/型号/地区搜索 + 类型筛选；卡片展示地区证据、逐字段规格表、待补项、研究解释、候选归类方向（标「非海关确定结论」）、原始 URL；保留研究 HTML 全文入口。
- 带入：确认弹窗说明将替换当前情景；只载入品牌/型号/小类/地区（类型映射 1→C-VAC-001 … 5→C-VAC-005；证据地区映射 DE/MY/AU/UK_GB/US，多地区资料保留原文说明）；重置 facts/factsUnknown/hsChoice；完整档案存 project.researchEvidence。
- researchEvidence 纳入 inputHash（同市场同小类换型号也会使旧千问建议/报告快照失效），注入千问任务（「产品研究档案证据（R1）」节）与综合报告（1b 卡）。
- 不猜测实际出口参数：充电电压≠市电电压、吸力 Pa≠功率 W 的声明在带入弹窗与档案页。

## 四、wjy：地图雷达与共享证据

- modules/radar.html：保留内嵌地图、洲/国家/产品/政策/关注级别筛选、搜索、近两年窗口、每页 20 条分页。
- 改造：移除 ./api/news、./api/refresh 与 SQLite 运行时依赖；数据改读 ../data/news.json（与主站同源同快照）；「立即更新」→「重新读取快照」（不宣称浏览器触发采集）；说明文字改为共用快照表述。
- 新闻合并：wjy 快照 5 条按 URL 并入主站 53 条快照，全部已存在（0 新增，无重复）。
- 「加入当前项目」：卡片按钮 postMessage {type:'radar-select',url}；父页三重校验（同源 origin + source===iframe.contentWindow + URL 在主站 NEWS.items 中）后用主站 newsId 写入 newsSelected，真实进入千问任务与报告。
- 动态文本 HTML 转义；URL 限定 http/https；外链保留 noopener。新闻提示不作为正式法规（页面已有声明）。
- 主站新闻页保留原列表视图，新增「切换地图雷达视图」按钮（iframe 懒加载）。

## 四b、二轮修复：市场切换币种残留（2026-11-08）

**问题**：用户反馈“现行版本没办法很好的计算关税”。排查结论：引擎与税费画像本身正确（AU 水壶 5%、SG GST 等数字均对），真正的故障在 UI 衔接——项目默认币种 SGD，切换到 AU 市场后币种仍残留 SGD，触发“缺少 SGD→AUD 法定汇率记录”阻断，导致关税/GST 全部显示不可用。

**修复**（js/app.js）：新增 syncTaxCurrency——仅当「币种所记录的市场」与当前市场不一致、且币种为空或为另一市场本币（旧默认/残留）时，自动回到当前市场本币并清空旧汇率记录；在 renderTax 表单构建前执行（保证标签与选项正确）；用户显式选择的币种（含 USD/CNY）记录 currencyMarket，跨市场保留不被误纠正。zky 的 tax-ui-regression.cjs 提取起点同步前移到 syncTaxCurrency（仅扩展提取范围，未改任何断言）。

**验证**（jsdom 四场景 + 断言固化）：AU 市场残留 SGD → 自动 AUD，关税 100.00、汇总 AUD 443.00；切回 SG → 币种回 SGD、GST 981 / 汇总 981.90、无汇率阻断；显式 USD 保留且汇率输入出现；显式 USD 跨市场保留（用户意图优先）。已加入 dom-smoke 第 13 节（93 项断言）。剩余“贸易救济未确认”阻断为原始需求规定的有意安全门（未确认不得按零处理），用户勾选“已核查：无适用措施”后即可出完整汇总。

## 五、测试结果（实际执行）

| 套件 | 结果 |
| --- | --- |
| tests/engine.test.mjs（原 208 项） | 208/208 通过 |
| tests/tax-ui-regression.cjs（zky 新增 15 项） | 15/15 通过 |
| tests/r2-integration.test.mjs（R1 集成 87 项：文件完整性/无违禁文件/独立键/雷达改造/16 型号/PDF 哈希/首页功能/工作流权限/敏感信息） | 87/87 通过 |
| tests/dom-smoke.mjs（jsdom 冒烟 93 项：含研究带入、postMessage 三重校验、USD/DDP 联动、981/981.90 复算、快照失效、市场切换币种残留修复） | 93/93 通过 |
| tests/static-assets.test.mjs | 29/29 通过（子路径相对资源、无绝对路径、无密钥） |

未验证项（如实）：真实浏览器视觉验证（Playwright/Chromium 环境不可用）；云端 Actions 首跑结果在推送后由仓库 Actions 记录。

## 六、仓库与发布

- 新仓库：https://github.com/LJH131313-a/vision-overseas-R1（独立，未动原仓库）。
- 工作流：update-news.yml（北京时间约 09:17/17:17 采集，contents:write）+ deploy-pages.yml（push main / workflow_run 新闻完成后 / 手动；permissions 仅 contents:read、pages:write、id-token:write，无 administration；发布前跑 208+15+87 三套检查）。
- 启用 Pages→GitHub Actions 需在仓库 Settings → Pages 设置一次（Source: GitHub Actions）。

## 七、发布包

公开内容：index.html、favicon、css、js、data、modules、research、policy-documents（含 PDF）、tests、tools、.github、README、docs。
不公开：SQLite、缓存、密钥、原始 ZIP/change.patch、node_modules（集成测试第 2 节自动检查）。
