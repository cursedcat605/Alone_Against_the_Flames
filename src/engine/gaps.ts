import overridesRaw from '../../tools/overrides.json?raw'

/**
 * 内容缺口的**唯一登记表**（`tools/overrides.json` 的 `knownGaps`）。
 *
 * 为什么要有这个文件：CLI 校验脚本（`npm run check`）和引擎单测都要判断
 * 「这个问题是已知的，还是新出现的」。如果两处各写一份数字清单，迟早会漂移——
 * 一边修好了、另一边还在放行，或者反过来把真实缺陷当成已知项静默吞掉。
 * 所以两边都读同一份 JSON，测试里不再出现硬编码的节点号。
 *
 * 规则：这里是「原书如此」的清单，不是「测试懒得修」的清单。
 * 每一项都必须能指向源文本里的证据（证据写在 `reasons` 里）。
 */
interface KnownGapsRaw {
  missingNodes: Record<string, string>
  reasons?: Record<string, string>
  orphans: number[]
  unreachable: number[]
  deadEnds: number[]
  noOutlet: Record<string, string>
  endingsWithChecks: { id: number; skills: string[]; reason: string }[]
  singleBranchChecks: Record<string, string>
  convergingBranches: Record<string, string>
}

export const KNOWN_GAPS_RAW: KnownGapsRaw = (
  JSON.parse(overridesRaw) as { knownGaps: KnownGapsRaw }
).knownGaps

export const KNOWN_GAPS = KNOWN_GAPS_RAW

/** 源文本里整条不存在、但被其他条目引用的编号（当前只有 74）。 */
export const KNOWN_MISSING_NODE_IDS: number[] = Object.keys(
  KNOWN_GAPS_RAW.missingNodes,
).map(Number)

/** 零入边条目（原书用「相对跳转」当入口，见 reasons.orphans）。 */
export const KNOWN_ORPHANS: number[] = KNOWN_GAPS_RAW.orphans

/** 从起点走不到的条目。 */
export const KNOWN_UNREACHABLE: number[] = KNOWN_GAPS_RAW.unreachable

/** 源文本缺了出口、引擎会以 interrupted 收尾的条目。 */
export const KNOWN_DEAD_ENDS: number[] = KNOWN_GAPS_RAW.deadEnds

/**
 * 引擎可能中断（interrupted）的条目合集。
 *
 * 中断有两种成因：出边缺失（deadEnds）与跳转到不存在的编号（missingNodes）。
 * 把两者合起来，测试才能断言「中断只发生在已登记的条目上」。
 */
export const KNOWN_INTERRUPTED: number[] = [
  ...KNOWN_DEAD_ENDS,
  ...KNOWN_MISSING_NODE_IDS,
]

/** 非结局、却没有任何出口的条目。当前为空。 */
export const KNOWN_NO_OUTLET: number[] = Object.keys(KNOWN_GAPS_RAW.noOutlet).map(Number)
