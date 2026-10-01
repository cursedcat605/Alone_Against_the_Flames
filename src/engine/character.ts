/**
 * 调查员：属性生成、年龄调整、衍生属性、技能表、伤害/理智结算。
 *
 * 所有随机都走传入的 RngState，因此「同一颗种子 + 同一个职业」永远得到同一张卡。
 * 这是自动通关测试能重放整局的前提。
 */

import { OCCUPATIONS, PREBUILT, RULES, occupationById, type AgeModifier, type Occupation } from './content'
import { pick, rollDie, shuffle, type RngState } from './rng'
import { rollD100 } from './dice'
import { ATTR_KEYS, type AttrKey, type Character, type SkillEntry } from './types'
import {
  allSkillKeys,
  normalizeName,
  playerSkillPool,
  resolveOccupationSkills,
  skillBaseValue,
  skillDef,
  skillLabel,
} from './names'

/** 随机骰点表达式的求值：支持 "3D6"、"2D6+6"，可选 "*N" 尾缀。 */
export function rollFormula(st: RngState, formula: string): number {
  const flat = formula.replace(/\s+/g, '')
  const mult = /^(.*?)\*(\d+)$/.exec(flat)
  if (mult) return rollExpr(st, mult[1].replace(/[()]/g, '')) * Number(mult[2])
  return rollExpr(st, flat.replace(/[()]/g, ''))
}

function rollExpr(st: RngState, expr: string): number {
  let total = 0
  for (const term of expr.split('+')) {
    const dice = /^(\d*)D(\d+)$/i.exec(term)
    if (dice) {
      const count = dice[1] ? Number(dice[1]) : 1
      const sides = Number(dice[2])
      for (let i = 0; i < count; i++) total += rollDie(st, sides)
    } else if (/^\d+$/.test(term)) {
      total += Number(term)
    }
  }
  return total
}

export function rollAttributes(st: RngState): Record<AttrKey, number> {
  const out = {} as Record<AttrKey, number>
  for (const def of RULES.attributes) {
    out[def.key] = rollFormula(st, def.formula)
  }
  return out
}

export function ageModifierFor(age: number): AgeModifier {
  return (
    RULES.ageModifiers.find((m) => age >= m.minAge && age <= m.maxAge) ??
    RULES.ageModifiers[RULES.ageModifiers.length - 1]
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 年龄调整。教育增强检定是 CoC 的经典设计：年纪大的人学识更高，
 * 但身体机能下降。掷出的结果 > 当前教育 → 教育 +1D10。
 */
export function applyAgeModifiers(
  st: RngState,
  attrs: Record<AttrKey, number>,
  age: number,
): { attrs: Record<AttrKey, number>; notes: string[] } {
  const mod = ageModifierFor(age)
  const out: Record<AttrKey, number> = { ...attrs }
  const notes: string[] = [mod.note]

  for (let i = 0; i < mod.eduChecks; i++) {
    const roll = rollD100(st).value
    const eduBefore = out.EDU
    if (roll > eduBefore) {
      const gain = rollDie(st, 10)
      out.EDU = clamp(out.EDU + gain, 0, 99)
      notes.push(`教育增强检定 ${roll} > ${eduBefore}，教育 +${gain} → ${out.EDU}`)
    } else {
      notes.push(`教育增强检定 ${roll} ≤ ${eduBefore}，无成长`)
    }
  }

  // 属性惩罚按「先扣体型/体质，再扣力量/敏捷/外貌」的顺序分摊，
  // 保证不会把某项扣到 0 以下。
  const drain = (keys: AttrKey[], total: number, label: string) => {
    let left = total
    for (const key of keys) {
      if (left <= 0) break
      const take = Math.min(left, Math.max(0, out[key] - 1))
      out[key] -= take
      left -= take
    }
    if (total > 0) notes.push(`${label} -${total - left}`)
  }

  if (mod.strSizPenalty) drain(['SIZ', 'STR'], mod.strSizPenalty, '力量与体型合计')
  if (mod.strConDexPenalty) drain(['CON', 'STR', 'DEX'], mod.strConDexPenalty, '力量/体质/敏捷合计')
  if (mod.appPenalty) drain(['APP'], mod.appPenalty, '外貌')

  return { attrs: out, notes }
}

export interface DerivedStats {
  hpMax: number
  mpMax: number
  sanMax: number
  mov: number
  db: string
  build: number
}

export function computeDerived(attrs: Record<AttrKey, number>, age: number): DerivedStats {
  const sum = attrs.STR + attrs.SIZ
  const row =
    RULES.buildTable.find((r) => sum >= r.minSum && sum <= r.maxSum) ??
    RULES.buildTable[RULES.buildTable.length - 1]

  // MOV 基础值：力量与敏捷都高于体型 → 9；其一高于 → 8；都不高于 → 7
  const strOver = attrs.STR > attrs.SIZ
  const dexOver = attrs.DEX > attrs.SIZ
  let mov = strOver && dexOver ? 9 : strOver || dexOver ? 8 : 7

  const ageRule = RULES.movRule.agePenalty.find((p) => age >= p.minAge)
  if (ageRule) mov -= ageRule.penalty

  // 体格修正：体格 ≥ 1 → +1；体格 ≤ -1 → -1
  if (row.build >= 1) mov += 1
  else if (row.build <= -1) mov -= 1

  return {
    hpMax: Math.floor((attrs.CON + attrs.SIZ) / 10),
    mpMax: Math.floor(attrs.POW / 5),
    sanMax: 99,
    mov: Math.max(1, mov),
    db: row.db,
    build: row.build,
  }
}

// --- 技能表 --------------------------------------------------------------

/** 用基础值建全表，再用 overrides 覆盖（预生成卡 / 建卡结果）。 */
export function buildSkillTable(
  attrs: Record<AttrKey, number>,
  overrides: Record<string, number> = {},
): Record<string, SkillEntry> {
  const out: Record<string, SkillEntry> = {}
  for (const key of allSkillKeys()) {
    out[key] = { name: key, value: skillBaseValue(key, attrs), ticked: false }
  }
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = normalizeName(rawKey)
    out[key] = { name: key, value, ticked: out[key]?.ticked ?? false }
  }
  return out
}

export interface CharacterInput {
  name: string
  age: number
  era: string
  occupationId: number
  occupationName: string
  attributes: Record<AttrKey, number>
  luck: number
  creditRating: number
  skills: Record<string, SkillEntry>
  inventory?: string[]
  background?: Record<string, string>
}

/** 统一入口：补全衍生值并把生命/理智/魔法夹到合法范围。 */
export function makeCharacter(input: CharacterInput): Character {
  const derived = computeDerived(input.attributes, input.age)
  const creditRating = clamp(input.creditRating, 0, 99)

  // 信用评级在角色卡上是独立字段，但剧本里它同时也是一次技能检定（条目 #99）。
  // 两处数值必须永远一致，否则同一个人会有两个信用评级。在这里归一到唯一来源，
  // 预建角色、随机建卡、以后的外部导入都走同一个入口，不会漏。
  const skills = { ...input.skills }
  const cr = skills['信用评级']
  if (cr) skills['信用评级'] = { ...cr, value: creditRating }

  return {
    name: input.name,
    age: input.age,
    era: input.era,
    occupationId: input.occupationId,
    occupationName: input.occupationName,
    attributes: { ...input.attributes },
    luck: clamp(input.luck, 0, 99),
    hp: derived.hpMax,
    hpMax: derived.hpMax,
    mp: derived.mpMax,
    mpMax: derived.mpMax,
    san: clamp(input.attributes.POW, 0, derived.sanMax),
    sanMax: derived.sanMax,
    mov: derived.mov,
    db: derived.db,
    build: derived.build,
    creditRating,
    skills,
    inventory: input.inventory ?? [],
    background: input.background ?? {},
    majorWound: false,
    unconscious: false,
    dying: false,
    tempInsane: false,
    indefInsane: false,
  }
}

/** 规则书里已完成建卡的示例调查员：夏洛特·范德米尔。 */
export function createPrebuiltCharacter(): Character {
  return makeCharacter({
    name: PREBUILT.name,
    age: PREBUILT.age,
    era: PREBUILT.era,
    occupationId: PREBUILT.occupationId,
    occupationName: PREBUILT.occupationName,
    attributes: { ...PREBUILT.attributes },
    luck: PREBUILT.luck,
    creditRating: PREBUILT.creditRating,
    skills: buildSkillTable(PREBUILT.attributes, PREBUILT.skills),
    inventory: [...PREBUILT.inventory],
  })
}

// --- 随机建卡 ------------------------------------------------------------

const NAME_POOL = [
  '夏洛特·范德米尔',
  '埃德加·怀特',
  '格蕾丝·霍洛威',
  '塞缪尔·凯恩',
  '伊迪丝·马什',
  '昆廷·布莱克',
  '萝丝玛丽·韦尔',
  '阿奇博尔德·芬奇',
]

const AGE_POOL = [22, 24, 26, 28, 30, 33, 36, 41, 46, 53, 61]

/** 把技能名列表规范化并过滤到技能表内。 */
export function normalizeSkillList(keys: string[]): string[] {
  const out: string[] = []
  for (const raw of keys) {
    const key = normalizeName(raw)
    if (skillDef(key)) out.push(key)
  }
  return [...new Set(out)]
}

/**
 * 平均分配点数。返回实际分配掉的点数。
 * 用「先分成等份再补余数」而不是 while 轮询，避免所有技能到顶时的死循环。
 * caps 用来给个别技能压上限（信用评级不得超出职业区间）。
 */
function distribute(
  skills: Record<string, SkillEntry>,
  keys: string[],
  points: number,
  caps: Record<string, number> = {},
): number {
  const usable = keys.filter((k) => skills[k])
  if (usable.length === 0 || points <= 0) return 0
  const capOf = (k: string) => Math.min(99, caps[k] ?? 99)
  const per = Math.floor(points / usable.length)
  let remaining = points
  for (const key of usable) {
    const take = Math.min(per, Math.max(0, capOf(key) - skills[key].value))
    skills[key].value += take
    remaining -= take
  }
  let i = 0
  let guard = points + usable.length
  while (remaining > 0 && guard-- > 0) {
    const key = usable[i % usable.length]
    if (skills[key].value < capOf(key)) {
      skills[key].value += 1
      remaining -= 1
    }
    i++
  }
  // 如果所有槽位都已到顶，剩下的点数只能退还给调用方 —— 不能硬塞到 99
  return points - remaining
}

export interface RandomOptions {
  age?: number
  occupationId?: number
  name?: string
}

/**
 * 随机建卡。
 *
 * M1 取舍：不做手动点数分配 UI，而是自动分配（职业点优先本职工与信用评级，
 * 兴趣点优先通用调查员技能）。手动分配留到 M2 —— 但内部的 `distribute` 已经是
 * 通用实现，M2 只需要把 UI 的加减连到同一个函数上。
 */
export function createRandomCharacter(st: RngState, opts: RandomOptions = {}): {
  character: Character
  notes: string[]
} {
  const notes: string[] = []

  const age = opts.age ?? pick(st, AGE_POOL) ?? 28
  const rolled = rollAttributes(st)
  notes.push(`掷属性：${ATTR_KEYS.map((k) => `${k}${rolled[k]}`).join(' ')}`)

  const { attrs, notes: ageNotes } = applyAgeModifiers(st, rolled, age)
  notes.push(...ageNotes)

  // 幸运：按年龄掷 1 或 2 次取较好值
  const mod = ageModifierFor(age)
  let luck = 0
  for (let i = 0; i < Math.max(1, mod.luckRolls); i++) {
    luck = Math.max(luck, rollFormula(st, '3D6*5'))
  }
  notes.push(`幸运 ${luck}`)

  const occ = opts.occupationId
    ? occupationById(opts.occupationId)
    : pick(st, allOccupations())

  const skills = buildSkillTable(attrs)

  if (!occ) {
    notes.push('没有可用职业模板，跳过技能分配')
    return {
      character: finalize(name(st, opts), age, occ, attrs, luck, 0, skills),
      notes,
    }
  }

  const resolved = resolveOccupationSkills(occ.occupationSkills)

  // 「两项社交技能（魅惑、话术、恐吓、说服）」是四选二，不是四项全给。
  const chosen: string[] = []
  for (const choice of resolved.choices) {
    const picked = shuffle(st, choice.from).slice(0, choice.count)
    chosen.push(...picked)
    notes.push(`本职选择：从 ${choice.from.join('、')} 中选 ${choice.count} → ${picked.join('、')}`)
  }

  const freePicks = shuffle(st, playerSkillPool()).slice(0, resolved.freeSlots)
  const occupationKeys = normalizeSkillList([...resolved.fixed, ...chosen, ...freePicks])
  notes.push(
    `职业 ${occ.name}（CR ${occ.creditRating.min}-${occ.creditRating.max}）` +
      `｜本职技能解析：${occupationKeys.join('、') || '（无）'}` +
      `｜自由槽位 ${resolved.freeSlots} → ${freePicks.join('、') || '（无）'}`,
  )

  // 信用评级必须先落到 CR 区间：这是规则要求，也是「职业点花在哪儿」的第一顺位
  let occPoints = occ.skillPoints
  const targetCredit = clamp(occ.creditRating.min + 5, occ.creditRating.min, occ.creditRating.max)
  const creditGain = Math.max(0, Math.min(targetCredit - skills['信用评级'].value, occPoints))
  skills['信用评级'].value += creditGain
  occPoints -= creditGain

  // 剩下的职业点：本职工 + 信用评级（信用评级不得超过职业区间上限）
  const occSpendKeys = [...new Set(['信用评级', ...occupationKeys])]
  const spentOcc = distribute(skills, occSpendKeys, occPoints, { 信用评级: occ.creditRating.max })

  // 兴趣点：通用调查员技能里挑 6 项
  const interestKeys = shuffle(st, playerSkillPool()).slice(0, 6)
  const interestPoints = attrs.INT * 2
  const spentInt = distribute(skills, interestKeys, interestPoints)

  for (const key of Object.keys(skills)) {
    skills[key].ticked = false
  }

  notes.push(
    `职业点 ${occ.skillPoints}（信用评级 ${creditGain} + 技能 ${spentOcc}）` +
      `｜兴趣点 ${interestPoints} 分配 ${spentInt} 到 ${interestKeys.join('、')}`,
  )

  return {
    character: finalize(name(st, opts), age, occ, attrs, luck, skills['信用评级'].value, skills),
    notes,
  }
}

function name(st: RngState, opts: RandomOptions): string {
  return opts.name ?? pick(st, NAME_POOL) ?? '无名调查员'
}

/** 序号 0 是「自定义职业」，不参与随机。 */
function allOccupations(): Occupation[] {
  return OCCUPATIONS.occupations.filter((o) => o.id > 0)
}

function finalize(
  charName: string,
  age: number,
  occ: Occupation | undefined,
  attrs: Record<AttrKey, number>,
  luck: number,
  creditRating: number,
  skills: Record<string, SkillEntry>,
): Character {
  return makeCharacter({
    name: charName,
    age,
    era: RULES.eraList[0],
    occupationId: occ?.id ?? -1,
    occupationName: occ?.name ?? '无职业',
    attributes: attrs,
    luck,
    creditRating,
    skills,
  })
}

// --- 结算 ----------------------------------------------------------------

export interface VitalChange {
  hp?: number
  san?: number
  mp?: number
  luck?: number
}

export interface VitalResult {
  char: Character
  notes: string[]
  died: boolean
}

/**
 * 应用生命/理智/魔法/幸运的变化，并更新重伤/昏迷/濒死/疯狂标记。
 *
 * 状态判定依据 rules.json 的 quickRules：
 *   - 一次受到 ≥ 最大生命值一半的伤害 → 重伤
 *   - 生命值 = 0 且未重伤 → 昏迷
 *   - 生命值 = 0 且重伤 → 濒死
 */
export function applyVitals(char: Character, change: VitalChange): VitalResult {
  const next: Character = { ...char }
  const notes: string[] = []
  let died = false

  if (change.hp) {
    const before = next.hp
    next.hp = clamp(next.hp + change.hp, 0, next.hpMax)
    const lost = before - next.hp
    if (lost > 0) {
      notes.push(`生命值 -${lost}（${before} → ${next.hp}）`)
      if (lost >= Math.ceil(next.hpMax / 2)) {
        next.majorWound = true
        notes.push('受到重伤！')
      }
    } else if (lost < 0) {
      notes.push(`生命值 +${-lost}（${before} → ${next.hp}）`)
    }
    if (next.hp === 0) {
      if (next.majorWound) {
        next.dying = true
        notes.push('生命值归零且重伤 → 濒死')
      } else {
        next.unconscious = true
        notes.push('生命值归零 → 昏迷')
      }
    } else {
      next.dying = false
      next.unconscious = false
    }
  }

  if (change.san) {
    const before = next.san
    next.san = clamp(next.san + change.san, 0, next.sanMax)
    const lost = before - next.san
    if (lost > 0) {
      notes.push(`理智值 -${lost}（${before} → ${next.san}）`)
      if (lost >= 5) {
        next.tempInsane = true
        notes.push('单次失去 5 点以上理智 → 临时性疯狂')
      }
      if (lost >= Math.ceil(before / 5)) {
        next.indefInsane = true
        notes.push('单次失去当日理智的 1/5 以上 → 不定性疯狂')
      }
    } else if (lost < 0) {
      notes.push(`理智值 +${-lost}（${before} → ${next.san}）`)
    }
    if (next.san === 0) {
      next.indefInsane = true
      notes.push('理智值归零 → 永久疯狂')
    }
  }

  if (change.mp) {
    next.mp = clamp(next.mp + change.mp, 0, next.mpMax)
    notes.push(`魔法值 ${change.mp > 0 ? '+' : ''}${change.mp} → ${next.mp}`)
  }

  if (change.luck) {
    next.luck = clamp(next.luck + change.luck, 0, 99)
    notes.push(`幸运 ${change.luck > 0 ? '+' : ''}${change.luck} → ${next.luck}`)
  }

  // 「死亡」= 这次变化把你推进了濒死（生命值归零 + 重伤）。
  // M1 不做急救/体质检定，濒死直接当结局，所以这里就是死亡判定。
  // 必须用 `!char.dying` 取「刚刚发生」的那一刻，否则每次结算都会重复报死。
  if (next.dying && !char.dying) died = true

  return { char: next, notes, died }
}

/** 技能打勾所在的小方框（技能成长机会）。 */
export function tickSkill(char: Character, rawName: string): { char: Character; note: string } {
  const key = normalizeName(rawName)
  const entry = char.skills[key]
  if (!entry) {
    return { char, note: `「${rawName}」不在技能表中，打勾被忽略（内容缺口）` }
  }
  if (entry.ticked) {
    return { char, note: `「${skillLabel(entry.name)}」已打勾，忽略重复标记` }
  }
  const skills = { ...char.skills, [key]: { ...entry, ticked: true } }
  return { char: { ...char, skills }, note: `「${skillLabel(entry.name)}」打勾（本局结束时可成长）` }
}

/** 技能成长：已打勾的技能各掷一次，掷出的结果 > 当前值则 +1D10。 */
export function growTickedSkills(st: RngState, char: Character): { char: Character; notes: string[] } {
  const skills = { ...char.skills }
  const notes: string[] = []
  for (const [key, entry] of Object.entries(skills)) {
    if (!entry.ticked) continue
    const roll = rollD100(st).value
    if (roll > entry.value) {
      const gain = rollDie(st, 10)
      const value = clamp(entry.value + gain, 0, 99)
      skills[key] = { ...entry, value, ticked: false }
      notes.push(`「${skillLabel(entry.name)}」成长：${roll} > ${entry.value} → +${gain} = ${value}`)
    } else {
      skills[key] = { ...entry, ticked: false }
      notes.push(`「${skillLabel(entry.name)}」成长失败：${roll} ≤ ${entry.value}`)
    }
  }
  return { char: { ...char, skills }, notes }
}

/** 供 UI 显示：属性的困难/极难阈值等。 */
export function attributeSummary(char: Character): { key: AttrKey; label: string; value: number }[] {
  return ATTR_KEYS.map((key) => ({
    key,
    label: RULES.attributes.find((a) => a.key === key)?.label ?? key,
    value: char.attributes[key],
  }))
}
