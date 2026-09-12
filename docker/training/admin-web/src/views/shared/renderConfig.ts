/**
 * 2026-08-13: 把后端 Config 表的 JSON 值渲染为"label + 友好数值"表格.
 *   - 已知 key (L_PROMOTE_HK / L_PROMOTE_SG / M_PROMOTE / RECRUITER_RATES / MGMT_RATES / ART_RATES):
 *     用专门 formatter, 字段配中文 label + 业务单位 (USD / TP / %)
 *   - 未知 key: 自动 flatten 成 key.value 行, label 用 key 路径
 *   - 简单标量 (string/number): 单行展示
 */

export interface RenderRow {
  label: string
  value: string
  /** 可选, 显示在 label 旁的灰色提示, 例如 "(HK 标保 USD)" */
  unit?: string
}

const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`
const num = (n: number) => n.toLocaleString()

/** 已知 key 的专门 formatter (返回 N 行展示) */
const KEY_FORMATTERS: Record<string, (v: any) => RenderRow[]> = {
  L_PROMOTE_HK: (v) => [
    { label: 'L2 升级', value: `HK 标保 6m ≥ ${num(v?.L2 ?? 0)}`, unit: 'USD' },
    { label: 'L3 升级', value: `HK 标保 6m ≥ ${num(v?.L3 ?? 0)}`, unit: 'USD' },
  ],
  L_PROMOTE_SG: (v) => [
    { label: 'L2 升级', value: `SG TP 6m ≥ ${num(v?.L2 ?? 0)}`, unit: 'TP' },
    { label: 'L3 升级', value: `SG TP 6m ≥ ${num(v?.L3 ?? 0)}`, unit: 'TP' },
  ],
  M_PROMOTE: (v) => [
    {
      label: 'M2 升级',
      value: `直接招募 ≥ ${v?.M2?.directRecruits ?? 0} 人 + 团队 2 级 6m ≥ ${num(v?.M2?.total6m ?? 0)}`,
    },
    {
      label: 'M3 升级',
      value: `直接招募 ≥ ${v?.M3?.directRecruits ?? 0} 人 + 团队 2 级 6m ≥ ${num(v?.M3?.total6m ?? 0)}`,
    },
  ],
  RECRUITER_RATES: (v) => [
    { label: 'HK L1 招募奖', value: pct(v?.HK_L1 ?? 0) },
    { label: 'HK L2 招募奖', value: pct(v?.HK_L2 ?? 0) },
    { label: 'SG L1 招募奖', value: pct(v?.SG_L1 ?? 0) },
    { label: 'SG L2 招募奖', value: pct(v?.SG_L2 ?? 0) },
    { label: 'ART L1 招募奖', value: pct(v?.ART_BONUS_L1 ?? 0) },
    { label: 'ART L2 招募奖', value: pct(v?.ART_BONUS_L2 ?? 0) },
  ],
  MGMT_RATES: (v) => [
    { label: 'HK 管理奖', value: pct(v?.HK ?? 0) },
    { label: 'SG 管理奖', value: pct(v?.SG ?? 0) },
    { label: 'ART 管理奖 (按级)', value: pct(v?.ART_PER_LEVEL ?? 0) },
  ],
  ART_RATES: (v) => [
    { label: '近现代艺术 (本人提成)', value: pct(v?.ART_MODERN_SELF ?? 0) },
    { label: '当代艺术 (本人提成)', value: pct(v?.ART_CONTEMP_SELF ?? 0) },
  ],
  COMMISSION_TABLE_VERSION: (v) => [
    {
      label: '费用表版本',
      value: String(v ?? 'PENDING'),
      unit: v === 'PENDING' ? '待上传' : undefined,
    },
  ],
}

/** 简单标量 */
function formatScalar(v: any): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}

/** 通用 flatten (未知 key 走这里) */
function flattenGeneric(obj: any, prefix = ''): RenderRow[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    if (v === null || v === undefined) return [{ label: path, value: '—' }]
    if (typeof v === 'object' && !Array.isArray(v)) return flattenGeneric(v, path)
    if (Array.isArray(v)) {
      return v.map((item, i) => ({
        label: `${path}[${i}]`,
        value: typeof item === 'object' ? JSON.stringify(item) : formatScalar(item),
      }))
    }
    return [{ label: path, value: formatScalar(v) }]
  })
}

/**
 * 主入口: 给一个 config key + value, 返回表格行
 *   - 已知 key → 友好中文 label + 业务单位
 *   - 未知 key → 自动 flatten
 *   - 标量 → 单行
 */
export function renderConfigValue(key: string, value: any): RenderRow[] {
  if (value === null || value === undefined) {
    return [{ label: '值', value: '—' }]
  }
  if (typeof value !== 'object') {
    return [{ label: key, value: formatScalar(value) }]
  }
  const formatter = KEY_FORMATTERS[key]
  if (formatter) return formatter(value)
  return flattenGeneric(value)
}

/** 渲染整个 config 对象 (按 key 顺序, 已知 key 在前) → 章节 + 行 */
export function renderConfigSections(config: Record<string, any>): Array<{
  key: string
  title: string
  rows: RenderRow[]
}> {
  const known = Object.keys(KEY_FORMATTERS)
  const orderedKeys = [
    ...known.filter((k) => k in config),
    ...Object.keys(config).filter((k) => !known.includes(k)),
  ]
  const titleMap: Record<string, string> = {
    L_PROMOTE_HK: 'L 业务等级 (HK 港险标保)',
    L_PROMOTE_SG: 'L 业务等级 (SG 新加坡 TP)',
    M_PROMOTE: 'M 管理等级',
    RECRUITER_RATES: '招募奖比例',
    MGMT_RATES: '管理奖比例',
    ART_RATES: 'ART 销售者提成',
    COMMISSION_TABLE_VERSION: '费用表版本',
  }
  return orderedKeys.map((k) => ({
    key: k,
    title: titleMap[k] ?? k,
    rows: renderConfigValue(k, config[k]),
  }))
}
