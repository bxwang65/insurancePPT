# 产品签名注册状态

已注册签名的产品会自动走 fitz/pdfplumber 精确提取，不注册的走 LLM 兜底。

## ✅ 已注册（精确提取）

| 公司 | 产品 | 类型 | 签名ID | 提领数据 |
|------|------|:----:|--------|:--------:|
| CTF 周大福 | 匠心传承2(尊尚版) | 储蓄 | ctf-mw2iua-v1 | ✅ |
| CTF 周大福 | 守護家倍198 | 重疾 | ctf-hb4cila10-v1 | N/A |
| AIA 友邦 | 环宇盈活(5年) | 储蓄 | aia-huanyu5-v1 | ✅ |
| AIA 友邦 | 财富挚2 | 储蓄 | aia-we2-v1 | ✅ |
| AIA 友邦 | 充裕未来 | 储蓄 | aia-elite3-v1 | ✅ |
| FWD 富卫 | 盈聚天下II | 储蓄 | fwd-atarp2-v1 | ✅ |
| FWD 富卫 | 盈聚天下II | 储蓄 | fwd-atarp2-v1 | ✅ |
| CPIC 太平洋保险 | 世代悅享3 | 储蓄 | cpic-aarj31u-v1 | ✅ |
| YFLife 万通 | 富饶万家(5年) | 储蓄 | yflife-bisp5-v1 | ✅ |
| China Life 中国人寿 | 傲瓏盛世(美元) | 储蓄 | chinalife-c540-v1 | ✅ |
| China Taiping 中国太平 | 颐年樂享(尊享版) | 储蓄 | china-taiping-1121nwlp7-v1 | ✅ |
| **PRU 保诚** | **信守明天多元货币** | **储蓄** | **pru-trst-v1** | **✅** |

## ❌ 未注册（使用LLM兜底）

| 公司 | 产品 | 类型 | 原因 |
|------|------|:----:|------|
| 任何 | 新上传的未签名产品 | 任意 | 需手动注册签名 |

## 注册新产品流程

1. 用 `python3.11 -c "import fitz; ..."` 分析PDF页结构
2. 确定 `pageTargets`（摘要页/不提领页/提领页）
3. 在 `src/extraction/signatures/registry.ts` 添加签名项
4. 运行 `bun run src/cli.ts extract --pdf 文件.pdf` 测试
5. 验证数据准确性

## 已知问题

- CPIC 世代悅享3 的提领数据尚未验证
- 提领表格为11列复杂格式，需确认 pdfplumber 能否解析
