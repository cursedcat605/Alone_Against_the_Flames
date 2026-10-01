import { describe, expect, it } from 'vitest'

import { buildSceneIndex, SCENES, SCRIPT, SKILL_TABLE, RULES } from './content'
import { createPrebuiltCharacter, createRandomCharacter } from './character'
import { isResolvableTarget, resolveSkillKey, resolveTarget, skillDef } from './names'
import { conditionIsKnown } from './conditions'
import { createRng } from './rng'
import {
  KNOWN_DEAD_ENDS,
  KNOWN_GAPS_RAW,
  KNOWN_MISSING_NODE_IDS,
  KNOWN_NO_OUTLET,
  KNOWN_ORPHANS,
  KNOWN_UNREACHABLE,
} from './gaps'
import type { SceneKind } from './types'

const ALL_KINDS: SceneKind[] = ['text', 'choice', 'check', 'combat', 'ending', 'dead_end']

/**
 * 内容缺口的名单不住在这里。
 *
 * 下面所有「已知缺口」都从 `tools/overrides.json` 的 `knownGaps` 读（见 ./gaps.ts），
 * 与 `npm run check` 的 CLI 校验脚本共用同一份登记表。
 * 两处各写一份数字清单的后果是：一边修好了、另一边还在放行，或者反过来
 * 把真实缺陷当成已知项静默吞掉。
 */

/** 原书里就缺失编号、却被别处引用的条目（断链只在这些编号上合法）。 */
const BROKEN_LINKS: Array<[number, number]> = KNOWN_MISSING_NODE_IDS.map((id) => [68, id])

describe('script.json 结构', () => {
  it('meta 声明的条目数与实际一致', () => {
    expect(SCRIPT.meta.nodeCount).toBe(SCRIPT.nodes.length)
    expect(SCRIPT.nodes.length).toBe(269)
    expect(SCRIPT.meta.title).toBe('向火独行')
    expect(SCRIPT.meta.system).toBe('Call of Cthulhu 7e')
  })

  it('条目 id 唯一', () => {
    const ids = SCRIPT.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('id 从 1 开始连续（缺号就说明有一条相对完整的段落丢了）', () => {
    const ids = [...SCRIPT.nodes.map((n) => n.id)].sort((a, b) => a - b)
    const present = new Set(ids)
    const missing: number[] = []
    for (let i = ids[0]; i <= ids.at(-1)!; i++) if (!present.has(i)) missing.push(i)
    expect(missing).toEqual(KNOWN_MISSING_NODE_IDS)
  })

  it('每个条目的 kind 都是已知类型', () => {
    for (const n of SCRIPT.nodes) {
      expect(ALL_KINDS, `条目 ${n.id} 的 kind=${n.kind} 不认识`).toContain(n.kind)
    }
  })

  it('每个条目都有正文与展示文本', () => {
    for (const n of SCRIPT.nodes) {
      expect(n.text.trim().length, `条目 ${n.id} 正文为空`).toBeGreaterThan(0)
      expect(n.display.trim().length, `条目 ${n.id} 展示文本为空`).toBeGreaterThan(0)
    }
  })

  it('所有跳转目标都存在，缺口只有登记在册的那几条', () => {
    const broken: Array<[number, number]> = []
    for (const n of SCRIPT.nodes) {
      for (const l of n.links) if (!SCENES.byId.has(l.to)) broken.push([n.id, l.to])
    }
    expect(broken).toEqual(BROKEN_LINKS)
  })

  it('每个条目都有出口，除非是结局或已登记的无出口条目', () => {
    const noOutlet = SCRIPT.nodes
      .filter((n) => n.links.length === 0 && n.kind !== 'ending' && n.kind !== 'dead_end')
      .map((n) => n.id)
    expect(noOutlet).toEqual(KNOWN_NO_OUTLET)
  })

  it('结局条目就是结局，不需要玩家再操作', () => {
    const endings = SCRIPT.nodes.filter((n) => n.kind === 'ending')
    expect(endings.length).toBeGreaterThan(10)
    // 只有条目 171 例外：它是尾声，正文里有最终理智检定，但成败两支都不跳转
    // （「如果你成功了，失去 1 点理智值；如果你失败了，失去 1D4 点理智值……【剧终】」）。
    // 该检定目前只作为正文保留，引擎按结局直接收官 —— 属于已登记的内容缺口。
    const withChecks = endings.filter((e) => e.checks.length > 0).map((e) => e.id)
    expect(withChecks).toEqual(KNOWN_GAPS_RAW.endingsWithChecks.map((e) => e.id))
  })

  it('死路条目（无出口且无剧终）只有登记在册的那几个', () => {
    const deadEnds = SCRIPT.nodes.filter((n) => n.kind === 'dead_end').map((n) => n.id)
    expect(deadEnds).toEqual(KNOWN_DEAD_ENDS)
  })
})

describe('场景索引', () => {
  const index = buildSceneIndex(SCRIPT)

  it('byId 覆盖全部条目', () => {
    expect(index.byId.size).toBe(SCRIPT.nodes.length)
    expect(index.ids.length).toBe(SCRIPT.nodes.length)
  })

  it('incoming 反向索引与正向链接完全一致', () => {
    const byId = index.byId
    const forward = new Map<number, number[]>()
    for (const n of SCRIPT.nodes) {
      for (const l of n.links) {
        if (!byId.has(l.to)) continue
        forward.set(l.to, [...(forward.get(l.to) ?? []), n.id])
      }
    }
    for (const [to, from] of forward) {
      const reverse = (index.incoming.get(to) ?? []).slice().sort((a, b) => a - b)
      expect(reverse, `条目 ${to} 的反向索引不一致`).toEqual(from.slice().sort((a, b) => a - b))
    }
    // 反向索引里多出来的键，只能是不存在的目标（即已登记的断链）
    const extra = [...index.incoming.keys()].filter((k) => !forward.has(k) && !index.byId.has(k))
    expect(extra).toEqual(KNOWN_MISSING_NODE_IDS)
  })

  it('没有入口的条目正好是登记在册的那一批（起点 1 除外）', () => {
    const orphans = index.ids.filter((id) => id !== 1 && (index.incoming.get(id) ?? []).length === 0)
    expect(orphans.sort((a, b) => a - b)).toEqual(KNOWN_ORPHANS)
  })

  it('零入边的条目一定是不可达的（双保险：名单之间不能自相矛盾）', () => {
    const unreachable = new Set(KNOWN_UNREACHABLE)
    for (const id of KNOWN_ORPHANS) {
      expect(unreachable.has(id), `条目 ${id} 零入边却没登记进不可达名单`).toBe(true)
      expect(index.incoming.get(id) ?? [], `条目 ${id} 现在有入口了，请从名单里移掉`).toEqual([])
    }
  })

  it('不可达条目就是登记在册的那一批（多一个少一个都要重新核实）', () => {
    const seen = new Set<number>()
    const stack = [1]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const node = index.byId.get(id)
      if (!node) continue
      for (const l of node.links) if (index.byId.has(l.to)) stack.push(l.to)
    }
    const unreachable = index.ids.filter((id) => !seen.has(id)).sort((a, b) => a - b)
    // 集合相等而不是数量相等：这样才能发现「修好了两个、又坏了两个」
    expect(unreachable).toEqual(KNOWN_UNREACHABLE)
    expect(seen.size).toBe(SCRIPT.nodes.length - KNOWN_UNREACHABLE.length)
  })
})

describe('检定的技能名都能解析（防止静默 0% 目标）', () => {
  it('剧本里的每一个检定目标（属性或技能）都能被解析', () => {
    const unknown: string[] = []
    for (const n of SCRIPT.nodes) {
      for (const c of n.checks) {
        if (!isResolvableTarget(c.skill)) unknown.push(`#${n.id} ${c.skill}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('用真实角色卡解析时，没有任何检定落到 unknown（即 0% 必失败）', () => {
    for (const char of [createPrebuiltCharacter(), createRandomCharacter(createRng(1)).character]) {
      const unknown: string[] = []
      for (const n of SCRIPT.nodes) {
        for (const c of n.checks) {
          const info = resolveTarget(char, c.skill)
          if (info.kind === 'unknown') unknown.push(`#${n.id} ${c.skill}`)
          // 属性类检定必须有真实值，不能是 0
          if (info.kind !== 'unknown' && info.value <= 0) unknown.push(`#${n.id} ${c.skill} → 0`)
        }
      }
      expect(unknown, `${char.name} 的解析缺口`).toEqual([])
    }
  })

  it('检定难度都是常规/困难/极难', () => {
    for (const n of SCRIPT.nodes) {
      for (const c of n.checks) expect(['regular', 'hard', 'extreme']).toContain(c.difficulty)
    }
  })

  it('每个条目最多 4 个检定（超过就说明解析把多段合并了）', () => {
    for (const n of SCRIPT.nodes) {
      expect(n.checks.length, `条目 ${n.id} 有 ${n.checks.length} 个检定`).toBeLessThanOrEqual(4)
    }
  })
})

describe('效果与条件引用都合法', () => {
  it('tick 效果引用的技能都能被映射到技能表里的键', () => {
    const bad: string[] = []
    for (const n of SCRIPT.nodes) {
      for (const e of n.effects) {
        if (e.kind !== 'tick') continue
        if (resolveSkillKey(e.skill) === undefined) bad.push(`#${n.id} tick ${e.skill}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('hp / san 效果的数值是能掷的表达式', () => {
    for (const n of SCRIPT.nodes) {
      for (const e of n.effects) {
        if (e.kind === 'tick') continue
        expect(e.value.trim().length, `条目 ${n.id} 的效果值是空的`).toBeGreaterThan(0)
        expect(e.op === 'lose' || e.op === 'gain', `条目 ${n.id} 的 op=${e.op}`).toBe(true)
      }
    }
  })

  it('条件分支引用的属性都是引擎认识的', () => {
    const bad: string[] = []
    for (const n of SCRIPT.nodes) {
      for (const l of n.links) {
        if (l.condition && !conditionIsKnown(l.condition.attr)) {
          bad.push(`#${n.id} → 属性「${l.condition.attr}」`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

describe('规则表自洽', () => {
  it('体格表区间连续、无空洞、无重叠', () => {
    const rows = [...RULES.buildTable].sort((a, b) => a.minSum - b.minSum)
    expect(rows[0].minSum).toBe(2)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].minSum, `体格表在第 ${i} 行有空洞`).toBe(rows[i - 1].maxSum + 1)
    }
  })

  it('技能表里每次专攻键都能反查到自己的标签', () => {
    for (const [key, def] of Object.entries(SKILL_TABLE.skills)) {
      expect(def.label.length, `${key} 没有标签`).toBeGreaterThan(0)
      expect(def.base, `${key} 的基础值越界`).toBeGreaterThanOrEqual(0)
      expect(def.base).toBeLessThanOrEqual(99)
    }
  })

  it('别名指向的目标都是真实存在的技能', () => {
    for (const [from, to] of Object.entries(SKILL_TABLE.aliases)) {
      expect(skillDef(to), `别名 ${from} → ${to} 指向了不存在的技能`).toBeDefined()
    }
  })

  it('玩家技能池与社交技能组都是真实技能', () => {
    for (const key of SKILL_TABLE.playerSkills) expect(skillDef(key), `playerSkills 的 ${key}`).toBeDefined()
    for (const key of SKILL_TABLE.groups['社交技能'] ?? []) {
      expect(skillDef(key), `社交技能组的 ${key}`).toBeDefined()
    }
  })
})

describe('正文可用性', () => {
  it('条目正文里没有残留的解析标记', () => {
    for (const n of SCRIPT.nodes) {
      expect(n.display, `条目 ${n.id} 残留了分隔符`).not.toMatch(/^\s*[-—=]{3,}\s*$/)
      expect(n.text.includes('\u0000'), `条目 ${n.id} 有 NUL 字符`).toBe(false)
    }
  })

  it('选择肢标签不像噪声（纯数字/单字/页码）', () => {
    const suspicious: string[] = []
    for (const n of SCRIPT.nodes) {
      for (const l of n.links) {
        if (!l.label) continue
        const s = l.label.trim()
        if (/^\d+$/.test(s) || s.length === 1) suspicious.push(`#${n.id} 「${s}」`)
      }
    }
    expect(suspicious).toEqual([])
  })

  /**
   * 译注是译者加的说明，不是游戏规则。它常常写着「如果你因为重伤而昏迷，转到 2。」
   * 这种字样，早期版本会照常把它抽成跳转，后果有两层：
   *   1. 按钮标签被句号截断，玩家看到「（译注：如果你因为重伤而昏迷」这种半句话；
   *   2. 条目 173/235/262 都是近身战斗，于是**可以绕过「体质」检定直接跳去结局**。
   * 所以这不是排版瑕疵，是规则漏洞。
   */
  it('译者的括注不会被抽成跳转选项', () => {
    const bad: string[] = []
    for (const n of SCRIPT.nodes) {
      for (const l of n.links) {
        if ((l.label ?? '').includes('译注')) bad.push(`#${n.id} 「${l.label}」→ ${l.to}`)
      }
    }
    expect(bad).toEqual([])
  })

  /**
   * 反过来的约束：译者括注里的文字必须**完整留在正文里**。
   * 当初把括注抽成链接时，被剥掉的那半句没有回到正文，正文末尾只剩一个「）」。
   */
  it('括注没有被剥掉半句（正文里不会出现只剩右括号的孤段）', () => {
    const orphans: string[] = []
    for (const n of SCRIPT.nodes) {
      for (const para of (n.display ?? '').split('\n')) {
        const s = para.trim()
        if (s === '）' || s === ')' || s === '。）' || s === '。）') orphans.push(`#${n.id} 「${s}」`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('正文里的括号成对闭合（译注必须完整）', () => {
    const unbalanced: number[] = []
    for (const n of SCRIPT.nodes) {
      const v = n.display ?? ''
      const open = (v.match(/[（(]/g) ?? []).length
      const close = (v.match(/[）)]/g) ?? []).length
      if (open !== close) unbalanced.push(n.id)
    }
    expect(unbalanced).toEqual([])
  })

  /**
   * 破折号在源文本里全是句中破折号（「你两脚一软——」/「失去 1D3 点理智值。」），
   * 早期把它当段落边界，导致 20 处悬念都多断了一段。
   */
  it('以破折号结尾的段落不是被从句子中间劈开的', () => {
    const bad: string[] = []
    for (const n of SCRIPT.nodes) {
      const paras = (n.display ?? '').split('\n')
      for (let i = 0; i < paras.length - 1; i++) {
        if (paras[i].trimEnd().endsWith('—')) bad.push(`#${n.id} 「…${paras[i].slice(-14)}」`)
      }
    }
    expect(bad).toEqual([])
  })
})
