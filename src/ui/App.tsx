import { useEffect, useState } from 'react'

import { LEVEL_LABELS } from '../engine/types'
import { sceneById } from '../engine/state'
import Actions from './Actions'
import CharacterPanel from './CharacterPanel'
import CreateScreen from './CreateScreen'
import LogPanel from './LogPanel'
import Menu from './Menu'
import SaveMenu from './SaveMenu'
import SceneView from './SceneView'
import { freshSeed, useGame } from './useGame'

export default function App() {
  const api = useGame()
  const [savesOpen, setSavesOpen] = useState(false)
  const [seed] = useState(() => freshSeed())
  const [sidebar, setSidebar] = useState<'character' | 'log'>('character')

  useEffect(() => {
    if (!api.toast) return
    const t = window.setTimeout(() => api.clearToast(), 4000)
    return () => window.clearTimeout(t)
  }, [api])

  const saves = (
    <SaveMenu
      open={savesOpen}
      onClose={() => setSavesOpen(false)}
      onSave={(slot) => api.saveToSlot(slot)}
      onLoad={(slot) => api.loadFromSlot(slot)}
      readExport={api.readExport}
      loadFromText={api.loadFromText}
    />
  )

  if (api.screen === 'menu') {
    return (
      <>
        <Menu
          autosaveAvailable={true}
          settings={api.settings}
          onNew={api.goCreate}
          onContinue={() => api.loadFromSlot(0)}
          onOpenSaves={() => setSavesOpen(true)}
          onSettings={api.updateSettings}
        />
        {saves}
        {api.toast && <div className="toast">{api.toast}</div>}
      </>
    )
  }

  if (api.screen === 'create' || !api.state || !api.interaction) {
    return (
      <>
        <CreateScreen defaultSeed={seed} onStart={api.start} onBack={api.goMenu} />
        {api.toast && <div className="toast">{api.toast}</div>}
      </>
    )
  }

  const { state, interaction } = api
  const scene = sceneById(state.nodeId)
  const ended = state.ended

  return (
    <div className="screen play-screen">
      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="btn btn-tiny" onClick={api.goMenu}>
            主菜单
          </button>
          <button type="button" className="btn btn-tiny" onClick={() => setSavesOpen(true)}>
            存档
          </button>
        </div>
        <div className="topbar-right">
          <span className="muted small">
            第 {state.turn} 步 · 种子 {state.seed}
          </span>
          {api.autosaveError && <span className="warn-inline">{api.autosaveError}</span>}
          <div className="tabs">
            <button
              type="button"
              className={`btn btn-tiny ${sidebar === 'character' ? 'active' : ''}`}
              onClick={() => setSidebar('character')}
            >
              角色卡
            </button>
            <button
              type="button"
              className={`btn btn-tiny ${sidebar === 'log' ? 'active' : ''}`}
              onClick={() => setSidebar('log')}
            >
              日志
            </button>
          </div>
        </div>
      </header>

      <main className="main-grid">
        <div className="main-col">
          <SceneView
            nodeId={state.nodeId}
            kind={scene?.kind ?? 'text'}
            text={scene?.display || scene?.text || `（条目 ${state.nodeId} 不存在）`}
            speedMs={api.settings.typewriterMs}
          />

          {api.lastCheck && (
            <div className={`roll-result level-${api.lastCheck.resolution.level}`}>
              <span className="roll-summary">{api.lastCheck.summary}</span>
              <span className="roll-detail">
                十位骰 [{api.lastCheck.resolution.roll.tens.join(', ')}] · 个位骰{' '}
                {api.lastCheck.resolution.roll.units} → {api.lastCheck.resolution.roll.value}
                {api.lastCheck.pushed && ' · 孤注一掷'}
                {' · '}
                {LEVEL_LABELS[api.lastCheck.resolution.level]}
              </span>
              {api.lastCheck.destination !== null && (
                <span className="roll-dest">→ 条目 {api.lastCheck.destination}</span>
              )}
            </div>
          )}

          {ended ? (
            <section className={`ending-box ending-${ended.kind}`}>
              <h2>
                {ended.kind === 'ending'
                  ? '【剧终】'
                  : ended.kind === 'death'
                    ? '你死了'
                    : '正文到此中断'}
              </h2>
              <p className="muted">
                {ended.kind === 'ending'
                  ? '故事到这里结束了。你可以回看日志，或者开一局新的。'
                  : ended.kind === 'death'
                    ? '调查员的冒险到此为止。开一局新的，或者读档重来。'
                    : '这一条在原书里没有出口（原始文本缺页）。这不是你的操作失误，可以读档换一条路。'}
              </p>
              <div className="ending-buttons">
                <button type="button" className="btn btn-primary" onClick={api.goCreate}>
                  再来一局
                </button>
                <button type="button" className="btn" onClick={() => setSavesOpen(true)}>
                  读档
                </button>
              </div>
            </section>
          ) : (
            <Actions
              interaction={
                api.settings.showContentWarnings
                  ? interaction
                  : { ...interaction, blockers: [] }
              }
              onRoll={(offer) => api.roll(offer)}
              onPush={(offer) => api.roll(offer, { push: true })}
              onChoose={api.choose}
              onContinue={api.next}
              canPush={api.pushable}
            />
          )}

          {api.creationNotes.length > 0 && (
            <details className="creation-notes">
              <summary>建卡记录（同种子可复现）</summary>
              {api.creationNotes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </details>
          )}
        </div>

        <aside className="side-col">
          {sidebar === 'character' ? (
            <CharacterPanel char={state.char} onEdit={api.editCharacter} />
          ) : (
            <LogPanel log={state.log} />
          )}
        </aside>
      </main>

      {saves}
      {api.toast && <div className="toast">{api.toast}</div>}
    </div>
  )
}
