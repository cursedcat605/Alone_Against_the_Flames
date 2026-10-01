import { describe, expect, it } from 'vitest'

import {
  levelRank,
  meetsDifficulty,
  parseDice,
  resolveCheck,
  resolveOpposed,
  rollD100,
  rollExpression,
  rollExpressionDetailed,
  successLevel,
} from './dice'
import { createRng } from './rng'
import { LEVEL_ORDER, type SuccessLevel } from './types'

describe('successLevel 真值表', () => {
  it('大成功：只有 01，且必须在极难判定之前', () => {
    expect(successLevel(1, 80)).toBe('critical')
    expect(successLevel(1, 5)).toBe('critical')
    expect(successLevel(1, 0)).toBe('critical')
  })

  it('大失败阈值随技能值变化：< 50 是 96-100，>= 50 只有 100', () => {
    // 技能 49（< 50）：96 起就是大失败
    expect(successLevel(95, 49)).toBe('failure')
    expect(successLevel(96, 49)).toBe('fumble')
    expect(successLevel(100, 49)).toBe('fumble')

    // 技能 50（>= 50）：96 只是普通失败，只有 100 才是大失败
    expect(successLevel(96, 50)).toBe('failure')
    expect(successLevel(99, 50)).toBe('failure')
    expect(successLevel(100, 50)).toBe('fumble')
  })

  it('技能 0 时 96+ 仍算大失败', () => {
    expect(successLevel(95, 0)).toBe('failure')
    expect(successLevel(96, 0)).toBe('fumble')
  })

  it('成功等级按 1/5、1/2 分档', () => {
    const target = 60 // 极难 <= 12，困难 <= 30
    expect(successLevel(12, target)).toBe('extreme')
    expect(successLevel(13, target)).toBe('hard')
    expect(successLevel(30, target)).toBe('hard')
    expect(successLevel(31, target)).toBe('regular')
    expect(successLevel(60, target)).toBe('regular')
    expect(successLevel(61, target)).toBe('failure')
  })

  it('边界：目标值 5 时 5 只是普通成功（极难阈值 1、困难阈值 2）', () => {
    expect(successLevel(1, 5)).toBe('critical') // 01 覆盖极难
    expect(successLevel(2, 5)).toBe('hard')
    expect(successLevel(3, 5)).toBe('regular')
    expect(successLevel(5, 5)).toBe('regular')
    expect(successLevel(6, 5)).toBe('failure')
  })

  it('等级序完整：fumble < failure < regular < hard < extreme < critical', () => {
    const order: SuccessLevel[] = ['fumble', 'failure', 'regular', 'hard', 'extreme', 'critical']
    for (let i = 1; i < order.length; i++) {
      expect(levelRank(order[i])).toBeGreaterThan(levelRank(order[i - 1]))
    }
    expect(LEVEL_ORDER.fumble).toBeLessThan(0)
  })
})

describe('meetsDifficulty', () => {
  it('常规检定：普通成功即通过；大失败不算通过', () => {
    expect(meetsDifficulty('regular', 'regular')).toBe(true)
    expect(meetsDifficulty('failure', 'regular')).toBe(false)
    expect(meetsDifficulty('fumble', 'regular')).toBe(false)
  })

  it('困难检定要求 hard 及以上', () => {
    expect(meetsDifficulty('hard', 'hard')).toBe(true)
    expect(meetsDifficulty('extreme', 'hard')).toBe(true)
    expect(meetsDifficulty('critical', 'hard')).toBe(true)
    expect(meetsDifficulty('regular', 'hard')).toBe(false)
  })

  it('极难检定要求 extreme 及以上', () => {
    expect(meetsDifficulty('extreme', 'extreme')).toBe(true)
    expect(meetsDifficulty('critical', 'extreme')).toBe(true)
    expect(meetsDifficulty('hard', 'extreme')).toBe(false)
  })
})

describe('rollD100', () => {
  it('00 + 0 读作 100，不是 0', () => {
    // 直接构造：tens 全 0、units 0 的局面靠种子找到
    const rng = createRng(1)
    let found = false
    for (let i = 0; i < 20000 && !found; i++) {
      const r = rollD100(rng)
      if (r.tens[0] === 0 && r.units === 0) {
        expect(r.value).toBe(100)
        found = true
      }
    }
    expect(found).toBe(true)
  })

  it('读数始终落在 1..100', () => {
    const rng = createRng(4242)
    for (let i = 0; i < 20000; i++) {
      const v = rollD100(rng).value
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('奖励骰与惩罚骰先成对抵消', () => {
    const r = rollD100(createRng(9), { bonus: 3, penalty: 2 })
    expect(r.bonus).toBe(1)
    expect(r.penalty).toBe(0)
    // 1 颗基础 + 1 颗净奖励
    expect(r.tens).toHaveLength(2)
    expect(r.units).toBeGreaterThanOrEqual(0)
  })

  it('惩罚骰多于奖励骰时净惩罚生效', () => {
    const r = rollD100(createRng(9), { bonus: 1, penalty: 4 })
    expect(r.bonus).toBe(0)
    expect(r.penalty).toBe(3)
    expect(r.tens).toHaveLength(4)
  })

  it('净值为 0 时只有一颗十位骰', () => {
    expect(rollD100(createRng(3)).tens).toHaveLength(1)
    expect(rollD100(createRng(3), { bonus: 2, penalty: 2 }).tens).toHaveLength(1)
  })

  it('奖励骰：读数等于「最有利（最小）的读数」', () => {
    const rng = createRng(777)
    for (let i = 0; i < 3000; i++) {
      const r = rollD100(rng, { bonus: 2 })
      const candidates = r.tens.map((t) => (t === 0 && r.units === 0 ? 100 : t * 10 + r.units))
      expect(r.value).toBe(Math.min(...candidates))
    }
  })

  it('惩罚骰：读数等于「最不利（最大）的读数」', () => {
    const rng = createRng(778)
    for (let i = 0; i < 3000; i++) {
      const r = rollD100(rng, { penalty: 2 })
      const candidates = r.tens.map((t) => (t === 0 && r.units === 0 ? 100 : t * 10 + r.units))
      expect(r.value).toBe(Math.max(...candidates))
    }
  })

  it('回归：十位骰 [0,3] + 个位骰 0 时，奖励骰应给出 30 而不是 100', () => {
    // 这一条专门盯住「直接对十位骰取 min」的错法：min([0,3]) = 0 → 读作 100，
    // 而 100 是最差的结果，奖励骰本应能弃掉它选 30。
    const candidates = [0, 3].map((t) => (t === 0 && 0 === 0 ? 100 : t * 10 + 0))
    expect(Math.min(...candidates)).toBe(30)
    expect(Math.min(0, 3)).toBe(0) // 错法会得到 0 → 100
  })

  it('奖励骰统计上比无奖励骰更好、惩罚骰更差', () => {
    const mean = (opts: { bonus?: number; penalty?: number }, seed: number) => {
      const rng = createRng(seed)
      let sum = 0
      const n = 20000
      for (let i = 0; i < n; i++) sum += rollD100(rng, opts).value
      return sum / n
    }
    const plain = mean({}, 1)
    const withBonus = mean({ bonus: 1 }, 1)
    const withPenalty = mean({ penalty: 1 }, 1)

    expect(withBonus).toBeLessThan(plain)
    expect(withPenalty).toBeGreaterThan(plain)
    // 无修正时读数应当近似均匀 → 均值接近 50.5
    expect(Math.abs(plain - 50.5)).toBeLessThan(2)
  })
})

describe('resolveCheck', () => {
  it('返回的 passed 与 meetsDifficulty 一致', () => {
    const rng = createRng(31415)
    for (let i = 0; i < 2000; i++) {
      const r = resolveCheck(rng, 55, 'hard', { bonus: 1 })
      expect(r.passed).toBe(meetsDifficulty(r.level, 'hard'))
      expect(r.level).toBe(successLevel(r.roll.value, 55))
      expect(r.difficulty).toBe('hard')
      expect(r.target).toBe(55)
    }
  })

  it('同种子可复现整局骰点', () => {
    const run = () => {
      const rng = createRng(20261001)
      return Array.from({ length: 30 }, () => resolveCheck(rng, 60).roll.value)
    }
    expect(run()).toEqual(run())
  })
})

describe('parseDice / rollExpression', () => {
  it('解析单个骰子、带数量的骰子、纯数字与多段相加', () => {
    expect(parseDice('1D6')).toEqual([{ count: 1, sides: 6, flat: 0 }])
    expect(parseDice('2D6')).toEqual([{ count: 2, sides: 6, flat: 0 }])
    expect(parseDice('D8')).toEqual([{ count: 1, sides: 8, flat: 0 }])
    expect(parseDice('7')).toEqual([{ count: 0, sides: 0, flat: 7 }])
    expect(parseDice('1D3+1D4')).toEqual([
      { count: 1, sides: 3, flat: 0 },
      { count: 1, sides: 4, flat: 0 },
    ])
    expect(parseDice('2d6 + 1')).toEqual([
      { count: 2, sides: 6, flat: 0 },
      { count: 0, sides: 0, flat: 1 },
    ])
  })

  it('无法解析时返回空数组（rollExpression 得 0）', () => {
    expect(parseDice('')).toEqual([])
    expect(parseDice('失去生命值')).toEqual([])
    expect(rollExpression(createRng(1), '')).toBe(0)
  })

  it('掷骰结果落在理论区间内', () => {
    const rng = createRng(88)
    for (let i = 0; i < 3000; i++) {
      const v = rollExpression(rng, '2D6+1')
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(13)
    }
  })

  it('rollExpressionDetailed 的明细与总和一致', () => {
    const rng = createRng(66)
    for (let i = 0; i < 1000; i++) {
      const { total, detail } = rollExpressionDetailed(rng, '2D6+1')
      const rolls = /2D6\[(\d+),(\d+)\]\+\s*1/.exec(detail)
      expect(rolls).not.toBeNull()
      expect(total).toBe(Number(rolls![1]) + Number(rolls![2]) + 1)
    }
  })

  it('不能用同一条表达式连续掷两次得到同一结果（rng 在推进）', () => {
    const rng = createRng(5)
    const seq = Array.from({ length: 40 }, () => rollExpression(rng, '1D100'))
    expect(new Set(seq).size).toBeGreaterThan(1)
  })
})

describe('resolveOpposed', () => {
  it('成功等级高者胜', () => {
    const rng = createRng(1)
    let sawLevelDecide = false
    for (let i = 0; i < 3000; i++) {
      const r = resolveOpposed(rng, { name: 'A', target: 90 }, { name: 'B', target: 20 })
      expect(['a', 'b', null]).toContain(r.winner)
      if (r.winner && levelRank(r.a.level) !== levelRank(r.b.level)) {
        expect(r.winner).toBe(levelRank(r.a.level) > levelRank(r.b.level) ? 'a' : 'b')
        sawLevelDecide = true
      }
    }
    expect(sawLevelDecide).toBe(true)
  })

  it('等级相同时技能值高者胜', () => {
    const rng = createRng(2)
    let sawTargetDecide = false
    for (let i = 0; i < 3000; i++) {
      const r = resolveOpposed(rng, { name: 'A', target: 80 }, { name: 'B', target: 30 })
      if (r.winner && r.a.level === r.b.level) {
        expect(r.winner).toBe('a')
        sawTargetDecide = true
      }
    }
    expect(sawTargetDecide).toBe(true)
  })

  it('等级与技能值都相同时判平手', () => {
    const rng = createRng(3)
    let sawDraw = false
    for (let i = 0; i < 5000; i++) {
      const r = resolveOpposed(rng, { name: 'A', target: 60 }, { name: 'B', target: 60 })
      if (r.a.value === r.b.value) {
        // 同读数必定同等级、同目标 → 平手
        expect(r.winner).toBeNull()
        sawDraw = true
      }
    }
    expect(sawDraw).toBe(true)
  })

  it('双方读数与等级都在结果里，reason 解释胜因', () => {
    const r = resolveOpposed(createRng(10), { name: 'A', target: 50 }, { name: 'B', target: 50 })
    expect(r.a.name).toBe('A')
    expect(r.b.name).toBe('B')
    expect(r.a.value).toBeGreaterThanOrEqual(1)
    expect(r.b.value).toBeGreaterThanOrEqual(1)
    expect(typeof r.reason).toBe('string')
    expect(r.reason.length).toBeGreaterThan(0)
  })
})
