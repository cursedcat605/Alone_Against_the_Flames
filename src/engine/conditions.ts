/**
 * 剧本条件的求值。
 *
 * 解析器把「如果你的“体型”是40，转到23」转成了结构化对象
 * `{attr:'体型', op:'eq', value:40}`，而不是 `eval("体型==40")`。
 * 结构化描述可以被静态检查（见 validate_script.py），eval 不能。
 */

import { ATTR_BY_LABEL, type Character, type LinkCondition } from './types'

const OP_LABELS: Record<LinkCondition['op'], string> = {
  eq: '=',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
}

/** 取出条件里的属性值；不是已知属性/衍生值时返回 NaN。 */
export function conditionValue(char: Character, attrLabel: string): number {
  const key = ATTR_BY_LABEL[attrLabel]
  if (key) return char.attributes[key]
  if (attrLabel === '幸运') return char.luck
  if (attrLabel === '理智') return char.san
  return Number.NaN
}

export function evalCondition(char: Character, cond: LinkCondition): boolean {
  const value = conditionValue(char, cond.attr)
  if (Number.isNaN(value)) return false
  switch (cond.op) {
    case 'eq':
      return value === cond.value
    case 'gt':
      return value > cond.value
    case 'gte':
      return value >= cond.value
    case 'lt':
      return value < cond.value
    case 'lte':
      return value <= cond.value
    default:
      return false
  }
}

export function describeCondition(cond: LinkCondition): string {
  return `${cond.attr} ${OP_LABELS[cond.op] ?? cond.op} ${cond.value}`
}

export function conditionIsKnown(attrLabel: string): boolean {
  return attrLabel in ATTR_BY_LABEL || attrLabel === '幸运' || attrLabel === '理智'
}
