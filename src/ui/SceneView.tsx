import { useEffect, useRef, useState } from 'react'

import type { SceneKind } from '../engine/types'

const KIND_LABELS: Record<SceneKind, string> = {
  text: '叙述',
  choice: '抉择',
  check: '检定',
  combat: '战斗',
  ending: '结局',
  dead_end: '断点',
}

const KIND_CLASS: Record<SceneKind, string> = {
  text: 'kind-text',
  choice: 'kind-choice',
  check: 'kind-check',
  combat: 'kind-combat',
  ending: 'kind-ending',
  dead_end: 'kind-dead',
}

interface Props {
  nodeId: number
  kind: SceneKind
  text: string
  speedMs: number
}

/**
 * 正文的逐字显示。
 *
 * 打字机效果必须是「可跳过」的：玩家点一下直接出全文。
 * 否则读第二遍剧情时只能干等，体验非常差。
 */
export default function SceneView({ nodeId, kind, text, speedMs }: Props) {
  const [revealed, setRevealed] = useState(speedMs > 0 ? 0 : text.length)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (speedMs <= 0) {
      setRevealed(text.length)
      return
    }
    setRevealed(0)
    let i = 0
    timer.current = window.setInterval(() => {
      i += 1
      setRevealed(i)
      if (i >= text.length && timer.current !== null) {
        window.clearInterval(timer.current)
        timer.current = null
      }
    }, speedMs)
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current)
      timer.current = null
    }
  }, [text, speedMs])

  const done = revealed >= text.length

  return (
    <article className="scene" onClick={() => setRevealed(text.length)}>
      <header className="scene-head">
        <span className="badge node-badge">#{nodeId}</span>
        <span className={`badge ${KIND_CLASS[kind]}`}>{KIND_LABELS[kind]}</span>
        {!done && <span className="badge hint-badge">点击正文可跳过逐字显示</span>}
      </header>
      <div className="scene-body">
        {done ? (
          <div className="scene-paras">
            {text.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : (
          // 逐字显示时不切段落：用 white-space: pre-line 让换行照样生效，
          // 这样「跳字」和段落排版不会互相打架。
          <div className="scene-paras typing">
            <p>
              {text.slice(0, revealed)}
              <span className="caret" />
            </p>
          </div>
        )}
      </div>
    </article>
  )
}
