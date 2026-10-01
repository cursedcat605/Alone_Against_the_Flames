import { describe, expect, it } from 'vitest'

import { createRng, nextFloat, nextInt, pick, rollDie, shuffle } from './rng'

describe('mulberry32', () => {
  it('同一个种子给出完全相同的序列', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 20 }, () => nextFloat(a))
    const seqB = Array.from({ length: 20 }, () => nextFloat(b))
    expect(seqA).toEqual(seqB)
  })

  it('不同种子给出不同序列', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(Array.from({ length: 10 }, () => nextFloat(a))).not.toEqual(
      Array.from({ length: 10 }, () => nextFloat(b)),
    )
  })

  it('种子 0 被替换成 1（否则 mulberry32 会退化成常量序列）', () => {
    expect(createRng(0).s).toBe(1)
    const zero = createRng(0)
    const one = createRng(1)
    expect(Array.from({ length: 10 }, () => nextFloat(zero))).toEqual(
      Array.from({ length: 10 }, () => nextFloat(one)),
    )
  })

  it('负数与超 32 位的种子被规约到 uint32', () => {
    expect(createRng(-1).s).toBe(4294967295)
    // 2^33 mod 2^32 = 0 → 触发 0 → 1 的替换
    expect(createRng(2 ** 33).s).toBe(1)
    expect(createRng(2 ** 32 + 7).s).toBe(7)
  })

  it('nextFloat 落在 [0, 1)', () => {
    const rng = createRng(99)
    for (let i = 0; i < 5000; i++) {
      const v = nextFloat(rng)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('nextInt 覆盖 0..max-1 且不越界', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 3000; i++) {
      const v = nextInt(rng, 6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('nextInt(0) 返回 0 而不是 NaN', () => {
    expect(nextInt(createRng(3), 0)).toBe(0)
    expect(nextInt(createRng(3), -5)).toBe(0)
  })

  it('rollDie(6) 落在 1..6 且六个面都出现过', () => {
    const rng = createRng(2024)
    const seen = new Set<number>()
    for (let i = 0; i < 3000; i++) {
      const v = rollDie(rng, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      seen.add(v)
    }
    expect(seen.size).toBe(6)
  })

  it('pick 空数组返回 undefined，否则总是取到合法元素', () => {
    const rng = createRng(11)
    expect(pick(rng, [])).toBeUndefined()
    const items = ['a', 'b', 'c']
    for (let i = 0; i < 200; i++) {
      expect(items).toContain(pick(rng, items))
    }
  })

  it('shuffle 是排列：不丢元素、不改原数组、同种子可复现', () => {
    const items = Array.from({ length: 30 }, (_, i) => i)
    const rng = createRng(55)
    const out = shuffle(rng, items)
    expect(out).toHaveLength(items.length)
    expect([...out].sort((a, b) => a - b)).toEqual(items)
    expect(items).toEqual(Array.from({ length: 30 }, (_, i) => i))

    const again = shuffle(createRng(55), items)
    expect(again).toEqual(out)
  })
})
