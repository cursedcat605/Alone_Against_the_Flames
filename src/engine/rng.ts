/**
 * 可序列化的伪随机数发生器（mulberry32）。
 *
 * 为什么不用 Math.random：
 *   1. 存档要能复现 —— 种子进存档，读档后连骰点都一样，玩家没法用 SL 刷判定
 *   2. 自动通关测试要能复现 —— 失败时给个种子就能重放整局
 *
 * 为什么状态是裸的 number 而不是 class 实例：
 *   存档是 JSON，class 反序列化后方法会丢。所以这里用
 *   「可变状态对象 + 纯函数」的写法，状态对象本身就是存档里那个 number 的包装。
 */

export interface RngState {
  s: number
}

/** 32 位整数种子；0 会被 mulberry32 变成常量序列，所以替换成 1。 */
export function createRng(seed: number): RngState {
  const s = seed >>> 0
  return { s: s === 0 ? 1 : s }
}

/** [0, 1) */
export function nextFloat(rng: RngState): number {
  let t = (rng.s = (rng.s + 0x6d2b79f5) >>> 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** [0, maxExclusive) 的整数 */
export function nextInt(rng: RngState, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0
  return Math.floor(nextFloat(rng) * maxExclusive)
}

/** 1..sides 的整数 */
export function rollDie(rng: RngState, sides: number): number {
  return nextInt(rng, sides) + 1
}

/** 从数组里随机取一个（rng 为 null 时用 Math.random，仅供 UI 装饰用）。 */
export function pick<T>(rng: RngState, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[nextInt(rng, items.length)]
}

export function shuffle<T>(rng: RngState, items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
