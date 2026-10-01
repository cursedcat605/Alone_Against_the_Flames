import { useEffect, useRef } from 'react'

import type { LogEntry } from '../engine/types'

interface Props {
  log: LogEntry[]
}

/**
 * 日志。用来回看「刚才那个检定掷了多少」以及「扣血是怎么算的」。
 * 自动滚到底部，但只在用户本来就在底部时才滚，避免打断向上翻阅。
 */
export default function LogPanel({ log }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.addEventListener('scroll', () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    })
  }, [])

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [log])

  return (
    <section className="panel log-panel">
      <header className="panel-head">
        <h2>日志</h2>
        <span className="muted">{log.length} 条</span>
      </header>
      <div className="log-scroll" ref={box}>
        {log.length === 0 && <p className="muted">还没有记录。</p>}
        {log.map((entry) => (
          <div key={entry.seq} className={`log-entry log-${entry.kind}`}>
            <span className="log-seq">{entry.seq}</span>
            {entry.nodeId !== null && <span className="log-node">#{entry.nodeId}</span>}
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
