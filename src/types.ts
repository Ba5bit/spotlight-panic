export type Vec2 = {
  x: number
  y: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type CollectibleKey = Vec2 & {
  collected: boolean
}

export type SpotlightMode = 'mouse' | 'camera'
export type AppScreen = 'landing' | 'teamSetup' | 'game' | 'leaderboard'
export type Floor67Step = 'none' | 'need6' | 'need7' | 'complete'

export type Floor67Symbol = Vec2 & {
  value: '6' | '7'
}

export type GhostState = Vec2 & {
  radius: number
  speed: number
  startX: number
  startY: number
}

export type LevelData = {
  name: string
  playerStart: Vec2
  spotlightRadius: number
  flicker: boolean
  walls: Rect[]
  keys: Vec2[]
  door: Rect
  symbols: Floor67Symbol[]
  ghosts: Array<Vec2 & { speed: number }>
}

export type RitualFlash = Vec2 & {
  timeLeft: number
}

export type LeaderboardEntry = {
  teamName: string
  timeMs: number
  ghostHits: number
  score: number
  rank: string
  createdAt: string
}

export type FlashEffect = {
  color: string
  timeLeft: number
  duration: number
}

export type GameMessageTone = 'cyan' | 'green' | 'red' | 'yellow'

export type GameMessage = {
  text: string
  timeLeft: number
  duration: number
  tone: GameMessageTone
  glitch: boolean
}
