/**
 * 引擎的公共类型。
 *
 * 分层约定：engine/ 里**不允许**出现 React / DOM 的任何引用。
 * 引擎是纯函数式的：`(state, 输入) -> 新 state + 事件列表`，
 * 这样它既能被 UI 驱动，也能被 Node 里的自动通关测试驱动。
 */

// --- 属性 ----------------------------------------------------------------

export const ATTR_KEYS = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'] as const
export type AttrKey = (typeof ATTR_KEYS)[number]

export const ATTR_LABELS: Record<AttrKey, string> = {
  STR: '力量',
  CON: '体质',
  SIZ: '体型',
  DEX: '敏捷',
  APP: '外貌',
  INT: '智力',
  POW: '意志',
  EDU: '教育',
}

/** 剧本里用中文写属性名，这里做中英映射。 */
export const ATTR_BY_LABEL: Record<string, AttrKey> = {
  力量: 'STR',
  体质: 'CON',
  体型: 'SIZ',
  敏捷: 'DEX',
  外貌: 'APP',
  智力: 'INT',
  意志: 'POW',
  教育: 'EDU',
}

// --- 成功等级 ------------------------------------------------------------

export type Difficulty = 'regular' | 'hard' | 'extreme'

/** 由低到高。`critical` 不参与「达到某难度」的比较，它本身就是最高级。 */
export type SuccessLevel = 'fumble' | 'failure' | 'regular' | 'hard' | 'extreme' | 'critical'

export const LEVEL_ORDER: Record<SuccessLevel, number> = {
  fumble: -1,
  failure: 0,
  regular: 1,
  hard: 2,
  extreme: 3,
  critical: 4,
}

export const LEVEL_LABELS: Record<SuccessLevel, string> = {
  fumble: '大失败',
  failure: '失败',
  regular: '成功',
  hard: '困难成功',
  extreme: '极限成功',
  critical: '大成功',
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  regular: '常规',
  hard: '困难',
  extreme: '极难',
}

/** 各难度对应的最低成功等级。 */
export const DIFFICULTY_MIN_LEVEL: Record<Difficulty, SuccessLevel> = {
  regular: 'regular',
  hard: 'hard',
  extreme: 'extreme',
}

// --- 剧本 ----------------------------------------------------------------

export type ConditionOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'

export interface LinkCondition {
  attr: string
  op: ConditionOp
  value: number
}

/**
 * 链接与检定结果的对应关系。
 *
 * 每加一种，就意味着「掷完骰子能自动带走玩家」多覆盖一种原文写法；
 * 少一种，那一处就退化成「请自己选一个」——玩家得替引擎做规则判断。
 * 解析器认的措辞见 tools/txt_to_scenes.py 的 detect_links。
 */
export type LinkOutcome =
  | 'success' // 如果成功 / 通过 / 胜出
  | 'failure' // 如果失败 / 没有通过 / 落败 / 否则
  | 'fumble' // 大失败：独立落点，不是普通失败
  | 'push' // 孤注一掷之后的结果
  | 'always' // 兜底：成功失败都走这条（原文只写后果、不写两条路）

export interface SceneLink {
  label: string | null
  to: number
  condition?: LinkCondition
  outcome?: LinkOutcome
}

export interface SceneCheck {
  skill: string
  difficulty: Difficulty
}

/**
 * 效果生效的前提。
 *
 * 原书大量效果写在条件句里：「如果你失败了，失去 1D4 点理智值」。
 * 早期版本把这类效果**无条件**挂在节点上，一进节点就结算，于是结局 171
 * 会同时扣掉成功与失败两份理智（1 点 + 1D4 点）。
 * 现在解析器把前提写进 when，由引擎在检定结算后按结果挑着应用。
 *
 * 缺省（undefined）＝ 进入节点即生效，例如「你踩到陷阱，失去 1D3 点生命值」。
 */
export type EffectWhen = 'success' | 'failure'

export interface EffectBase {
  when?: EffectWhen
}

export type SceneEffect = EffectBase &
  (
    | { kind: 'hp' | 'san'; op: 'lose' | 'gain'; value: string }
    | { kind: 'tick'; skill: string }
  )

export type SceneKind = 'text' | 'choice' | 'check' | 'combat' | 'ending' | 'dead_end'

export interface Scene {
  id: number
  kind: SceneKind
  text: string
  display: string
  links: SceneLink[]
  checks: SceneCheck[]
  effects: SceneEffect[]
}

export interface Script {
  meta: { title: string; system: string; source: string; nodeCount: number }
  nodes: Scene[]
}

// --- 角色 ----------------------------------------------------------------

export interface SkillEntry {
  /** 规范化后的技能名（见 names.ts / skills.json 的 normalize 约定） */
  name: string
  /** 最终成功率（含基础值 + 职业点 + 兴趣点 + 成长） */
  value: number
  /** 本局是否已通过「技能打勾」得到过成长机会 */
  ticked: boolean
}

export interface Character {
  name: string
  age: number
  era: string
  occupationId: number
  occupationName: string

  attributes: Record<AttrKey, number>
  luck: number

  hp: number
  hpMax: number
  mp: number
  mpMax: number
  san: number
  sanMax: number

  mov: number
  db: string
  build: number

  creditRating: number
  skills: Record<string, SkillEntry>

  inventory: string[]
  background: Record<string, string>

  // 受伤 / 理智状态
  majorWound: boolean
  unconscious: boolean
  dying: boolean
  tempInsane: boolean
  indefInsane: boolean
}

// --- 游戏状态 ------------------------------------------------------------

export type LogKind = 'scene' | 'check' | 'effect' | 'system'

export interface LogEntry {
  seq: number
  kind: LogKind
  nodeId: number | null
  text: string
}

export interface GameEnding {
  /**
   * ending      —— 【剧终】，正常收官
   * death       —— 角色死亡（生命值归零 / 神魂俱灭）
   * interrupted —— 正文到此为止：原书这一条没有任何出口，或链接指向了不存在的条目。
   *                 这是**原始文本的内容缺口**，不是玩家的失败。单列一类是为了不把
   *                 「书缺页」伪装成「你死了」，同时也不会让玩家卡在空白页上。
   */
  kind: 'ending' | 'death' | 'interrupted'
  nodeId: number
}

export interface GameState {
  /** 存档结构版本。字段改动时 +1，存档迁移靠它判断。 */
  version: number
  /** 随机种子。存进存档 → 读档后骰点可复现，堵死 SL 大法。 */
  seed: number
  /** mulberry32 的内部状态，序列化后读档不会重放整个随机序列。 */
  rngState: number
  turn: number
  nodeId: number
  char: Character
  /** 节点访问次数，用于「初次进入才结算效果」与 UI 提示。 */
  visited: Record<string, number>
  log: LogEntry[]
  /** 日志序号计数器。用独立字段而不是 log.length，因为日志会被截断。 */
  logSeq: number
  /** 已用掉孤注一掷的检定：键为 `${nodeId}:${checkIndex}`。 */
  pushUsed: Record<string, boolean>
  ended: GameEnding | null
}

// --- 演出层（UI 要渲染的交互）---------------------------------------------

export interface CheckOffer {
  /** 指向 scene.checks 的下标 */
  index: number
  label: string
  /** 规范化后的技能/属性名 */
  targetName: string
  targetLabel: string
  /** 目标值（技能值或属性值） */
  target: number
  difficulty: Difficulty
  /**
   * 各种结果各自的落点，null = 原书没写这条路。
   *
   * successTo/failureTo 优先，然后才是 alwaysTo 兜底 —— 原文只写后果、不写
   * 两条路的条目（如 52「如果你失败了……现在转到 64」）只有 alwaysTo。
   */
  successTo: number | null
  failureTo: number | null
  fumbleTo: number | null
  pushTo: number | null
  alwaysTo: number | null
  /**
   * true = 原书真的没给唯一分支，掷完骰子得请玩家自己选。
   *
   * 这是**内容缺口**，不是正常状态：解析报告里会逐条列出，正常剧本应当全为
   * false。真为 true 时 UI 会把分支摆成按钮让玩家点（宁可吵，不可静）。
   */
  ambiguous: boolean
}

export interface ChoiceOffer {
  /** 指向 scene.links 的下标 */
  index: number
  label: string
  to: number | null
  conditionText?: string
  /** 这条链接是「检定成功/失败/大失败/孤注一掷/兜底」的分支 */
  outcome?: LinkOutcome
}

export interface Interaction {
  nodeId: number
  kind: SceneKind
  /** 唯一出口时的「继续」按钮落点 */
  continueTo: number | null
  checks: CheckOffer[]
  choices: ChoiceOffer[]
  /** 无可用出口时的说明（对应解析报告里的内容缺口） */
  blockers: string[]
}
