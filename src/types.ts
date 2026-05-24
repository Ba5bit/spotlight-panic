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

export type EnemyType = 'chaser' | 'patrol' | 'stalker'

export type GhostState = Vec2 & {
  type: EnemyType
  radius: number
  speed: number
  startX: number
  startY: number
  patrolIndex: number
  pauseTime: number
  waypoints: Vec2[]
}

export type LevelData = {
  name: string
  difficultyLabel: string
  playerStart: Vec2
  spotlightRadius: number
  spotlightRadiusMultiplier: number
  ghostSpeedMultiplier: number
  flicker: boolean
  walls: Rect[]
  keyCount: number
  ghostCount: number
  fakeKeyCount: number
  keySpawns: Vec2[]
  ghostSpawns: Vec2[]
  symbol6Spawns: Vec2[]
  symbol7Spawns: Vec2[]
  fakeKeySpawns: Vec2[]
  door: Rect
  ghosts: Array<
    Vec2 & {
      speed: number
      type: EnemyType
      waypoints?: Vec2[]
    }
  >
}

export type RitualFlash = Vec2 & {
  timeLeft: number
}

export type LeaderboardEntry = {
  teamName: string
  score: number
  completionTime: number
  levelsCleared: number
  ghostHits: number
  fakeKeysTriggered: number
  rank: string
  seed: string
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
