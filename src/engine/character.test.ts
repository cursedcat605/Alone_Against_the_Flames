import { describe, expect, it } from 'vitest'

import {
  ageModifierFor,
  applyAgeModifiers,
  applyVitals,
  attributeSummary,
  buildSkillTable,
  computeDerived,
  createPrebuiltCharacter,
  createRandomCharacter,
  growTickedSkills,
  normalizeSkillList,
  rollAttributes,
  tickSkill,
} from './character'
import { OCCUPATIONS, PREBUILT, RULES } from './content'
import { skillBaseValue } from './names'
import { createRng } from './rng'
import { ATTR_KEYS, type AttrKey, type Character } from './types'

const base: Record<AttrKey, number> = {
  STR: 50,
  CON: 50,
  SIZ: 40,
  DEX: 80,
  APP: 60,
  INT: 70,
  POW: 60,
  EDU: 50,
}

describe('computeDerived', () => {
  it('生命值 = (体质 + 体型) / 10 下取整', () => {
    expect(computeDerived(base, 28).hpMax).toBe(9)
    expect(computeDerived({ ...base, CON: 33 }, 28).hpMax).toBe(7)
    expect(computeDerived({ ...base, CON: 20, SIZ: 25 }, 28).hpMax).toBe(4)
  })

  it('魔法值 = 意志 / 5 下取整', () => {
    expect(computeDerived(base, 28).mpMax).toBe(12)
    expect(computeDerived({ ...base, POW: 4 }, 28).mpMax).toBe(0)
  })

  it('理智上限固定 99', () => {
    expect(computeDerived(base, 28).sanMax).toBe(99)
  })

  it('MOV 基础值：力量与敏捷都高于体型 → 9；其一 → 8；都不 → 7', () => {
    // 三组都让 STR+SIZ 落在 85-124（体格 0），排除体格修正干扰
    expect(computeDerived({ ...base, STR: 50, SIZ: 40, DEX: 80 }, 28).mov).toBe(9)
    expect(computeDerived({ ...base, STR: 40, SIZ: 45, DEX: 80 }, 28).mov).toBe(8)
    expect(computeDerived({ ...base, STR: 40, SIZ: 45, DEX: 40 }, 28).mov).toBe(7)
  })

  it('体格 ≥ 1 → MOV +1，体格 ≤ -1 → MOV -1', () => {
    const big = computeDerived({ ...base, STR: 70, SIZ: 60, DEX: 80 }, 28)
    expect(big.build).toBe(1)
    expect(big.db).toBe('+1D4')
    expect(big.mov).toBe(10) // 基础 9 + 1

    const small = computeDerived({ ...base, STR: 30, SIZ: 40, DEX: 30 }, 28)
    expect(small.build).toBe(-1)
    expect(small.mov).toBe(6) // 基础 7 - 1
  })

  it('年龄惩罚按 40/50/60/70/80 分档逐级叠加', () => {
    const movAt = (age: number) => computeDerived({ ...base, STR: 70, SIZ: 60, DEX: 80 }, age).mov
    expect(movAt(39)).toBe(10)
    expect(movAt(40)).toBe(9)
    expect(movAt(50)).toBe(8)
    expect(movAt(60)).toBe(7)
    expect(movAt(70)).toBe(6)
    expect(movAt(80)).toBe(5)
  })

  it('MOV 有下限 1，不会变成 0 或负数', () => {
    const frail = computeDerived({ ...base, STR: 20, SIZ: 40, DEX: 20 }, 90)
    expect(frail.mov).toBeGreaterThanOrEqual(1)
  })

  it('体格表覆盖所有 STR+SIZ 取值，不会落空', () => {
    for (let s = 2; s <= 1084; s += 7) {
      const r =
        RULES.buildTable.find((row) => s >= row.minSum && s <= row.maxSum) ?? RULES.buildTable.at(-1)!
      expect(r).toBeDefined()
      expect(typeof r.db).toBe('string')
    }
  })
})

describe('ageModifierFor', () => {
  it('每一档的 minAge..maxAge 区间自洽且不重叠', () => {
    const sorted = [...RULES.ageModifiers].sort((a, b) => a.minAge - b.minAge)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].minAge).toBe(sorted[i - 1].maxAge + 1)
    }
  })

  it('落在区间内的年龄取到对应档，超出上限取最后一档', () => {
    for (const m of RULES.ageModifiers) {
      expect(ageModifierFor(m.minAge).minAge).toBe(m.minAge)
      expect(ageModifierFor(m.maxAge).minAge).toBe(m.minAge)
    }
    const last = RULES.ageModifiers.at(-1)!
    expect(ageModifierFor(999).minAge).toBe(last.minAge)
  })
})

describe('rollAttributes / applyAgeModifiers', () => {
  it('属性掷骰落在 3D6*5 的合法区间内', () => {
    const st = createRng(1)
    for (let i = 0; i < 200; i++) {
      const attrs = rollAttributes(st)
      for (const key of ATTR_KEYS) {
        expect(attrs[key]).toBeGreaterThanOrEqual(15)
        expect(attrs[key]).toBeLessThanOrEqual(90)
      }
    }
  })

  it('年龄调整不会把属性扣到 0 以下', () => {
    const st = createRng(9)
    for (const age of [15, 20, 40, 50, 60, 70, 80, 90]) {
      const attrs = rollAttributes(st)
      const { attrs: out } = applyAgeModifiers(st, attrs, age)
      for (const key of ATTR_KEYS) expect(out[key]).toBeGreaterThanOrEqual(0)
    }
  })

  it('同种子可复现', () => {
    const run = () => {
      const st = createRng(4242)
      return ATTR_KEYS.map((k) => applyAgeModifiers(st, rollAttributes(st), 45).attrs[k])
    }
    expect(run()).toEqual(run())
  })

  it('高龄只会让教育变高或不变，身体属性只会变低或不变', () => {
    const st = createRng(31)
    const attrs = rollAttributes(st)
    const { attrs: old } = applyAgeModifiers(st, attrs, 85)
    expect(old.EDU).toBeGreaterThanOrEqual(attrs.EDU)
    expect(old.STR).toBeLessThanOrEqual(attrs.STR)
    expect(old.APP).toBeLessThanOrEqual(attrs.APP)
  })
})

describe('createPrebuiltCharacter（含 makeCharacter 的字段归一化）', () => {
  it('生命/理智/魔法被夹到合法范围', () => {
    const ch = createPrebuiltCharacter()
    expect(ch.hp).toBe(ch.hpMax)
    expect(ch.hp).toBeGreaterThan(0)
    expect(ch.mp).toBe(ch.mpMax)
    expect(ch.san).toBe(ch.attributes.POW)
    expect(ch.sanMax).toBe(99)
  })

  it('预建角色与 prebuilt.json 一致（防止手抄错一位）', () => {
    const ch = createPrebuiltCharacter()
    expect(ch.name).toBe(PREBUILT.name)
    expect(ch.age).toBe(PREBUILT.age)
    expect(ch.occupationId).toBe(PREBUILT.occupationId)
    expect(ch.luck).toBe(PREBUILT.luck)
    expect(ch.creditRating).toBe(PREBUILT.creditRating)
    for (const key of ATTR_KEYS) expect(ch.attributes[key]).toBe(PREBUILT.attributes[key])
    for (const [key, value] of Object.entries(PREBUILT.skills)) {
      expect(ch.skills[key]?.value, `预建角色的 ${key} 没写进去`).toBe(value)
    }
    expect(ch.inventory).toEqual(PREBUILT.inventory)
  })

  it('预建角色的技能值不会低于技能表基础值', () => {
    const ch = createPrebuiltCharacter()
    for (const [key, entry] of Object.entries(ch.skills)) {
      expect(entry.value, `${key} 低于基础值`).toBeGreaterThanOrEqual(skillBaseValue(key, ch.attributes))
    }
  })

  it('buildSkillTable 给整张技能表都建了条目', () => {
    const table = buildSkillTable(base)
    expect(Object.keys(table).length).toBeGreaterThan(80)
    expect(table['闪避'].value).toBe(40) // DEX 80 / 2
    expect(table['母语'].value).toBe(50) // EDU 50
    expect(table['侦查'].value).toBe(25)
  })

  it('normalizeSkillList 会滤掉技能表里没有的键', () => {
    expect(normalizeSkillList(['侦查', '格斗 ( 斗殴 )', '不存在的东西'])).toEqual(['侦查', '格斗:斗殴'])
  })
})

describe('applyVitals — 伤害与重伤', () => {
  const hp9 = () => ({ ...createPrebuiltCharacter(), hp: 9, hpMax: 9, majorWound: false })

  it('单次伤害 ≥ 最大生命值一半 → 重伤', () => {
    const res = applyVitals(hp9(), { hp: -5 }) // ceil(9/2) = 5
    expect(res.char.hp).toBe(4)
    expect(res.char.majorWound).toBe(true)
    expect(res.notes.join()).toContain('重伤')
    expect(res.died).toBe(false)
  })

  it('单次伤害不到一半 → 不重伤', () => {
    const res = applyVitals(hp9(), { hp: -4 })
    expect(res.char.hp).toBe(5)
    expect(res.char.majorWound).toBe(false)
  })

  it('生命值归零且未重伤 → 昏迷，不算死亡', () => {
    const near = { ...hp9(), hp: 4 } // 4 < 5，这一击不会造成重伤
    const res = applyVitals(near, { hp: -4 })
    expect(res.char.hp).toBe(0)
    expect(res.char.unconscious).toBe(true)
    expect(res.char.dying).toBe(false)
    expect(res.died).toBe(false)
  })

  it('生命值归零且重伤 → 濒死，并报死亡', () => {
    const res = applyVitals(hp9(), { hp: -9 })
    expect(res.char.hp).toBe(0)
    expect(res.char.majorWound).toBe(true)
    expect(res.char.dying).toBe(true)
    expect(res.died).toBe(true)
  })

  it('死亡只报一次：已经在濒死时继续受伤不再重复报死', () => {
    const first = applyVitals(hp9(), { hp: -9 })
    expect(first.died).toBe(true)
    const second = applyVitals(first.char, { hp: -1 })
    expect(second.char.hp).toBe(0)
    expect(second.died).toBe(false)
  })

  it('治疗回正会解除濒死与昏迷', () => {
    const dying = applyVitals(hp9(), { hp: -9 }).char
    const res = applyVitals(dying, { hp: 5 })
    expect(res.char.hp).toBe(5)
    expect(res.char.dying).toBe(false)
    expect(res.char.unconscious).toBe(false)
    expect(res.died).toBe(false)
  })

  it('生命值不会超过上限，也不会低于 0', () => {
    expect(applyVitals(hp9(), { hp: 100 }).char.hp).toBe(9)
    expect(applyVitals(hp9(), { hp: -100 }).char.hp).toBe(0)
  })

  it('没有伤害时不产生「生命值 ±0」这种噪声日志', () => {
    expect(applyVitals(hp9(), {}).notes).toEqual([])
  })
})

describe('applyVitals — 理智与疯狂', () => {
  const san60 = () => ({ ...createPrebuiltCharacter(), san: 60 })

  it('单次失去 5 点以上 → 临时性疯狂', () => {
    const res = applyVitals(san60(), { san: -5 })
    expect(res.char.san).toBe(55)
    expect(res.char.tempInsane).toBe(true)
    expect(res.char.indefInsane).toBe(false)
  })

  it('失去不到 5 点 → 不疯狂', () => {
    const res = applyVitals(san60(), { san: -4 })
    expect(res.char.tempInsane).toBe(false)
  })

  it('单次失去当日理智 1/5 以上 → 不定性疯狂（同时算临时性）', () => {
    const res = applyVitals(san60(), { san: -12 }) // ceil(60/5) = 12
    expect(res.char.tempInsane).toBe(true)
    expect(res.char.indefInsane).toBe(true)
  })

  it('理智值归零 → 永久疯狂', () => {
    const res = applyVitals(san60(), { san: -60 })
    expect(res.char.san).toBe(0)
    expect(res.char.indefInsane).toBe(true)
  })

  it('理智不会超过上限', () => {
    expect(applyVitals(san60(), { san: 100 }).char.san).toBe(99)
  })
})

describe('applyVitals — 魔法值与幸运', () => {
  it('魔法值与幸运被夹到合法范围', () => {
    const ch = createPrebuiltCharacter()
    expect(applyVitals(ch, { mp: -100 }).char.mp).toBe(0)
    expect(applyVitals(ch, { mp: 100 }).char.mp).toBe(ch.mpMax)
    expect(applyVitals(ch, { luck: -100 }).char.luck).toBe(0)
    expect(applyVitals(ch, { luck: 100 }).char.luck).toBe(99)
  })
})

describe('tickSkill / growTickedSkills', () => {
  it('打勾后 ticked 为 true，重复打勾被忽略', () => {
    const ch = createPrebuiltCharacter()
    const first = tickSkill(ch, '侦查')
    expect(first.char.skills['侦查'].ticked).toBe(true)
    const second = tickSkill(first.char, '侦查')
    expect(second.note).toContain('已打勾')
    expect(second.char).toBe(first.char)
  })

  it('技能表里没有的名字不会崩，并且明确报内容缺口', () => {
    const ch = createPrebuiltCharacter()
    const res = tickSkill(ch, '瞎编的技能')
    expect(res.char).toBe(ch)
    expect(res.note).toContain('内容缺口')
  })

  it('括号写法能命中（剧本里的「格斗（斗殴）」）', () => {
    const ch = createPrebuiltCharacter()
    const res = tickSkill(ch, '格斗 ( 斗殴 )')
    expect(res.char.skills['格斗:斗殴'].ticked).toBe(true)
  })

  it('成长后清空 ticked，且同种子可复现', () => {
    const run = () => {
      const st = createRng(777)
      const ch = tickSkill(createPrebuiltCharacter(), '侦查').char
      const g = growTickedSkills(st, ch)
      return { value: g.char.skills['侦查'].value, ticked: g.char.skills['侦查'].ticked, notes: g.notes }
    }
    const a = run()
    expect(a.ticked).toBe(false)
    expect(a.notes.length).toBe(1)
    expect(run()).toEqual(a)
  })

  it('成长只会让技能变高或不变', () => {
    const ch = createPrebuiltCharacter()
    const before = ch.skills['侦查'].value
    const st = createRng(5)
    const g = growTickedSkills(st, tickSkill(ch, '侦查').char)
    expect(g.char.skills['侦查'].value).toBeGreaterThanOrEqual(before)
  })
})

describe('attributeSummary', () => {
  it('八个属性都有中文标签', () => {
    const rows = attributeSummary(createPrebuiltCharacter())
    expect(rows).toHaveLength(8)
    for (const r of rows) {
      expect(r.label).not.toBe(r.key)
      expect(r.label.length).toBeGreaterThan(0)
    }
  })
})

describe('createRandomCharacter', () => {
  it('同种子给出完全相同的角色卡（可以「按种子复现」）', () => {
    const a = createRandomCharacter(createRng(20260101))
    const b = createRandomCharacter(createRng(20260101))
    expect(a.character).toEqual(b.character)
    expect(a.notes).toEqual(b.notes)
  })

  it('不同种子给出不同角色卡', () => {
    const a = createRandomCharacter(createRng(1)).character
    const b = createRandomCharacter(createRng(2)).character
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('指定的年龄/职业/名字会被尊重', () => {
    const occ = OCCUPATIONS.occupations.find((o) => o.id > 0)!
    const { character } = createRandomCharacter(createRng(3), {
      age: 41,
      occupationId: occ.id,
      name: '测试调查员',
    })
    expect(character.age).toBe(41)
    expect(character.occupationId).toBe(occ.id)
    expect(character.name).toBe('测试调查员')
  })

  it('信用评级始终落在职业区间内', () => {
    // 逐职业逐种子跑一遍：分配器曾经会把信用评级顶到上限之上
    for (const occ of OCCUPATIONS.occupations) {
      if (occ.id === 0) continue
      for (let seed = 1; seed <= 6; seed++) {
        const { character } = createRandomCharacter(createRng(seed), { occupationId: occ.id })
        expect(
          character.creditRating,
          `职业 ${occ.id} ${occ.name} 的信用评级越界`,
        ).toBeGreaterThanOrEqual(occ.creditRating.min)
        expect(character.creditRating).toBeLessThanOrEqual(occ.creditRating.max)
      }
    }
  })

  it('所有技能值都在 0..99 内，且不出现负数', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { character } = createRandomCharacter(createRng(seed))
      for (const [key, entry] of Object.entries(character.skills)) {
        expect(entry.value, `种子 ${seed} 的 ${key} 越界`).toBeGreaterThanOrEqual(0)
        expect(entry.value).toBeLessThanOrEqual(99)
      }
      expect(character.hp).toBeGreaterThan(0)
      expect(character.san).toBeGreaterThan(0)
      expect(character.luck).toBeGreaterThanOrEqual(0)
      expect(character.luck).toBeLessThanOrEqual(99)
    }
  })

  it('本职技能确实拿到了点数（不是只写在备注里）', () => {
    const occ = OCCUPATIONS.occupations.find((o) => o.name.includes('私家侦探'))!
    const { character } = createRandomCharacter(createRng(11), { occupationId: occ.id })
    expect(character.creditRating).toBeGreaterThanOrEqual(occ.creditRating.min)
    const invested = Object.values(character.skills).filter((s) => s.ticked === false && s.value > 0)
    expect(invested.length).toBeGreaterThan(9)
  })

  it('备注里交代了属性、职业与点数去向', () => {
    const { notes } = createRandomCharacter(createRng(8))
    const joined = notes.join('\n')
    expect(joined).toContain('掷属性')
    expect(joined).toContain('职业点')
    expect(joined).toContain('兴趣点')
  })

  it('生成的角色的理智等于意志（规则要求）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { character } = createRandomCharacter(createRng(seed))
      expect(character.san).toBe(character.attributes.POW)
    }
  })
})

describe('存档往返', () => {
  it('角色卡能被 JSON 序列化并原样读回（存档只存 POJO）', () => {
    const ch: Character = createRandomCharacter(createRng(5)).character
    const round = JSON.parse(JSON.stringify(ch)) as Character
    expect(round).toEqual(ch)
  })
})
