/**
 * 剧本效果的结算。
 *
 * 解析器从正文里抓出「失去 1D6 点生命值」「你可以在「攀爬」技能左边的小方框里打勾」
 * 这类句子，转成 SceneEffect。引擎在**首次进入该节点时**统一结算。
 *
 * 已知取舍（会在解析报告与 UI 里标注）：
 *   正则抓取会有误报，例如「黑熊的爪击造成 2D6 点伤害」是描述**敌人**的伤害，
 *   但也会被 RE_LOSE_HP 命中。所以角色面板必须允许手动改数值 —— 自动化不能
 *   以牺牲正确性为代价，但也不能因为怕错就什么都不做。
 */

import { applyVitals, tickSkill } from './character'
import { rollExpressionDetailed } from './dice'
import type { RngState } from './rng'
import type { Character, EffectWhen, SceneEffect } from './types'

export interface EffectOutcome {
  char: Character
  notes: string[]
  died: boolean
}

/**
 * 挑出在给定的前提下该结算的效果。
 *
 * outcome === null 表示「刚进入节点」（即没有前提的无条件效果）。
 * 这一点必须由调用方显式传入，因为「进入节点」和「检定成功/失败」
 * 是三个不同的时机 —— 混在一起就会重复结算。
 */
export function selectEffects(effects: SceneEffect[], outcome: EffectWhen | null): SceneEffect[] {
  return effects.filter((e) => (e.when ?? null) === outcome)
}

export function applyEffects(
  st: RngState,
  char: Character,
  effects: SceneEffect[],
): EffectOutcome {
  let current = char
  const notes: string[] = []
  let died = false

  for (const effect of effects) {
    const prefix = effect.when === 'success' ? '（检定成功）' : effect.when === 'failure' ? '（检定失败）' : ''
    if (effect.kind === 'tick') {
      const res = tickSkill(current, effect.skill)
      current = res.char
      notes.push(`${prefix}${res.note}`)
      continue
    }

    const { total, detail } = rollExpressionDetailed(st, effect.value)
    if (total === 0) continue
    const delta = effect.op === 'lose' ? -total : total
    const label = effect.kind === 'hp' ? '生命值' : '理智值'
    const sign = delta > 0 ? '+' : '-'

    const res = applyVitals(current, effect.kind === 'hp' ? { hp: delta } : { san: delta })
    current = res.char
    died = died || res.died
    notes.push(`${prefix}${label} ${sign}${Math.abs(total)}（${effect.value} = ${detail}）`)
    notes.push(...res.notes.filter((n) => n.includes('重伤') || n.includes('疯狂') || n.includes('濒死') || n.includes('昏迷')))
  }

  return { char: current, notes, died }
}

/** 供 UI 在按钮上预览「这个节点会扣什么」，避免玩家点下去才发现。 */
export function describeEffect(effect: SceneEffect): string {
  const prefix = effect.when === 'success' ? '（成功）' : effect.when === 'failure' ? '（失败）' : ''
  if (effect.kind === 'tick') return `${prefix}「${effect.skill}」打勾`
  const label = effect.kind === 'hp' ? '生命值' : '理智值'
  const verb = effect.op === 'lose' ? '失去' : '回复'
  return `${prefix}${verb} ${effect.value} 点${label}`
}
