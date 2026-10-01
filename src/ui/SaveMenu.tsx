import { useCallback, useEffect, useState } from 'react'

import { ALL_SLOTS, deleteSave, listSaves, type SaveSlotInfo } from '../engine/save'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (slot: number) => void
  onLoad: (slot: number) => void
  readExport: () => string
  loadFromText: (text: string) => void
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SaveMenu({ open, onClose, onSave, onLoad, readExport, loadFromText }: Props) {
  const [slots, setSlots] = useState<(SaveSlotInfo | null)[]>([])
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)

  const refresh = useCallback(() => setSlots(listSaves()), [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  if (!open) return null

  const doExport = () => {
    const text = readExport()
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aaf-save-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>存档</h2>
          <button type="button" className="btn btn-tiny" onClick={onClose}>
            关闭
          </button>
        </header>

        <ul className="slot-list">
          {ALL_SLOTS.map((slot, i) => {
            const info = slots[i] ?? null
            return (
              <li key={slot} className={info ? 'slot filled' : 'slot'}>
                <div className="slot-info">
                  <strong>{info?.label ?? (slot === 0 ? '自动存档' : `存档 ${slot}`)}</strong>
                  {info ? (
                    <span className="muted">
                      {info.charName} · 生命 {info.hp}/{info.hpMax} · 理智 {info.san} · 第 {info.turn} 步 ·
                      条目 #{info.nodeId} · 种子 {info.seed}
                      <br />
                      {fmtDate(info.savedAt)}
                    </span>
                  ) : (
                    <span className="muted">空</span>
                  )}
                </div>
                <div className="slot-buttons">
                  <button type="button" className="btn btn-tiny" onClick={() => { onSave(slot); refresh() }}>
                    存入
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={!info}
                    onClick={() => { onLoad(slot); onClose() }}
                  >
                    读取
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny btn-danger"
                    disabled={!info}
                    onClick={() => { deleteSave(slot); refresh() }}
                  >
                    删除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="modal-foot">
          <button type="button" className="btn btn-tiny" onClick={doExport}>
            导出为文件
          </button>
          <button type="button" className="btn btn-tiny" onClick={() => setShowImport((v) => !v)}>
            {showImport ? '收起导入' : '从文本导入'}
          </button>
        </div>

        {showImport && (
          <div className="import-box">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="把导出的 JSON 粘贴到这里"
              rows={6}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={importText.trim().length === 0}
              onClick={() => { loadFromText(importText); setImportText(''); onClose() }}
            >
              导入并继续
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
