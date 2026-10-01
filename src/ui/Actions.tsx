import { thresholds } from '../engine/names'
import { DIFFICULTY_LABELS, type CheckOffer, type Interaction } from '../engine/types'

interface Props {
  interaction: Interaction
  onRoll: (offer: CheckOffer) => void
  onPush: (offer: CheckOffer) => void
  onChoose: (index: number) => void
  onContinue: () => void
  canPush: (offer: CheckOffer) => boolean
}

/**
 * 「现在能做什么」。
 *
 * 三种按钮的区分很重要，玩家必须一眼看出哪个是掷骰、哪个只是前进：
 *   - 检定：显示技能值与困难/极难阈值，玩家能自己算概率
 *   - 选项：剧情分支
 *   - 继续：唯一出口
 * 内容缺口（blockers）直接摊在界面上，而不是藏在控制台里 —— 这是诚实做法，
 * 也方便边玩边校对剧本。
 */
export default function Actions({
  interaction,
  onRoll,
  onPush,
  onChoose,
  onContinue,
  canPush,
}: Props) {
  const { checks, choices, continueTo, blockers } = interaction

  return (
    <section className="actions">
      {blockers.length > 0 && (
        <div className="blockers">
          {blockers.map((b, i) => (
            <p key={i}>⚠ {b}</p>
          ))}
        </div>
      )}

      {checks.map((offer) => {
        const t = thresholds(offer.target)
        const pushable = canPush(offer)
        return (
          <div className="check-card" key={offer.index}>
            <div className="check-info">
              <div className="check-name">{offer.label}</div>
              <div className="check-thresholds">
                目标值 <strong>{offer.target}</strong>
                <span>困难 ≤ {t.hard}</span>
                <span>极难 ≤ {t.extreme}</span>
              </div>
              {offer.ambiguous && (
                <div className="check-note">
                  本条目有多个检定或分支配对不唯一，掷骰结果不会自动带你去任何地方，请自己选。
                </div>
              )}
            </div>
            <div className="check-buttons">
              <button type="button" className="btn btn-primary" onClick={() => onRoll(offer)}>
                掷骰（{DIFFICULTY_LABELS[offer.difficulty] ?? offer.difficulty}）
              </button>
              <button
                type="button"
                className="btn btn-warn"
                disabled={!pushable}
                title={pushable ? '重掷一次。再失败就按最坏结果处理。' : '战斗与理智检定不能孤注一掷；或者你已经用过了。'}
                onClick={() => onPush(offer)}
              >
                孤注一掷
              </button>
            </div>
          </div>
        )
      })}

      {choices.length > 0 && (
        <ul className="choices">
          {choices.map((c) => (
            <li key={c.index}>
              <button
                type="button"
                className="btn btn-choice"
                disabled={c.to === null}
                onClick={() => onChoose(c.index)}
              >
                <span className="choice-label">{c.label}</span>
                <span className="choice-meta">
                  {c.conditionText && <em>条件：{c.conditionText}</em>}
                  {c.outcome && <em className="outcome">{outcomeText(c.outcome)}</em>}
                  <span className="choice-to">→ {c.to ?? '断链'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {continueTo !== null && (
        <button type="button" className="btn btn-primary btn-continue" onClick={onContinue}>
          继续 →
        </button>
      )}
    </section>
  )
}

function outcomeText(outcome: 'success' | 'failure' | 'push'): string {
  if (outcome === 'success') return '检定成功'
  if (outcome === 'failure') return '检定失败'
  return '孤注一掷'
}
