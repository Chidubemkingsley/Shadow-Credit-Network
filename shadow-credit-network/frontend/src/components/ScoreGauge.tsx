import React from 'react'

interface ScoreGaugeProps {
  score: number | null
  label?: string
  size?: number
}

export function ScoreGauge({ score, label = 'Credit Score', size = 200 }: ScoreGaugeProps) {
  const minScore = 300
  const maxScore = 850
  const circumference = 2 * Math.PI * 80
  const percentage = score !== null ? (score - minScore) / (maxScore - minScore) : 0
  const offset = circumference - percentage * circumference * 0.75

  const getColor = (s: number | null) => {
    if (s === null) return '#555577'
    if (s >= 740) return '#00e676'
    if (s >= 670) return '#00b4d8'
    if (s >= 580) return '#ffd600'
    return '#ff1744'
  }

  const getTier = (s: number | null) => {
    if (s === null) return 'Not Computed'
    if (s >= 740) return 'Prime'
    if (s >= 670) return 'Near Prime'
    if (s >= 580) return 'Subprime'
    return 'Deep Subprime'
  }

  const color = getColor(score)

  return (
    <div className="score-gauge">
      <div className="gauge-ring" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200">
          <circle
            className="gauge-ring-bg"
            cx="100"
            cy="100"
            r="80"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeLinecap="round"
          />
          <circle
            className="gauge-ring-fill"
            cx="100"
            cy="100"
            r="80"
            stroke={color}
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="gauge-value">
          <div className="gauge-score" style={{ color }}>{score ?? '—'}</div>
          <div className="gauge-label">{getTier(score)}</div>
          <div className="gauge-range">300 — 850</div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  )
}
