import React from 'react'

interface RiskBadgeProps {
  tier: string
  size?: 'sm' | 'md' | 'lg'
}

export function RiskBadge({ tier, size = 'md' }: RiskBadgeProps) {
  const getClassName = () => {
    switch (tier.toLowerCase()) {
      case 'prime': return 'risk-badge prime'
      case 'near prime': return 'risk-badge near-prime'
      case 'subprime': return 'risk-badge subprime'
      case 'deep subprime': return 'risk-badge deep-subprime'
      default: return 'risk-badge'
    }
  }

  const getIcon = () => {
    switch (tier.toLowerCase()) {
      case 'prime': return '◆'
      case 'near prime': return '◇'
      case 'subprime': return '△'
      case 'deep subprime': return '▽'
      default: return '○'
    }
  }

  return (
    <span className={getClassName()} style={{
      fontSize: size === 'sm' ? 10 : size === 'lg' ? 14 : 12,
      padding: size === 'sm' ? '4px 10px' : size === 'lg' ? '8px 18px' : '6px 14px',
    }}>
      {getIcon()} {tier}
    </span>
  )
}
