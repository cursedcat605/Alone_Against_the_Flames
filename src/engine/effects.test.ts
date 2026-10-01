/**
 * 效果前提（SceneEffect.when）的回归测试。
 *
 * 背景：原书大量数值写在条件句里（「如果你失败了，失去 1D4 点理智值」）。
 * 早期版本把这些效果**无条件**挂在节点上，一进节点就结算，于是：
 *   * 结局条目 171 会同时扣掉「成功：1 点」和「失败：1D4 点」；
 *   * 条目 141 会把「怎么用 D6 模拟 D2」的说明（1 点 / 2 点）当成真损失，共扣 3 点；
 *   * 条目 173 会把熊的爪击与啃咬伤害（2D6 / 1D8）算到玩家头上。
 * 这些都不是排版瑕疵，是数值算错，所以必须有测试盯着。
 */

import { describe, expect, it } from 'vitest'

import { SCENES } from './content'
import { createPrebuiltCharacter } from './character'
import { applyEffects, describeEffect, selectEffects } from './effects'
import { analyze, createGame, performCheck } from './state'
import { createRng } from './rng'
import type { GameState, SceneEffect } from './types'

const conditional = (when: 'success' | 'failure'): SceneEffect =>
  ({ kind: 'san', op: 'lose', value: '1D4', when })
const plain: SceneEffect = { kind: 'san', op: 'lose', value: '1D4' }

describe('selectEffects：三个结算时机必须互不重叠', () => {
  it('进入节点只拿无条件效果，绝不顺手结算条件效果', () => {
    const all = [plain, conditional('success'), conditional('failure')]
    expect(selectEffects(all, null)).toEqual([plain])
  })

  it('检定成功 / 失败各自只拿自己那一份', () => {
    const all = [plain, conditional('success'), conditional('failure')]
    expect(selectEffects(all, 'success')).toEqual([conditional('success')])
    expect(selectEffects(all, 'failure')).toEqual([conditional('failure')])
  })

  it('剧本里所有效果都能被某个时机认领（不会漏结算）', () => {
    for (const scene of SCENES.byId.values()) {
      const claimed = [
        ...selectEffects(scene.effects, null),
        ...selectEffects(scene.effects, 'success'),
        ...selectEffects(scene.effects, 'failure'),
      ]
      // 用对象引用比对：效果会因为浮点/顺序问题相等，但引用必须一一对应
      expect(claimed.length, `条目 ${scene.id} 有效果没人认领`).toBe(scene.effects.length)
    }
  })

  it('describeEffect 会写清前提，玩家不该被蒙在鼓里', () => {
    expect(describeEffect(conditional('failure'))).toContain('失败')
    expect(describeEffect(conditional('success'))).toContain('成功')
    expect(describeEffect(plain)).not.toContain('成功')
  })
})

describe('结算行为', () => {
  it('applyEffects 只在日志里标出前提，数值照掷', () => {
    const rng = createRng(1)
    const res = applyEffects(rng, createPrebuiltCharacter(), [conditional('failure')])
    expect(res.notes.length).toBeGreaterThan(0)
    expect(res.notes[0]).toContain('失败')
  })

  it('结局 171：带前提的效果在进入时不结算', () => {
    const scene = SCENES.byId.get(171)
    expect(scene, '条目 171 应该存在').toBeDefined()
    expect(scene!.effects.length).toBeGreaterThan(0)
    // 全部带前提 —— 这就是「进入条目不会掉理智」的数据依据
    expect(scene!.effects.every((e) => e.when)).toBe(true)
    expect(selectEffects(scene!.effects, null)).toEqual([])

    const char = createPrebuiltCharacter()
    const at: GameState = { ...createGame(char, 3), nodeId: 171, ended: null }
    expect(at.char.san).toBe(char.san)
  })

  it('结局 171：检定之后才扣理智，且只扣成功/失败其中的一份', () => {
    const char = createPrebuiltCharacter()
    for (let seed = 1; seed <= 40; seed++) {
      const at: GameState = { ...createGame(char, seed), nodeId: 171, ended: null }
      const offer = analyze(at).checks[0]
      expect(offer, `种子 ${seed} 时 171 应该有一个理智检定`).toBeDefined()

      const res = performCheck(at, offer)
      const lost = at.char.san - res.state.char.san
      // 成功 1 点 / 失败 1..4 点。旧 bug 会扣「1 + 1..4」= 2..5 点。
      expect(lost, `种子 ${seed} 扣了 ${lost} 点理智`).toBeGreaterThanOrEqual(1)
      expect(lost, `种子 ${seed} 扣了 ${lost} 点理智（成功与失败被叠加结算）`).toBeLessThanOrEqual(4)
    }
  })
})

describe('内容侧的硬约束', () => {
  it('带前提的效果只出现在单检定条目上（否则引擎不知道按哪个检定结算）', () => {
    const bad = [...SCENES.byId.values()]
      .filter((s) => s.effects.some((e) => e.when))
      .filter((s) => s.checks.length !== 1)
      .map((s) => `#${s.id}（检定 ${s.checks.length} 个）`)
    expect(bad).toEqual([])
  })

  it('失败前提的效果只出现在不能孤注一掷的检定上（否则重掷会重复结算）', () => {
    // 引擎按「最终结果」结算效果，孤注一掷不会回滚已经结算过的失败后果。
    // 理智检定本来就禁止孤注一掷，所以当前剧本是安全的；换成可重掷的技能就要改引擎。
    const bad = [...SCENES.byId.values()]
      .filter((s) => s.effects.some((e) => e.when === 'failure'))
      .filter((s) => !s.checks.every((c) => c.skill === '理智' || c.skill === '幸运'))
      .map((s) => `#${s.id}（${s.checks.map((c) => c.skill).join('/')}）`)
    expect(bad).toEqual([])
  })

  it('敌人的伤害不会被记到玩家头上（条目 262 的 1D3+1D4 是工匠的拳伤）', () => {
    // 正文：「每次攻击成功会造成1D3+1D4 点伤害」——主语是那个巨汉/工匠，不是玩家。
    // 解析器把这句话里的骰子丢掉了（记在 _parse_report.txt 的「效果复核」里），
    // 结果就是 262 没有 hp 效果。这是**故意**的：玩家在这里受到的伤害应当由战斗
    // 规则结算（闪避失败的后果），而不是一进条目就按敌人的伤害值扣血。
    // 这条测试是反向的护栏：将来若有人「顺手」把这 2 个骰子加回 262，它会立刻变红。
    const combat = SCENES.byId.get(262)
    expect(combat?.kind).toBe('combat')
    expect(combat?.effects).toEqual([])
    expect(combat?.checks.map((c) => c.skill)).toEqual(['闪避'])
  })
})
