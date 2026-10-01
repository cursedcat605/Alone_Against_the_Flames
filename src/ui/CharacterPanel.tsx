import { useState } from 'react'
import type { ChangeEvent } from 'react'

import type { Character } from '../engine/types'
import { ATTR_KEYS, ATTR_LABELS } from '../engine/types'
import { thresholds } from '../engine/names'

interface Props {
  char: Character
  onEdit: (patch: Partial<Character>) => void
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="bar-value">
        {value}
        <em>/{max}</em>
      </span>
    </div>
  )
}

/**
 * 角色面板。
 *
 * 「手动修正」不是可选项而是必需项：解析器会把「黑熊的爪击造成 2D6 点伤害」
 * 误判成玩家受伤（见 effects.ts 的说明）。自动化能省 90% 的账，剩下 10%
 * 必须留一个诚实的出口，否则玩家只能干看着血条被扣错。
 */
export default function CharacterPanel({ char, onEdit }: Props) {
  const [editing, setEditing] = useState(false)

  const skills = Object.values(char.skills).sort((a, b) => b.value - a.value)

  const num = (key: keyof Character) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (Number.isFinite(v)) onEdit({ [key]: v } as Partial<Character>)
  }

  return (
    <section className="panel character-panel">
      <header className="panel-head">
        <h2>调查员</h2>
        <button type="button" className="btn btn-tiny" onClick={() => setEditing((v) => !v)}>
          {editing ? '收起修正' : '手动修正'}
        </button>
      </header>

      <div className="char-id">
        <div className="char-name">{char.name}</div>
        <div className="char-sub">
          {char.age} 岁 · {char.era} · {char.occupationName} · CR {char.creditRating}
        </div>
        <div className="char-sub">
          体格 {char.build >= 0 ? `+${char.build}` : char.build} · 伤害加值 {char.db} · 移动 {char.mov}
        </div>
      </div>

      <div className="bars">
        <Bar label="生命" value={char.hp} max={char.hpMax} tone="hp" />
        <Bar label="理智" value={char.san} max={char.sanMax} tone="san" />
        <Bar label="魔法" value={char.mp} max={char.mpMax} tone="mp" />
        <Bar label="幸运" value={char.luck} max={99} tone="luck" />
      </div>

      {(char.majorWound || char.dying || char.unconscious || char.tempInsane || char.indefInsane) && (
        <ul className="conditions">
          {char.majorWound && <li className="cond-bad">重伤</li>}
          {char.unconscious && <li className="cond-bad">昏迷</li>}
          {char.dying && <li className="cond-bad">濒死</li>}
          {char.tempInsane && <li className="cond-bad">临时性疯狂</li>}
          {char.indefInsane && <li className="cond-bad">不定性疯狂</li>}
        </ul>
      )}

      {editing && (
        <div className="edit-grid">
          <label>
            生命
            <input type="number" value={char.hp} onChange={num('hp')} />
          </label>
          <label>
            理智
            <input type="number" value={char.san} onChange={num('san')} />
          </label>
          <label>
            魔法
            <input type="number" value={char.mp} onChange={num('mp')} />
          </label>
          <label>
            幸运
            <input type="number" value={char.luck} onChange={num('luck')} />
          </label>
          <div className="edit-flags">
            {(
              [
                ['majorWound', '重伤'],
                ['unconscious', '昏迷'],
                ['dying', '濒死'],
                ['tempInsane', '临时性疯狂'],
                ['indefInsane', '不定性疯狂'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flag">
                <input
                  type="checkbox"
                  checked={Boolean(char[key])}
                  onChange={(e) => onEdit({ [key]: e.target.checked } as Partial<Character>)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}

      <h3 className="sub-head">属性</h3>
      <ul className="attrs">
        {ATTR_KEYS.map((key) => (
          <li key={key}>
            <span>{ATTR_LABELS[key]}</span>
            <strong>{char.attributes[key]}</strong>
          </li>
        ))}
      </ul>

      <h3 className="sub-head">技能</h3>
      <ul className="skills">
        {skills.map((s) => {
          const t = thresholds(s.value)
          return (
            <li key={s.name} className={s.ticked ? 'ticked' : undefined}>
              <span className="skill-name">
                {s.ticked && <span className="tick-mark" title="本局末可成长一次">✔</span>}
                {s.name}
              </span>
              <span className="skill-value">{s.value}</span>
              <span className="skill-thresh">
                {t.hard}/{t.extreme}
              </span>
            </li>
          )
        })}
      </ul>

      {char.inventory.length > 0 && (
        <>
          <h3 className="sub-head">携带物</h3>
          <ul className="inventory">
            {char.inventory.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
