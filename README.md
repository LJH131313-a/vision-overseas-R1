# 远见·企业出海助手 R1（第二版）

基于原站（LJH131313-a/vision-overseas，只读基线 `81604dc`）整合三位队友二次交付的第二版，发布于**独立仓库**：https://github.com/LJH131313-a/vision-overseas-R1

线上地址：**https://ljh131313-a.github.io/vision-overseas-R1/**

## 与原站的差别

| 维度 | 原站 | R1 第二版 |
| --- | --- | --- |
| 项目数据键 | `vo-workbench-v2` | `vo-r1-workbench-v2`（同域名下互不覆盖） |
| 税费引擎 | SG/AU 基础计算 | 合并 zky 修复：HS 候选 ID 解析、核验日≠失效日、多情景联动重建、多次销售 GST 规则、汇总文案「本模型已覆盖法定项目汇总」 |
| 首页 | 无 | 封面 + 开始项目/浏览研究/新闻雷达入口 + 五步上手说明 |
| 产品研究 | 无 | 16 款中国品牌真空吸尘产品档案（品牌/型号/地区搜索、类型筛选、逐字段规格、带入项目） |
| 政策原文 | 无 | 4 份新加坡法规 PDF 归档（SHA-256 校验、官方参考、版本标记） |
| 新闻雷达 | 列表 | 列表 + 内嵌地图雷达视图（洲/国/产品/级别筛选、近两年、每页 20 条、卡片可「加入当前项目」） |

## 快速开始

- 在线使用：打开上面的 GitHub Pages 地址。
- 本机使用：双击 `index.html`（数据经 `<script>` 加载，无需服务；新闻采集与部署由 GitHub Actions 完成）。

## 架构

```
index.html                 # 主工作台（向导主线 + 首页封面）
research/index.html        # 产品研究档案（16 型号，子页）
policy-documents/index.html# 政策原文归档入口（子页）
modules/radar.html         # 地图雷达（嵌入主站新闻页；与主站共用 ../data/news.json）
css/ js/ data/             # 样式、引擎与数据包
policy-documents/SG/       # 4 份原始 PDF + index.json（哈希索引）
research/                  # 研究数据 + 研究 HTML 全文
tests/                     # 引擎 208 + 税费 15 + R1 集成 87 + DOM 冒烟 86
.github/workflows/         # 定时采集（09:17/17:17）→ workflow_run 触发 Pages 发布
```

## 发布（本仓库）

1. 仓库 **Settings → Pages** → Source 选 **GitHub Actions**（仅需一次）。
2. 推送 `main` 自动发布；新闻采集完成后由 `workflow_run` 自动重新发布。
3. 发布前 Actions 会跑 208 项引擎断言、15 项税费衔接断言与 87 项第二版集成检查，任一失败即中止发布。

## 边界与诚实声明

- HS 仅为候选方向；官方新闻 ≠ 已生效法规；PDF 归档 ≠ 已结构化/已生效；研究参数不得当作申报参数（充电电压≠市电电压，吸力 Pa≠功率 W）。
- 税费汇总口径为「本模型已覆盖法定项目汇总」，不是完整到岸成本；关键条件不足时完整总额保持不可用，不按 0 处理。
- jsdom 冒烟测试不等于真实浏览器视觉验证；真实浏览器视觉验收未执行（未验证）。
- 千问 API 为用户自带密钥直连（仅存本机 localStorage，不入库不入导出）；本仓库不含任何密钥。

## 二次交付明细

见 [docs/R1-SECOND-DELIVERY.md](docs/R1-SECOND-DELIVERY.md)。
