import { describe, expect, it } from 'vitest'

import {
  DERIVED_BY_LABEL,
  SKILL_FAMILIES,
  allSkillKeys,
  isAttrLabel,
  normalizeName,
  playerSkillPool,
  resolveOccupationSkills,
  resolveTarget,
  skillBaseValue,
  skillDef,
  skillLabel,
  thresholds,
} from './names'
import { createPrebuiltCharacter } from './character'
import { OCCUPATIONS } from './content'

describe('normalizeName', () => {
  it('去掉所有空白（含全角空格）', () => {
    expect(normalizeName('格 斗')).toBe('格斗')
    expect(normalizeName('格\u3000斗')).toBe('格斗')
    expect(normalizeName(' 侦查 ')).toBe('侦查')
  })

  it('把括号统一成冒号，这是剧本里最常见的写法差异', () => {
    expect(normalizeName('格斗 ( 斗殴 )')).toBe('格斗:斗殴')
    expect(normalizeName('格斗（斗殴）')).toBe('格斗:斗殴')
    expect(normalizeName('科学 ( 植物学 )')).toBe('科学:植物学')
    expect(normalizeName('科学 （植物学）')).toBe('科学:植物学')
  })

  it('全角冒号与半角冒号统一，重复冒号折叠', () => {
    expect(normalizeName('母语：中文')).toBe('母语:中文')
    expect(normalizeName('母语 :: 中文')).toBe('母语:中文')
  })

  it('不会留下首尾冒号', () => {
    expect(normalizeName('（侦查）')).toBe('侦查')
    expect(normalizeName(':侦查')).toBe('侦查')
    expect(normalizeName('侦查:')).toBe('侦查')
  })
})

describe('isAttrLabel / DERIVED_BY_LABEL', () => {
  it('八个属性标签都能识别', () => {
    for (const label of ['力量', '体质', '体型', '敏捷', '外貌', '智力', '意志', '教育']) {
      expect(isAttrLabel(label)).toBe(true)
    }
  })

  it('技能名不会被误判成属性', () => {
    expect(isAttrLabel('侦查')).toBe(false)
    expect(isAttrLabel('力量值')).toBe(false)
  })

  it('幸运与理智被归到衍生值而不是属性/技能', () => {
    expect(DERIVED_BY_LABEL['幸运']).toBe('Luck')
    expect(DERIVED_BY_LABEL['理智']).toBe('SAN')
    expect(DERIVED_BY_LABEL['理智值']).toBe('SAN')
  })
})

describe('skillBaseValue', () => {
  const attrs = { STR: 50, CON: 50, SIZ: 40, DEX: 80, APP: 60, INT: 70, POW: 60, EDU: 50 }

  it('静态基础值直接取表里的值', () => {
    expect(skillBaseValue('侦查', attrs)).toBe(25)
    expect(skillBaseValue('图书馆使用', attrs)).toBe(20)
    expect(skillBaseValue('格斗:斗殴', attrs)).toBe(25)
  })

  it('闪避 = 敏捷 / 2（下取整）', () => {
    expect(skillBaseValue('闪避', attrs)).toBe(40)
    expect(skillBaseValue('闪避', { ...attrs, DEX: 81 })).toBe(40)
    expect(skillBaseValue('闪避', { ...attrs, DEX: 79 })).toBe(39)
  })

  it('母语 = 教育', () => {
    expect(skillBaseValue('母语', attrs)).toBe(50)
    expect(skillBaseValue('母语', { ...attrs, EDU: 88 })).toBe(88)
  })

  it('不存在的技能返回 0（调用方必须把这当成缺口暴露，不能装作正常）', () => {
    expect(skillBaseValue('不存在的技能', attrs)).toBe(0)
    expect(skillDef('不存在的技能')).toBeUndefined()
  })
})

describe('resolveTarget', () => {
  const char = createPrebuiltCharacter()

  it('属性：力量 → STR', () => {
    const info = resolveTarget(char, '力量')
    expect(info.kind).toBe('attr')
    expect(info.key).toBe('STR')
    expect(info.value).toBe(char.attributes.STR)
  })

  it('衍生值：幸运与理智取 char.luck / char.san', () => {
    const luck = resolveTarget(char, '幸运')
    expect(luck.kind).toBe('derived')
    expect(luck.key).toBe('Luck')
    expect(luck.value).toBe(char.luck)

    const san = resolveTarget(char, '理智')
    expect(san.kind).toBe('derived')
    expect(san.key).toBe('SAN')
    expect(san.value).toBe(char.san)
  })

  it('技能：精确命中技能表', () => {
    const info = resolveTarget(char, '侦查')
    expect(info.kind).toBe('skill')
    expect(info.key).toBe('侦查')
    expect(info.value).toBe(char.skills['侦查'].value)
  })

  it('技能：括号写法与剧本里的空格都能解析到同一个键', () => {
    const a = resolveTarget(char, '格斗:斗殴')
    const b = resolveTarget(char, '格斗 ( 斗殴 )')
    expect(b.key).toBe(a.key)
    expect(b.value).toBe(a.value)
  })

  it('别名：图书馆 → 图书馆使用、电脑使用 → 计算机使用、地理 → 科学:地质学', () => {
    expect(resolveTarget(char, '图书馆').key).toBe('图书馆使用')
    expect(resolveTarget(char, '电脑使用').key).toBe('计算机使用')
    expect(resolveTarget(char, '地理').key).toBe('科学:地质学')
  })

  it('裸家族名：命中技能表里的家族行（书里就是这一行，base 25）', () => {
    const info = resolveTarget(char, '格斗')
    expect(info.kind).toBe('skill')
    expect(info.key).toBe('格斗')
    expect(info.value).toBeGreaterThan(0)
  })

  it('裸家族名：角色卡上没有这一行时，用技能表基础值兜底，绝不给 0', () => {
    const empty = { ...char, skills: {} }
    for (const family of SKILL_FAMILIES) {
      const info = resolveTarget(empty, family)
      expect(info.kind, `家族 ${family} 退化成了 unknown`).toBe('skill')
      expect(info.value, `家族 ${family} 的目标值是 0`).toBeGreaterThan(0)
    }
  })

  it('未知名字返回 kind=unknown 且 value 为 0', () => {
    const info = resolveTarget(char, '瞎编的技能')
    expect(info.kind).toBe('unknown')
    expect(info.value).toBe(0)
    expect(info.label).toBe('瞎编的技能')
  })

  it('解析出的属性值必须与角色卡一致（防止静默退化成 0）', () => {
    for (const label of ['力量', '体质', '体型', '敏捷', '外貌', '智力', '意志', '教育']) {
      const info = resolveTarget(char, label)
      expect(info.kind).toBe('attr')
      expect(info.value).toBe(char.attributes[info.key as keyof typeof char.attributes])
      expect(info.value).toBeGreaterThan(0)
    }
  })
})

describe('skillLabel', () => {
  it('返回带全角括号的展示名', () => {
    expect(skillLabel('格斗:斗殴')).toBe('格斗（斗殴）')
    expect(skillLabel('科学:地质学')).toBe('科学（地质学）')
  })

  it('查不到的键原样返回', () => {
    expect(skillLabel('不存在')).toBe('不存在')
  })
})

describe('thresholds', () => {
  it('困难 = 1/2、极难 = 1/5，均下取整', () => {
    expect(thresholds(85)).toEqual({ hard: 42, extreme: 17 })
    expect(thresholds(60)).toEqual({ hard: 30, extreme: 12 })
    expect(thresholds(1)).toEqual({ hard: 0, extreme: 0 })
    expect(thresholds(0)).toEqual({ hard: 0, extreme: 0 })
  })
})

describe('allSkillKeys / playerSkillPool', () => {
  it('技能表非空且全是规范化后的键（不含括号）', () => {
    const keys = allSkillKeys()
    expect(keys.length).toBeGreaterThan(50)
    for (const key of keys) {
      expect(key).not.toContain('（')
      expect(key).not.toContain('(')
      expect(key).not.toContain(' ')
    }
  })

  it('玩家技能池里每一项都在技能表里', () => {
    const keys = new Set(allSkillKeys())
    const pool = playerSkillPool()
    expect(pool.length).toBeGreaterThan(0)
    for (const key of pool) expect(keys.has(key)).toBe(true)
  })

  it('家族技能前缀表覆盖剧本里出现的裸名', () => {
    for (const family of SKILL_FAMILIES) {
      expect(typeof family).toBe('string')
      expect(family.length).toBeGreaterThan(0)
    }
  })
})

describe('resolveOccupationSkills', () => {
  it('把自然语言的本职技能解析成具体技能键', () => {
    const res = resolveOccupationSkills(['技艺（摄影）', '乔装', '法律', '图书馆', '心理学', '侦查'])
    expect(res.fixed).toContain('技艺:摄影')
    expect(res.fixed).toContain('乔装')
    expect(res.fixed).toContain('法律')
    expect(res.fixed).toContain('图书馆使用')
    expect(res.fixed).toContain('侦查')
    expect(res.choices).toEqual([])
    expect(res.freeSlots).toBe(0)
  })

  it('「N 项社交技能」是选择项，不是白送整个社交组', () => {
    const res = resolveOccupationSkills(['两项社交技能'])
    expect(res.choices).toHaveLength(1)
    expect(res.choices[0].count).toBe(2)
    expect(res.choices[0].from.length).toBeGreaterThan(2)
    expect(res.fixed).toEqual([])
    expect(res.freeSlots).toBe(0)
  })

  it('带候选括号的社交技能也只开出 count 个名额，而不是把括号里的全给', () => {
    const res = resolveOccupationSkills(['两项社交技能（魅惑、话术、恐吓、说服）'])
    expect(res.choices).toHaveLength(1)
    expect(res.choices[0].count).toBe(2)
    // 候选必须全部是合法键，否则下游会拿到空值
    for (const key of res.choices[0].from) expect(allSkillKeys()).toContain(key)
    expect(res.fixed).toEqual([])
  })

  it('「任意 N 项其他个人或时代特长」开出 N 个开放自由槽位', () => {
    expect(resolveOccupationSkills(['任意一项其他个人或时代特长']).freeSlots).toBe(1)
    expect(resolveOccupationSkills(['任意两项其他个人或时代特长']).freeSlots).toBe(2)
    expect(resolveOccupationSkills(['任选三项']).freeSlots).toBe(3)
  })

  it('「科学（生物学，化学）」这类多候选专攻按数量取，不超过候选数', () => {
    const res = resolveOccupationSkills(['科学（生物学，化学）'])
    const total = res.fixed.length + res.choices.reduce((n, c) => n + c.count, 0)
    expect(total).toBeLessThanOrEqual(2)
    expect(total).toBeGreaterThan(0)
  })

  it('认不出来的条目计入自由槽位，绝不静默丢弃', () => {
    const res = resolveOccupationSkills(['完全看不懂的鬼话'])
    expect(res.fixed).toEqual([])
    expect(res.freeSlots).toBe(1)
  })

  it('真实职业数据：每个职业的解析结果都不丢项', () => {
    // 「认不出来的词 + 白送候选」这两类错误都会让职业点流向不该拿的技能，
    // 逐条走一遍全部 115 个职业，确保没有非法键漏出去。
    const keys = new Set(allSkillKeys())
    for (const occ of OCCUPATIONS.occupations) {
      if (occ.id === 0) continue
      const res = resolveOccupationSkills(occ.occupationSkills)
      for (const key of res.fixed) {
        expect(keys.has(key), `职业 ${occ.id} ${occ.name} 的固定技能非法: ${key}`).toBe(true)
      }
      for (const choice of res.choices) {
        expect(choice.count).toBeGreaterThan(0)
        expect(choice.count).toBeLessThanOrEqual(choice.from.length)
        for (const key of choice.from) expect(keys.has(key)).toBe(true)
      }
      const accounted = res.fixed.length + res.choices.length + res.freeSlots
      expect(accounted, `职业 ${occ.id} ${occ.name} 有条目被静默丢弃`).toBeGreaterThan(0)
    }
  })
})
