/**
 * 内容加载层：把 src/content/ 下的 JSON 读成类型化对象。
 *
 * 用 `?raw` + JSON.parse 而不是直接 `import x from './x.json'`：
 * script.json 有 269 个节点、约 350KB，直接 import 会让 TypeScript 为整份 JSON
 * 生成字面量类型，编译明显变慢。走字符串再 parse，编译期零负担。
 */

import scriptRaw from '../content/scenes/script.json?raw'
import skillsRaw from '../content/rules/skills.json?raw'
import rulesRaw from '../content/rules/rules.json?raw'
import specialtiesRaw from '../content/rules/specialties.json?raw'
import occupationsRaw from '../content/rules/occupations.json?raw'
import prebuiltRaw from '../content/rules/prebuilt.json?raw'

import type { AttrKey, Scene, Script } from './types'

function loadJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    throw new Error(`${what} 不是合法 JSON：${(err as Error).message}`)
  }
}

// --- 剧本 ----------------------------------------------------------------

export const SCRIPT: Script = loadJson<Script>(scriptRaw, 'script.json')

export interface SceneIndex {
  byId: Map<number, Scene>
  ids: number[]
  /** 反向索引：谁指向某个节点。诊断内容缺口时很有用。 */
  incoming: Map<number, number[]>
}

export function buildSceneIndex(script: Script = SCRIPT): SceneIndex {
  const byId = new Map<number, Scene>()
  for (const node of script.nodes) byId.set(node.id, node)
  const incoming = new Map<number, number[]>()
  for (const node of script.nodes) {
    for (const link of node.links) {
      const list = incoming.get(link.to)
      if (list) list.push(node.id)
      else incoming.set(link.to, [node.id])
    }
  }
  return { byId, ids: script.nodes.map((n) => n.id), incoming }
}

export const SCENES = buildSceneIndex()

// --- 技能表 --------------------------------------------------------------

export interface SkillComputed {
  kind: 'attr' | 'attrOver'
  attr: AttrKey
  divisor?: number
}

export interface SkillDef {
  label: string
  base: number
  computed?: SkillComputed
}

export interface SkillTable {
  meta: Record<string, string>
  skills: Record<string, SkillDef>
  aliases: Record<string, string>
  groups: Record<string, string[]>
  playerSkills: string[]
}

export const SKILL_TABLE: SkillTable = loadJson<SkillTable>(skillsRaw, 'skills.json')

// --- 规则表 --------------------------------------------------------------

export interface AgeModifier {
  minAge: number
  maxAge: number
  eduChecks: number
  strSizPenalty: number
  strConDexPenalty: number
  appPenalty: number
  luckRolls: number
  note: string
}

export interface BuildRow {
  minSum: number
  maxSum: number
  db: string
  build: number
}

export interface RulesTable {
  meta: Record<string, string>
  attributes: { key: AttrKey; label: string; formula: string }[]
  derived: Record<string, { label: string; formula: string; max?: number }>
  movRule: {
    base: string
    buildAdjust: string
    agePenalty: { minAge: number; penalty: number }[]
  }
  ageModifiers: AgeModifier[]
  buildTable: BuildRow[]
  skillPointsRule: Record<string, string>
  quickRules: Record<string, unknown>
  eraList: string[]
}

export const RULES: RulesTable = loadJson<RulesTable>(rulesRaw, 'rules.json')

// --- 技能专攻 & 职业 ------------------------------------------------------

export interface SpecialtyGroup {
  group: string
  key: string
  items: { name: string; base: number }[]
}

export const SPECIALTIES: { meta: Record<string, string>; groups: SpecialtyGroup[] } = loadJson(
  specialtiesRaw,
  'specialties.json',
)

export interface Occupation {
  id: number
  name: string
  creditRating: { min: number; max: number; raw?: string }
  attrFormula: string
  skillPoints: number
  occupationSkills: string[]
}

export const OCCUPATIONS: { meta: Record<string, string>; occupations: Occupation[] } = loadJson(
  occupationsRaw,
  'occupations.json',
)

export function occupationById(id: number): Occupation | undefined {
  return OCCUPATIONS.occupations.find((o) => o.id === id)
}

// --- 预生成调查员 ---------------------------------------------------------

export interface Prebuilt {
  name: string
  age: number
  era: string
  occupationId: number
  occupationName: string
  attributes: Record<AttrKey, number>
  luck: number
  creditRating: number
  skills: Record<string, number>
  inventory: string[]
}

export const PREBUILT: Prebuilt = loadJson<{ prebuilt: Prebuilt }>(prebuiltRaw, 'prebuilt.json').prebuilt
