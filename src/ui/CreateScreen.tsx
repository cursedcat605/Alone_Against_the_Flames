import { useMemo, useState } from 'react'

import { OCCUPATIONS, SCRIPT } from '../engine/content'
import { createRng } from '../engine/rng'
import { createPrebuiltCharacter, createRandomCharacter } from '../engine/character'
import type { CreateOptions } from './useGame'

interface Props {
  defaultSeed: number
  onStart: (opts: CreateOptions) => void
  onBack: () => void
}

/**
 * 建卡界面。
 *
 * M1 只提供「预生成卡」和「自动随机卡」两条路，**不做**手动点数分配。
 * 理由：手动分配的 UI 工作量和规则正确性风险都不小，而它的收益（老玩家微调）
 * 不是 M1 要验证的东西 —— M1 要验证的是「引擎跑得通、剧情接得上」。
 * 手动分配留到 M2，`character.ts` 里的 `distribute` 已经是通用实现，接上 UI 即可。
 */
export default function CreateScreen({ defaultSeed, onStart, onBack }: Props) {
  const [seedText, setSeedText] = useState(String(defaultSeed))
  const [mode, setMode] = useState<'prebuilt' | 'random'>('prebuilt')
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [occupationId, setOccupationId] = useState<number>(0)
  const [preview, setPreview] = useState<string[]>([])

  const seed = useMemo(() => {
    const n = Number(seedText)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultSeed
  }, [seedText, defaultSeed])

  const occupations = useMemo(() => OCCUPATIONS.occupations.filter((o) => o.id > 0), [])

  const start = () => {
    onStart({
      mode,
      seed,
      ...(mode === 'random' && name.trim() ? { name: name.trim() } : {}),
      ...(mode === 'random' && Number(age) > 0 ? { age: Number(age) } : {}),
      ...(mode === 'random' && occupationId > 0 ? { occupationId } : {}),
    })
  }

  /** 用同一个种子重复建卡就能看到「可复现」这件事是真的。 */
  const doPreview = () => {
    if (mode === 'prebuilt') {
      const char = createPrebuiltCharacter()
      setPreview([
        `${char.name}（${char.age} 岁，${char.era}）`,
        `${char.occupationName} · CR ${char.creditRating}`,
        `生命 ${char.hp} · 理智 ${char.san} · 魔法 ${char.mp} · 幸运 ${char.luck} · 移动 ${char.mov}`,
        `属性 ${Object.entries(char.attributes).map(([k, v]) => `${k}${v}`).join(' ')}`,
      ])
      return
    }
    const rng = createRng(seed)
    const { character, notes } = createRandomCharacter(rng, {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(Number(age) > 0 ? { age: Number(age) } : {}),
      ...(occupationId > 0 ? { occupationId } : {}),
    })
    setPreview([
      `${character.name}（${character.age} 岁，${character.era}）`,
      `${character.occupationName} · CR ${character.creditRating} · 体格 ${character.build} · DB ${character.db}`,
      `生命 ${character.hp} · 理智 ${character.san} · 魔法 ${character.mp} · 幸运 ${character.luck} · 移动 ${character.mov}`,
      ...notes,
    ])
  }

  return (
    <div className="screen create-screen">
      <header className="screen-head">
        <button type="button" className="btn btn-tiny" onClick={onBack}>
          ← 返回
        </button>
        <h1>创建调查员</h1>
        <span className="muted">{SCRIPT.meta.title}</span>
      </header>

      <div className="create-form">
        <fieldset className="field">
          <legend>建卡方式</legend>
          <label className="radio">
            <input
              type="radio"
              name="mode"
              checked={mode === 'prebuilt'}
              onChange={() => setMode('prebuilt')}
            />
            使用规则书预生成卡（夏洛特·范德米尔，私家侦探）
          </label>
          <label className="radio">
            <input type="radio" name="mode" checked={mode === 'random'} onChange={() => setMode('random')} />
            自动随机建卡（掷属性 → 年龄调整 → 职业点分配）
          </label>
        </fieldset>

        <fieldset className="field">
          <legend>随机种子</legend>
          <div className="row">
            <input
              className="text-input"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              inputMode="numeric"
            />
            <button
              type="button"
              className="btn btn-tiny"
              onClick={() => setSeedText(String(Math.floor(Math.random() * 0x7fffffff) || 1))}
            >
              换一个
            </button>
          </div>
          <p className="muted small">
            种子会存进存档。同一个种子 + 同样的选择 = 完全一样的掷骰结果，
            也就是说<b>读档不能重掷</b>。
          </p>
        </fieldset>

        {mode === 'random' && (
          <fieldset className="field">
            <legend>可选项（留空则随机）</legend>
            <div className="row">
              <label className="inline">
                姓名
                <input
                  className="text-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="随机"
                />
              </label>
              <label className="inline">
                年龄
                <input
                  className="text-input narrow"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="随机"
                  inputMode="numeric"
                />
              </label>
            </div>
            <label className="inline">
              职业
              <select
                className="text-input"
                value={occupationId}
                onChange={(e) => setOccupationId(Number(e.target.value))}
              >
                <option value={0}>随机</option>
                {occupations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}（CR {o.creditRating.min}-{o.creditRating.max}，{o.skillPoints} 点）
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        )}

        <div className="create-actions">
          <button type="button" className="btn" onClick={doPreview}>
            预览结果
          </button>
          <button type="button" className="btn btn-primary btn-large" onClick={start}>
            开始冒险
          </button>
        </div>

        {preview.length > 0 && (
          <div className="preview">
            {preview.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
