/**
 * CoC 7e 的骰子：D100 检定（含奖励/惩罚骰）、成功等级、骰点表达式、对抗检定。
 *
 * D100 的规则细节容易写错，这里单独成一个模块并配测试：
 *   - 骰子读法是「十位骰 + 个位骰」，不是 1..100 的均匀随机。
 *     因此 00/0 读作 100，而不是 0。
 *   - 奖励骰 = 多掷几颗十位骰，取**最小**；惩罚骰取**最大**。
 *     点骰（个位骰）永远只有一颗。
 *   - 大失败阈值随技能值变化：技能 < 50 时 96-100，否则只有 100。
 */

import { nextInt, rollDie, type RngState } from './rng'
import {
  DIFFICULTY_MIN_LEVEL,
  LEVEL_ORDER,
  LEVEL_LABELS,
  type Difficulty,
  type SuccessLevel,
} from './types'

export interface D100Result {
  /** 每一颗十位骰的点数（0-9） */
  tens: number[]
  /** 个位骰点数（0-9，0 表示 '0'） */
  units: number
  /** 最终读数 1-100 */
  value: number
  bonus: number
  penalty: number
}

/**
 * 掷一次 D100。
 * bonus / penalty 会先互相抵消（每抵消一对，净奖励/惩罚减 1），
 * 这是 CoC 7e 的官方处理方式。
 */
export function rollD100(rng: RngState, opts: { bonus?: number; penalty?: number } = {}): D100Result {
  // 奖励骰与惩罚骰成对抵消
  const net = (opts.bonus ?? 0) - (opts.penalty ?? 0)
  const bonus = Math.max(0, net)
  const penalty = Math.max(0, -net)

  // 十位骰：1 颗基础 + 抵消后剩余的奖励/惩罚骰
  const tens: number[] = [nextInt(rng, 10)]
  for (let i = 0; i < bonus + penalty; i++) tens.push(nextInt(rng, 10))
  const units = nextInt(rng, 10)

  // 先把每颗十位骰换算成**读数**再取极值，不能直接对十位骰取 min/max。
  // 反例：十位骰 [0, 3] + 个位骰 0。直接取 min 得到 0，读作 100 —— 这恰恰是
  // 最差的结果，而奖励骰本应允许你选 30。官方写法是「取最有利的那个读数」，
  // 所以必须先在读数域上比较（00+0 = 100 是这个域里的最大值）。
  const values = tens.map((t) => (t === 0 && units === 0 ? 100 : t * 10 + units))
  let value = values[0]
  if (bonus > 0) value = Math.min(...values)
  else if (penalty > 0) value = Math.max(...values)

  return { tens, units, value, bonus, penalty }
}

/** 判定成功等级。 */
export function successLevel(roll: number, target: number): SuccessLevel {
  // 大失败阈值：技能 < 50 → 96-100；技能 ≥ 50 → 只有 100。
  // （表里写的「大失败 0/96+」中的 0 指技能值为 0 的特例，同样落进 >= 96 分支。）
  const fumbleAt = target < 50 ? 96 : 100
  if (roll >= fumbleAt) return 'fumble'

  // 注意顺序：01 既是「大成功」也满足 ≤ 技能/5，必须先判。
  if (roll === 1) return 'critical'

  if (roll > target) return 'failure'
  if (roll <= Math.floor(target / 5)) return 'extreme'
  if (roll <= Math.floor(target / 2)) return 'hard'
  return 'regular'
}

export function levelRank(level: SuccessLevel): number {
  return LEVEL_ORDER[level]
}

export function levelLabel(level: SuccessLevel): string {
  return LEVEL_LABELS[level]
}

/** 是否达到要求的难度（困难/极难检定）。 */
export function meetsDifficulty(level: SuccessLevel, difficulty: Difficulty): boolean {
  return levelRank(level) >= levelRank(DIFFICULTY_MIN_LEVEL[difficulty])
}

export interface CheckResolution {
  roll: D100Result
  level: SuccessLevel
  difficulty: Difficulty
  target: number
  /** 通过该难度检定 */
  passed: boolean
}

/** 掷一次检定并判定。 */
export function resolveCheck(
  rng: RngState,
  target: number,
  difficulty: Difficulty = 'regular',
  opts: { bonus?: number; penalty?: number } = {},
): CheckResolution {
  const roll = rollD100(rng, opts)
  const level = successLevel(roll.value, target)
  return { roll, level, difficulty, target, passed: meetsDifficulty(level, difficulty) }
}

// --- 骰点表达式 ----------------------------------------------------------

export interface DiceSpec {
  count: number
  sides: number
  flat: number
}

/** 解析 "2D6"、"1D3+1D4"、"1D6+1"、"7" 这类表达式。 */
export function parseDice(expr: string): DiceSpec[] {
  const specs: DiceSpec[] = []
  const cleaned = expr.replace(/\s+/g, '').toUpperCase()
  if (!cleaned) return specs
  for (const term of cleaned.split('+')) {
    if (!term) continue
    const dice = /^(\d*)D(\d+)$/.exec(term)
    if (dice) {
      specs.push({ count: dice[1] ? Number(dice[1]) : 1, sides: Number(dice[2]), flat: 0 })
      continue
    }
    if (/^\d+$/.test(term)) {
      specs.push({ count: 0, sides: 0, flat: Number(term) })
    }
  }
  return specs
}

/** 掷一个骰点表达式，返回总和。无法解析时返回 0（并由调用方决定怎么提示）。 */
export function rollExpression(rng: RngState, expr: string): number {
  let total = 0
  for (const spec of parseDice(expr)) {
    for (let i = 0; i < spec.count; i++) total += rollDie(rng, spec.sides)
    total += spec.flat
  }
  return total
}

/** 带明细的掷骰，供日志展示。 */
export function rollExpressionDetailed(
  rng: RngState,
  expr: string,
): { total: number; detail: string } {
  const parts: string[] = []
  let total = 0
  for (const spec of parseDice(expr)) {
    if (spec.count > 0) {
      const rolls: number[] = []
      for (let i = 0; i < spec.count; i++) {
        const r = rollDie(rng, spec.sides)
        rolls.push(r)
        total += r
      }
      parts.push(`${spec.count}D${spec.sides}[${rolls.join(',')}]`)
    } else {
      total += spec.flat
      parts.push(String(spec.flat))
    }
  }
  return { total, detail: parts.join('+') }
}

// --- 对抗检定 ------------------------------------------------------------

export interface OpposedSide {
  name: string
  target: number
  level: SuccessLevel
  value: number
}

export interface OpposedResult {
  a: OpposedSide
  b: OpposedSide
  /** 'a' / 'b' / null（完全平手） */
  winner: 'a' | 'b' | null
  reason: string
}

/**
 * 对抗检定：双方各掷 D100，成功等级高者胜；
 * 等级相同则技能值高者胜；两者都相同视为平手（由剧情决定如何继续）。
 */
export function resolveOpposed(
  rng: RngState,
  a: { name: string; target: number; bonus?: number; penalty?: number },
  b: { name: string; target: number; bonus?: number; penalty?: number },
): OpposedResult {
  const ra = rollD100(rng, { bonus: a.bonus, penalty: a.penalty })
  const rb = rollD100(rng, { bonus: b.bonus, penalty: b.penalty })
  const la = successLevel(ra.value, a.target)
  const lb = successLevel(rb.value, b.target)

  const sideA: OpposedSide = { name: a.name, target: a.target, level: la, value: ra.value }
  const sideB: OpposedSide = { name: b.name, target: b.target, level: lb, value: rb.value }

  const ra_ = levelRank(la)
  const rb_ = levelRank(lb)

  if (ra_ > rb_) return { a: sideA, b: sideB, winner: 'a', reason: '成功等级更高' }
  if (rb_ > ra_) return { a: sideA, b: sideB, winner: 'b', reason: '成功等级更高' }
  if (ra_ <= 0) return { a: sideA, b: sideB, winner: null, reason: '双方均未成功' }
  if (a.target > b.target) return { a: sideA, b: sideB, winner: 'a', reason: '等级相同，技能值更高' }
  if (b.target > a.target) return { a: sideA, b: sideB, winner: 'b', reason: '等级相同，技能值更高' }
  return { a: sideA, b: sideB, winner: null, reason: '等级与技能值均相同' }
}
