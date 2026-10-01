/**
 * 名字规范化与「目标值」解析。
 *
 * 剧本是自然语言，同一个技能有各种写法：
 *   「格斗 ( 斗殴 )」 / 「格斗:斗殴」 / 「格斗（斗殴）」
 *   「科学 ( 植物学 )」 / 「科学:植物学」
 * 如果不先把它们归一，判定时就会查不到技能值，静默退化成 0% —— 这种 bug
 * 玩家只会感觉「怎么老是失败」，很难定位。所以这里显式做归一，并配有测试。
 *
 * 归一规则（与 skills.json 的 meta.normalize 一致）：
 *   1. 去掉所有空白（含全角空格）
 *   2. 全角/半角括号 → 半角冒号 ':'
 *   3. 全角冒号 → ':'
 *   4. 合并/去掉多余的冒号
 */

import { ATTR_BY_LABEL, ATTR_LABELS, type AttrKey, type Character } from './types'
import { SKILL_TABLE, RULES, type SkillDef } from './content'

/** 剧本里对「幸运」「理智」的检定，它们不是属性也不是技能。 */
export const DERIVED_BY_LABEL: Record<string, 'Luck' | 'SAN'> = {
  幸运: 'Luck',
  理智: 'SAN',
  理智值: 'SAN',
}

export function normalizeName(raw: string): string {
  return raw
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（(]/g, ':')
    .replace(/[）)]/g, '')
    .replace(/[：]/g, ':')
    .replace(/:+/g, ':')
    .replace(/^:/, '')
    .replace(/:$/, '')
}

/** 裸技能名（不带专攻）的默认具体技能。 */
const BARE_DEFAULTS: Record<string, string> = {
  格斗: '格斗:斗殴',
  射击: '射击:手枪',
  图书馆: '图书馆使用',
  外语: '语言:英语',
  魅惑: '取悦',
  母语: '母语',
}

/** 家族技能（有专攻）：单独出现时应退化为基础值而不是查不到。 */
export const SKILL_FAMILIES = ['技艺', '科学', '语言', '格斗', '射击', '驾驶', '生存', '母语']

export function isAttrLabel(name: string): boolean {
  return name in ATTR_BY_LABEL
}

export type TargetKind = 'attr' | 'derived' | 'skill' | 'unknown'

export interface TargetInfo {
  kind: TargetKind
  /** 规范化后的键（技能表键 / 属性键 / 'Luck' | 'SAN'） */
  key: string
  /** 展示用标签 */
  label: string
  /** 当前值 */
  value: number
}

/**
 * 把剧本里的一个名字（技能或属性）解析成可用于判定的目标值。
 * 找不到时 kind = 'unknown' 且 value = 0 —— 调用方应当把这种情况暴露出来，
 * 而不是装作一切正常。
 */
export function resolveTarget(char: Character, rawName: string): TargetInfo {
  const name = normalizeName(rawName)

  // 1) 属性：力量 / 体质 / ...
  const attrKey = ATTR_BY_LABEL[name]
  if (attrKey) {
    return { kind: 'attr', key: attrKey, label: ATTR_LABELS[attrKey], value: char.attributes[attrKey] }
  }

  // 2) 衍生值：幸运 / 理智
  const derivedKey = DERIVED_BY_LABEL[name]
  if (derivedKey === 'Luck') {
    return { kind: 'derived', key: 'Luck', label: '幸运', value: char.luck }
  }
  if (derivedKey === 'SAN') {
    return { kind: 'derived', key: 'SAN', label: '理智', value: char.san }
  }

  // 3) 技能：先精确，再别名，再裸名默认，最后家族基础值
  const direct = char.skills[name]
  if (direct) {
    return { kind: 'skill', key: name, label: skillLabel(name), value: direct.value }
  }

  const alias = SKILL_TABLE.aliases[name]
  if (alias && char.skills[alias]) {
    return { kind: 'skill', key: alias, label: skillLabel(alias), value: char.skills[alias].value }
  }

  const bare = BARE_DEFAULTS[name]
  if (bare && char.skills[bare]) {
    return { kind: 'skill', key: bare, label: skillLabel(bare), value: char.skills[bare].value }
  }

  const def = skillDef(name)
  if (def) {
    // 走到这里说明 name 本身就在技能表里、只是角色卡上没有这一条
    // （buildSkillTable 会给整张表建条目，所以正常角色不会走到这儿）。
    // 家族技能（技艺/科学/格斗/…）在表里都有裸行，那就是书规定的下限。
    // 注意必须走 skillBaseValue：母语/闪避 这类 def.base 是 0，
    // 真实值由属性推导（母语 = 教育、闪避 = 敏捷/2）。直接用 def.base 会给出 0%。
    return {
      kind: 'skill',
      key: name,
      label: def.label,
      value: skillBaseValue(name, char.attributes),
    }
  }

  return { kind: 'unknown', key: name, label: rawName.trim(), value: 0 }
}

/**
 * 把一个技能名（可能是裸名、别名、带专攻写法）解析成技能表里的键。
 * 与 resolveTarget 的区别：这里不需要角色，只看技能表。
 */
export function resolveSkillKey(raw: string): string | undefined {
  const name = normalizeName(raw)
  if (!name) return undefined
  if (SKILL_TABLE.skills[name]) return name
  const alias = SKILL_TABLE.aliases[name]
  if (alias && SKILL_TABLE.skills[alias]) return alias
  const bare = BARE_DEFAULTS[name]
  if (bare && SKILL_TABLE.skills[bare]) return bare
  return undefined
}

/**
 * 这个名字能不能解析成一个有意义的目标？
 * 覆盖三类：八项属性、幸运/理智这两个衍生值、技能表里的键（含专攻写法）。
 * 剧本校验用它来发现「静默 0%」的内容缺口 —— 属性不是技能，
 * 只查技能表会把「敏捷检定」误判成缺口。
 */
export function isResolvableTarget(raw: string): boolean {
  const name = normalizeName(raw)
  if (!name) return false
  if (isAttrLabel(name)) return true
  if (name in DERIVED_BY_LABEL) return true
  return resolveSkillKey(name) !== undefined
}

export function skillDef(name: string): SkillDef | undefined {
  return SKILL_TABLE.skills[name]
}

export function skillLabel(name: string): string {
  return SKILL_TABLE.skills[name]?.label ?? name
}

/** 技能基础值：含闪避 = 敏捷/2、母语 = 教育 这类由属性推导的值。 */
export function skillBaseValue(name: string, attributes: Record<AttrKey, number>): number {
  const def = skillDef(name)
  if (!def) return 0
  if (def.computed) {
    const attrValue = attributes[def.computed.attr] ?? 0
    return def.computed.kind === 'attrOver'
      ? Math.floor(attrValue / (def.computed.divisor ?? 1))
      : attrValue
  }
  return def.base
}

/** 困难/极难判定所需的读数阈值（用于 UI 显示 "85% (42/17)"）。 */
export function thresholds(value: number): { hard: number; extreme: number } {
  return { hard: Math.floor(value / 2), extreme: Math.floor(value / 5) }
}

// --- 职业的「本职技能」自然语言 → 具体技能 --------------------------------

const COUNT_WORDS: Record<string, number> = { 一: 1, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

/** 「两项」「三项」→ 2 / 3；没写数量返回 0。 */
function countFromText(text: string): number {
  const m = /([一两二三四五六])项/.exec(text)
  if (!m) return 0
  return COUNT_WORDS[m[1]] ?? 0
}

/** 「任意」「任选」「任何」「特长」都表示完全开放的自由槽位。 */
const OPEN_WORDS = /任意|任选|任何|特长/

/** 括号里的候选项（"两项社交技能（魅惑、话术、恐吓、说服）"）。 */
function parenItems(text: string): string[] {
  const m = /[（(]([^）)]*)[）)]/.exec(text)
  if (!m) return []
  return m[1]
    .split(/[，,、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface SkillChoice {
  /** 需要从中选几项 */
  count: number
  /** 候选技能键（全部合法，绝不会出现解析不出来的项） */
  from: string[]
}

export interface ResolvedOccupationSkills {
  /** 确定的本职技能键 */
  fixed: string[]
  /** 「从下列候选中选 N 项」（例如"两项社交技能（…）"） */
  choices: SkillChoice[]
  /** 「任意 N 项其他个人或时代特长」这类完全开放的自由槽位总数 */
  freeSlots: number
}

/**
 * 把职业表的「本职技能」自然语言（"任意两项其他个人或时代特长（如骑乘或格斗）"）
 * 解析成具体技能键 + 选择项 + 自由槽位数。
 *
 * 这是**尽力而为**的启发式，但遵守两条硬规则：
 * 1. 绝不把「候选列表」当成「白送全部」——"两项社交技能（A、B、C、D）" 是
 *    四选二，不是四项全给。
 * 2. 绝不静默丢项——认不出来的条目一律计入自由槽位，由分配器补齐。
 */
export function resolveOccupationSkills(raw: string[]): ResolvedOccupationSkills {
  const fixed: string[] = []
  const choices: SkillChoice[] = []
  let freeSlots = 0

  for (const entryText of raw) {
    const text = entryText.trim()
    if (!text) continue

    const main = normalizeName(text.split(/[（(]/)[0] ?? text)
    const mainIsFamily = isSkillFamily(main)
    const candidates: string[] = []
    for (const item of parenItems(text)) {
      // 「技艺（表演）」括号里只有专攻名，必须先拼回「技艺:表演」再查表
      const key = (mainIsFamily ? resolveSkillKey(`${main}:${item}`) : undefined) ?? resolveSkillKey(item)
      if (key) candidates.push(key)
    }

    const wantsSocial = text.includes('社交技能')
    const isOpen = OPEN_WORDS.test(text)
    const count = countFromText(text)

    // 1) 完全开放：「任意一项其他个人或时代特长」
    if (isOpen && !wantsSocial) {
      freeSlots += count || 1
      continue
    }

    // 2) 社交技能：候选池固定为技能表里的社交组（书里括号内也就是这四项）
    if (wantsSocial) {
      const pool = SKILL_TABLE.groups['社交技能'] ?? candidates
      if (pool.length === 0) {
        freeSlots += count || 1
        continue
      }
      choices.push({ count: Math.min(count || pool.length, pool.length), from: pool })
      continue
    }

    // 3) 带专攻的家族技能：技艺（表演）
    if (mainIsFamily) {
      if (candidates.length > 0) {
        // 「科学（生物学，化学）」= 从这几个里选；「技艺（表演）」= 就一个
        if (count > 0 && count < candidates.length) {
          choices.push({ count, from: candidates })
        } else {
          fixed.push(...new Set(count > 0 ? candidates.slice(0, count) : candidates))
        }
        continue
      }
      fixed.push(BARE_DEFAULTS[main] ?? main)
      continue
    }

    // 4) 普通技能名 / 别名 / 裸名默认
    const key = resolveSkillKey(text)
    if (key) {
      fixed.push(key)
      continue
    }

    // 5) 认不出来 → 计为自由槽位（宁多勿漏，且不静默丢弃）
    freeSlots += count || 1
  }

  return { fixed: [...new Set(fixed)], choices, freeSlots }
}

function isSkillFamily(name: string): boolean {
  return SKILL_FAMILIES.includes(name)
}

/** 全部技能键（用于建卡界面与「技能成长」）。 */
export function allSkillKeys(): string[] {
  return Object.keys(SKILL_TABLE.skills)
}

/** 通用调查员技能，用作自由槽位的填充。 */
export function playerSkillPool(): string[] {
  return SKILL_TABLE.playerSkills.slice()
}

export { RULES }
