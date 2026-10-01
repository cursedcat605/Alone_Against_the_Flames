import { SCRIPT } from '../engine/content'
import { KNOWN_ORPHANS, KNOWN_UNREACHABLE } from '../engine/gaps'
import { storageAvailable } from '../engine/save'
import type { Settings } from '../engine/save'

interface Props {
  autosaveAvailable: boolean
  settings: Settings
  onNew: () => void
  onContinue: () => void
  onOpenSaves: () => void
  onSettings: (patch: Partial<Settings>) => void
}

export default function Menu({
  autosaveAvailable,
  settings,
  onNew,
  onContinue,
  onOpenSaves,
  onSettings,
}: Props) {
  return (
    <div className="screen menu-screen">
      <div className="menu-card">
        <h1 className="game-title">{SCRIPT.meta.title}</h1>
        <p className="game-sub">
          单人跑团书 · {SCRIPT.meta.system} · {SCRIPT.meta.nodeCount} 个条目
        </p>

        {!storageAvailable() && (
          <p className="warn-box">
            浏览器不允许本地存储（可能开了隐私模式），存档和自动存档都不可用。
            你还是能玩，只是关掉页面就没了 —— 建议改用「导出为文件」。
          </p>
        )}

        <div className="menu-buttons">
          <button type="button" className="btn btn-primary btn-large" onClick={onNew}>
            新的冒险
          </button>
          <button
            type="button"
            className="btn btn-large"
            disabled={!autosaveAvailable}
            title={autosaveAvailable ? '接着上一次自动存档继续' : '还没有自动存档'}
            onClick={onContinue}
          >
            继续上次
          </button>
          <button type="button" className="btn btn-large" onClick={onOpenSaves}>
            存档管理
          </button>
        </div>

        <fieldset className="field settings">
          <legend>设置</legend>
          <label className="inline">
            逐字显示速度
            <input
              type="range"
              min={0}
              max={40}
              step={2}
              value={settings.typewriterMs}
              onChange={(e) => onSettings({ typewriterMs: Number(e.target.value) })}
            />
            <span className="muted small">
              {settings.typewriterMs === 0 ? '关闭（立即显示）' : `${settings.typewriterMs} 毫秒/字`}
            </span>
          </label>
          <label className="flag">
            <input
              type="checkbox"
              checked={settings.showContentWarnings}
              onChange={(e) => onSettings({ showContentWarnings: e.target.checked })}
            />
            显示内容缺口提示（剧本解析发现的断链、无出口等）
          </label>
        </fieldset>

        <p className="muted small footnote">
          规则依据 CoC 7e。原作《向火独行》有 {KNOWN_ORPHANS.length} 个条目在原书中没有入口
          （docx 转纯文本时丢失了跳转），另有一共 {KNOWN_UNREACHABLE.length} 个条目无法抵达。
          这些内容已如实保留，不猜测作者的跳转意图。
        </p>
      </div>
    </div>
  )
}
