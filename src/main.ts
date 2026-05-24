import './style.css'
import { initAudio, playBeep } from './audio'
import {
  canvasHeight,
  canvasWidth,
  leaderboardStorageKey,
  requiredKeys,
  ritualHoldSeconds,
  ritualSpotlightRange,
} from './constants'
import {
  calculateScore,
  calculateScoreBreakdown,
  getRank,
  loadLeaderboard,
  saveLeaderboardEntry,
} from './leaderboard'
import { levels } from './levels'
import { chooseUnique, createRunSeed, createSeededRandom } from './random'
import type {
  AppScreen,
  CollectibleKey,
  FlashEffect,
  Floor67Step,
  Floor67Symbol,
  GameMessage,
  GameMessageTone,
  GhostState,
  LeaderboardEntry,
  LevelData,
  Rect,
  RitualFlash,
  SpotlightMode,
  Vec2,
} from './types'

let currentLevelIndex = 0
let activeLevel = levels[currentLevelIndex]
let playerStart: Vec2 = { ...activeLevel.playerStart }
let walls: Rect[] = activeLevel.walls
let keys: CollectibleKey[] = activeLevel.keySpawns
  .slice(0, activeLevel.keyCount)
  .map((key) => ({ ...key, collected: false }))
let fakeKeys: CollectibleKey[] = []
let door: Rect = { ...activeLevel.door }
let floor67Symbols: Floor67Symbol[] = [
  { ...activeLevel.symbol6Spawns[0], value: '6' },
  { ...activeLevel.symbol7Spawns[0], value: '7' },
]
let ghosts: GhostState[] = createGhosts(activeLevel, false)

const player = {
  x: playerStart.x,
  y: playerStart.y,
  radius: 11,
  speed: 172,
}

const spotlight = {
  x: 190,
  y: 270,
  targetX: 190,
  targetY: 270,
  radius: 124,
  enabled: true,
}

const input = new Set<string>()
let appScreen: AppScreen = 'landing'
let spotlightMode: SpotlightMode = 'mouse'
let lastFrame = performance.now()
let elapsedSeconds = 0
let keysCollected = 0
let hasWon = false
let finalTime = 0
let levelTransitionTime = 0
let levelTransitionTarget: number | null = null
let levelTransitionMessage = ''
let currentTeamName = 'Team NPC'
let runSeed = createRunSeed()
let replaySeed: string | null = null
let ghostHits = 0
let fakeKeysTriggered = 0
let ghostPanicTime = 0
let lightFlickerDelay = 0
let lightFlickerTime = 0
let lightFlickerRng = createSeededRandom(`${runSeed}:flicker-1`)
let levelsCleared = 0
let latestResult: LeaderboardEntry | null = null
let resultSaved = false
let gameStarted = false
let isPaused = false
let demoMode = false
let floor67Step: Floor67Step = 'none'
let ritualHoldTime = 0
let gameMessage: GameMessage | null = null
let pendingExitMessage = false
let flashEffect: FlashEffect | null = null
let wrong67WarningCooldown = 0
const ritualFlashes: RitualFlash[] = []
let markerDetected = false
let cameraReady = false
let cameraError = ''
let cameraStream: MediaStream | null = null
let cameraRequestInFlight = false

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="game-shell">
    <section class="brand-strip" aria-label="Game title">
      <div>
        <h1>Spotlight Panic</h1>
        <p>One player runs. One player controls the light.</p>
      </div>
      <div class="control-hints" aria-label="Controls">
        <span>Move: WASD / Arrows</span>
        <span>M: Mouse</span>
        <span>C: Camera</span>
        <span>L: Darkness</span>
      </div>
    </section>

    <section id="landing-screen" class="menu-screen">
      <div class="menu-panel landing-panel">
        <h2>Spotlight Panic</h2>
        <p class="menu-subtitle">One player runs. One player controls the light.</p>
        <p>Inspired by classic maze-chase arcade games, rebuilt as a local co-op webcam horror challenge.</p>
        <div class="menu-actions">
          <button id="landing-start" type="button">Start Party Run</button>
          <button id="demo-mode" type="button">Demo Mode</button>
          <button id="landing-leaderboard" type="button">View Leaderboard</button>
        </div>
      </div>
    </section>

    <section id="team-screen" class="menu-screen hidden">
      <div class="menu-panel">
        <h2>Team Setup</h2>
        <label class="team-field" for="team-name">
          <span>Team name</span>
          <input id="team-name" type="text" maxlength="28" placeholder="Team NPC" autocomplete="off" />
        </label>
        <div class="menu-actions">
          <button id="start-run" type="button">Start Run</button>
          <button id="setup-leaderboard" type="button">View Leaderboard</button>
          <button id="setup-menu" type="button">Back to Menu</button>
        </div>
      </div>
    </section>

    <section id="leaderboard-screen" class="menu-screen hidden">
      <div class="menu-panel leaderboard-panel">
        <h2>Leaderboard</h2>
        <div id="leaderboard-list" class="leaderboard-list"></div>
        <div class="menu-actions">
          <button id="leaderboard-next-team" type="button">Next Team</button>
          <button id="leaderboard-menu" type="button">Back to Menu</button>
          <button id="clear-leaderboard" type="button">Clear Leaderboard</button>
        </div>
      </div>
    </section>

    <section id="game-screen" class="play-layout hidden">
      <div class="stage-wrap">
        <div class="hud" aria-label="Game status">
          <span id="time">00:00.0</span>
          <span id="keys">Keys 0 / 3</span>
          <span id="door-state">Door locked</span>
          <span id="light-mode">Light: mouse</span>
          <span id="objective">Collect 3 keys</span>
          <span id="level-status">Level 1 / 3</span>
          <span id="floor-difficulty">Training Floor</span>
          <span id="team-status">Team NPC</span>
          <span id="ghost-hits">Ghost hits 0</span>
          <span id="fake-keys">Fake keys 0</span>
          <span id="marker-hud">Marker lost</span>
          <span id="seed-hud">Seed -----</span>
          <span id="controls-hud">WASD/Arrows - P pause - M mouse - C camera - L darkness</span>
          <button id="pause-button" type="button" class="hud-button">Pause</button>
        </div>
        <canvas id="game" width="${canvasWidth}" height="${canvasHeight}" aria-label="Spotlight Panic game board"></canvas>
        <canvas id="camera-analysis" class="analysis-canvas" width="160" height="90" aria-hidden="true"></canvas>
        <div id="win-screen" class="win-screen hidden" role="status" aria-live="polite">
          <strong>You escaped the panic.</strong>
          <span id="final-time">Completion time: 00:00.0</span>
          <span id="final-team">Team NPC</span>
          <span id="final-score">Score: 0</span>
          <span id="final-rank">Rank: NPC in the Dark</span>
          <span id="final-ghosts">Ghost hits: 0</span>
          <span id="final-fakes">Fake keys: 0</span>
          <span id="final-breakdown">20000 base - 0 time - 0 ghost - 0 fake + 0 levels</span>
          <span id="final-seed">Seed: -----</span>
          <div class="win-actions">
            <button id="next-team" type="button">Next Team</button>
            <button id="replay-seed" type="button">Replay Same Seed</button>
            <button id="win-leaderboard" type="button">View Leaderboard</button>
            <button id="win-menu" type="button">Back to Menu</button>
            <button id="restart" type="button">Run again</button>
          </div>
        </div>
        <div id="calibration-screen" class="calibration-screen" role="dialog" aria-modal="true">
          <strong>Hold a bright phone screen or white object in front of the webcam.</strong>
          <span id="camera-status">CAMERA OFF</span>
          <span id="marker-status">MARKER LOST</span>
          <span id="camera-detail">Camera starting...</span>
          <div class="calibration-actions">
            <button id="start-mouse" type="button">Start With Mouse</button>
            <button id="start-camera" type="button">Start With Camera</button>
            <button id="retry-camera" type="button">Retry camera</button>
          </div>
        </div>
      </div>

      <aside class="leaderboard score-panel" aria-label="Score calculator">
        <div class="camera-panel" aria-label="Webcam preview panel">
          <h2>Camera</h2>
          <video id="camera-preview" class="camera-preview" autoplay muted playsinline aria-label="Webcam preview"></video>
          <p>Mirrored preview. Move the bright marker the same way you want the spotlight to move.</p>
        </div>
        <h2>Score Calculator</h2>
        <div class="score-total">
          <span>Projected score</span>
          <strong id="score-current">10000</strong>
        </div>
        <ol>
          <li><span>Base score</span><strong id="score-base">+20000</strong></li>
          <li><span>Time penalty</span><strong id="score-time">-0</strong></li>
          <li><span>Ghost hits</span><strong id="score-ghost">-0</strong></li>
          <li><span>Fake keys</span><strong id="score-fake">-0</strong></li>
          <li><span>Levels cleared</span><strong id="score-levels">+0</strong></li>
          <li><span>Floor 67 ritual</span><strong id="score-67">+0</strong></li>
          <li><span>No-hit bonus</span><strong id="score-no-hit">+1000</strong></li>
          <li><span>No-fake bonus</span><strong id="score-no-fake">+500</strong></li>
          <li><span>Current rank</span><strong id="score-rank">Six Seven Certified</strong></li>
        </ol>
      </aside>
    </section>
  </main>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const landingScreen = document.querySelector<HTMLElement>('#landing-screen')!
const teamScreen = document.querySelector<HTMLElement>('#team-screen')!
const gameScreen = document.querySelector<HTMLElement>('#game-screen')!
const leaderboardScreen = document.querySelector<HTMLElement>('#leaderboard-screen')!
const teamNameInput = document.querySelector<HTMLInputElement>('#team-name')!
const timeEl = document.querySelector<HTMLSpanElement>('#time')!
const keysEl = document.querySelector<HTMLSpanElement>('#keys')!
const doorStateEl = document.querySelector<HTMLSpanElement>('#door-state')!
const lightModeEl = document.querySelector<HTMLSpanElement>('#light-mode')!
const objectiveEl = document.querySelector<HTMLSpanElement>('#objective')!
const levelStatusEl = document.querySelector<HTMLSpanElement>('#level-status')!
const floorDifficultyEl = document.querySelector<HTMLSpanElement>('#floor-difficulty')!
const teamStatusEl = document.querySelector<HTMLSpanElement>('#team-status')!
const ghostHitsEl = document.querySelector<HTMLSpanElement>('#ghost-hits')!
const fakeKeysEl = document.querySelector<HTMLSpanElement>('#fake-keys')!
const markerHudEl = document.querySelector<HTMLSpanElement>('#marker-hud')!
const seedHudEl = document.querySelector<HTMLSpanElement>('#seed-hud')!
const controlsHudEl = document.querySelector<HTMLSpanElement>('#controls-hud')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-button')!
const winScreen = document.querySelector<HTMLDivElement>('#win-screen')!
const calibrationScreen = document.querySelector<HTMLDivElement>('#calibration-screen')!
const markerStatusEl = document.querySelector<HTMLSpanElement>('#marker-status')!
const cameraStatusEl = document.querySelector<HTMLSpanElement>('#camera-status')!
const cameraDetailEl = document.querySelector<HTMLSpanElement>('#camera-detail')!
const finalTimeEl = document.querySelector<HTMLSpanElement>('#final-time')!
const finalTeamEl = document.querySelector<HTMLSpanElement>('#final-team')!
const finalScoreEl = document.querySelector<HTMLSpanElement>('#final-score')!
const finalRankEl = document.querySelector<HTMLSpanElement>('#final-rank')!
const finalGhostsEl = document.querySelector<HTMLSpanElement>('#final-ghosts')!
const finalFakesEl = document.querySelector<HTMLSpanElement>('#final-fakes')!
const finalBreakdownEl = document.querySelector<HTMLSpanElement>('#final-breakdown')!
const finalSeedEl = document.querySelector<HTMLSpanElement>('#final-seed')!
const scoreCurrentEl = document.querySelector<HTMLElement>('#score-current')!
const scoreBaseEl = document.querySelector<HTMLElement>('#score-base')!
const scoreTimeEl = document.querySelector<HTMLElement>('#score-time')!
const scoreGhostEl = document.querySelector<HTMLElement>('#score-ghost')!
const scoreFakeEl = document.querySelector<HTMLElement>('#score-fake')!
const scoreLevelsEl = document.querySelector<HTMLElement>('#score-levels')!
const score67El = document.querySelector<HTMLElement>('#score-67')!
const scoreNoHitEl = document.querySelector<HTMLElement>('#score-no-hit')!
const scoreNoFakeEl = document.querySelector<HTMLElement>('#score-no-fake')!
const scoreRankEl = document.querySelector<HTMLElement>('#score-rank')!
const restartButton = document.querySelector<HTMLButtonElement>('#restart')!
const landingStartButton = document.querySelector<HTMLButtonElement>('#landing-start')!
const demoModeButton = document.querySelector<HTMLButtonElement>('#demo-mode')!
const landingLeaderboardButton = document.querySelector<HTMLButtonElement>('#landing-leaderboard')!
const startRunButton = document.querySelector<HTMLButtonElement>('#start-run')!
const setupLeaderboardButton = document.querySelector<HTMLButtonElement>('#setup-leaderboard')!
const setupMenuButton = document.querySelector<HTMLButtonElement>('#setup-menu')!
const nextTeamButton = document.querySelector<HTMLButtonElement>('#next-team')!
const replaySeedButton = document.querySelector<HTMLButtonElement>('#replay-seed')!
const winLeaderboardButton = document.querySelector<HTMLButtonElement>('#win-leaderboard')!
const winMenuButton = document.querySelector<HTMLButtonElement>('#win-menu')!
const leaderboardNextTeamButton = document.querySelector<HTMLButtonElement>('#leaderboard-next-team')!
const leaderboardMenuButton = document.querySelector<HTMLButtonElement>('#leaderboard-menu')!
const clearLeaderboardButton = document.querySelector<HTMLButtonElement>('#clear-leaderboard')!
const leaderboardList = document.querySelector<HTMLDivElement>('#leaderboard-list')!
const startMouseButton = document.querySelector<HTMLButtonElement>('#start-mouse')!
const startCameraButton = document.querySelector<HTMLButtonElement>('#start-camera')!
const retryCameraButton = document.querySelector<HTMLButtonElement>('#retry-camera')!
const cameraPreview = document.querySelector<HTMLVideoElement>('#camera-preview')!
const analysisCanvas = document.querySelector<HTMLCanvasElement>('#camera-analysis')!

if (!canvas) {
  throw new Error('Canvas element could not be found.')
}

const renderingContext = canvas.getContext('2d')

if (!renderingContext) {
  throw new Error('Canvas could not be initialized.')
}

const ctx = renderingContext
const darknessCanvas = document.createElement('canvas')
darknessCanvas.width = canvasWidth
darknessCanvas.height = canvasHeight
const darknessContext = darknessCanvas.getContext('2d')
const cameraAnalysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true })

if (!darknessContext) {
  throw new Error('Darkness canvas could not be initialized.')
}

if (!cameraAnalysisContext) {
  throw new Error('Camera analysis canvas could not be initialized.')
}

const darknessCtx = darknessContext
const analysisContext = cameraAnalysisContext

window.addEventListener('keydown', (event) => {
  input.add(event.key.toLowerCase())

  const key = event.key.toLowerCase()

  if (key === 'l') {
    spotlight.enabled = !spotlight.enabled
  }

  if (key === 'm') {
    setSpotlightMode('mouse')
  }

  if (key === 'c') {
    setSpotlightMode('camera')
    if (!cameraReady) {
      requestCamera()
    }
  }

  if (key === 'r' && hasWon) {
    resetGame()
  }

  if (key === 'p' && appScreen === 'game' && gameStarted && !hasWon) {
    togglePause()
  }
})

window.addEventListener('keyup', (event) => {
  input.delete(event.key.toLowerCase())
})

canvas.addEventListener('mousemove', (event) => {
  if (spotlightMode !== 'mouse') {
    return
  }

  const bounds = canvas.getBoundingClientRect()
  spotlight.targetX = ((event.clientX - bounds.left) / bounds.width) * canvasWidth
  spotlight.targetY = ((event.clientY - bounds.top) / bounds.height) * canvasHeight
})

landingStartButton.addEventListener('click', () => {
  demoMode = false
  showScreen('teamSetup')
  teamNameInput.focus()
})
demoModeButton.addEventListener('click', () => {
  beginDemoMode()
})
landingLeaderboardButton.addEventListener('click', () => {
  showScreen('leaderboard')
})
setupLeaderboardButton.addEventListener('click', () => {
  showScreen('leaderboard')
})
setupMenuButton.addEventListener('click', () => {
  showScreen('landing')
})
startRunButton.addEventListener('click', beginRunFromSetup)
teamNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    beginRunFromSetup()
  }
})
restartButton.addEventListener('click', resetGame)
pauseButton.addEventListener('click', togglePause)
nextTeamButton.addEventListener('click', () => {
  showScreen('teamSetup')
  teamNameInput.select()
})
replaySeedButton.addEventListener('click', () => {
  replaySeed = runSeed
  resetGame()
  showScreen('game')
})
winLeaderboardButton.addEventListener('click', () => {
  showScreen('leaderboard')
})
winMenuButton.addEventListener('click', () => {
  showScreen('landing')
})
leaderboardNextTeamButton.addEventListener('click', () => {
  showScreen('teamSetup')
  teamNameInput.select()
})
leaderboardMenuButton.addEventListener('click', () => {
  showScreen('landing')
})
clearLeaderboardButton.addEventListener('click', () => {
  localStorage.removeItem(leaderboardStorageKey)
  renderLeaderboard()
})
leaderboardList.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) {
    return
  }

  const seed = target.dataset.seed
  if (!seed) {
    return
  }

  replaySeed = seed
  currentTeamName = 'Replay Team'
  demoMode = false
  resetGame()
  showScreen('game')
})
startMouseButton.addEventListener('click', () => {
  startGameplay('mouse')
})
startCameraButton.addEventListener('click', async () => {
  if (!cameraReady) {
    await requestCamera()
  }

  startGameplay(cameraReady ? 'camera' : 'mouse')
})
retryCameraButton.addEventListener('click', requestCamera)

requestCamera()
window.setInterval(analyzeCameraFrame, 100)
showScreen('landing')

function showScreen(screen: AppScreen) {
  appScreen = screen
  landingScreen.classList.toggle('hidden', screen !== 'landing')
  teamScreen.classList.toggle('hidden', screen !== 'teamSetup')
  gameScreen.classList.toggle('hidden', screen !== 'game')
  leaderboardScreen.classList.toggle('hidden', screen !== 'leaderboard')

  if (screen !== 'game') {
    gameStarted = false
    isPaused = false
  }

  if (screen === 'leaderboard') {
    renderLeaderboard()
  }
}

function beginRunFromSetup() {
  const trimmedName = teamNameInput.value.trim()
  currentTeamName = trimmedName === '' ? 'Team NPC' : trimmedName
  demoMode = false
  resetGame()
  showScreen('game')
}

function beginDemoMode() {
  currentTeamName = 'Demo Team'
  demoMode = true
  resetGame()
  showScreen('game')
  startGameplay('mouse')
  showMessage('DEMO MODE', 1.2, 'cyan')
}

function createResultEntry() {
  const completionTime = Math.round(finalTime * 1000)
  const score = calculateScore(
    completionTime,
    levelsCleared,
    ghostHits,
    fakeKeysTriggered,
    floor67Step === 'complete',
  )

  return {
    teamName: currentTeamName,
    score,
    completionTime,
    levelsCleared,
    ghostHits,
    fakeKeysTriggered,
    rank: getRank(score),
    seed: runSeed,
    createdAt: new Date().toISOString(),
  }
}

function formatResultTime(timeMs: number) {
  return formatTime(timeMs / 1000)
}

function getScoreBreakdownText(completionTime: number) {
  const breakdown = calculateScoreBreakdown(
    completionTime,
    levelsCleared,
    ghostHits,
    fakeKeysTriggered,
    floor67Step === 'complete',
  )

  return `${breakdown.baseScore} base - ${breakdown.timePenalty} time - ${breakdown.ghostPenalty} ghost - ${breakdown.fakeKeyPenalty} fake + ${breakdown.levelBonus} levels + ${breakdown.floor67Bonus} ritual + ${breakdown.noGhostBonus} no-hit + ${breakdown.noFakeKeyBonus} clean keys`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function saveWinResult() {
  if (resultSaved) {
    return
  }

  latestResult = createResultEntry()
  saveLeaderboardEntry(latestResult)
  resultSaved = true

  finalTeamEl.textContent = latestResult.teamName
  finalTimeEl.textContent = `Completion time: ${formatResultTime(latestResult.completionTime)}`
  finalScoreEl.textContent = `Score: ${latestResult.score}`
  finalRankEl.textContent = `Rank: ${latestResult.rank}`
  finalGhostsEl.textContent = `Ghost hits: ${latestResult.ghostHits}`
  finalFakesEl.textContent = `Fake keys: ${latestResult.fakeKeysTriggered}`
  finalBreakdownEl.textContent = getScoreBreakdownText(latestResult.completionTime)
  finalSeedEl.textContent = `Seed: ${latestResult.seed}`
}

function updateScoreCalculator() {
  const timeMs = Math.round((hasWon ? finalTime : elapsedSeconds) * 1000)
  const breakdown = calculateScoreBreakdown(
    timeMs,
    levelsCleared,
    ghostHits,
    fakeKeysTriggered,
    floor67Step === 'complete',
  )

  scoreCurrentEl.textContent = breakdown.score.toString()
  scoreBaseEl.textContent = `+${breakdown.baseScore}`
  scoreTimeEl.textContent = `-${breakdown.timePenalty}`
  scoreGhostEl.textContent = `-${breakdown.ghostPenalty}`
  scoreFakeEl.textContent = `-${breakdown.fakeKeyPenalty}`
  scoreLevelsEl.textContent = `+${breakdown.levelBonus}`
  score67El.textContent = `+${breakdown.floor67Bonus}`
  scoreNoHitEl.textContent = `+${breakdown.noGhostBonus}`
  scoreNoFakeEl.textContent = `+${breakdown.noFakeKeyBonus}`
  scoreRankEl.textContent = getRank(breakdown.score)
}

function renderLeaderboard() {
  const entries = loadLeaderboard().slice(0, 10)

  if (entries.length === 0) {
    leaderboardList.innerHTML = `<p class="empty-leaderboard">No runs yet. The dark is waiting.</p>`
    return
  }

  leaderboardList.innerHTML = `
    <ol>
      ${entries
        .map(
          (entry, index) => `
            <li>
              <span class="leaderboard-place">#${index + 1}</span>
              <span class="leaderboard-team">${escapeHtml(entry.teamName)}</span>
              <span>${formatResultTime(entry.completionTime)}</span>
              <span>${entry.ghostHits} hits</span>
              <span>${entry.fakeKeysTriggered} fake</span>
              <span>${entry.seed}</span>
              <strong>${entry.score}</strong>
              <span>${escapeHtml(entry.rank)}</span>
              <button type="button" data-seed="${escapeHtml(entry.seed)}">Replay Same Seed</button>
            </li>
          `,
        )
        .join('')}
    </ol>
  `
}

function createGhosts(
  level: LevelData,
  isDemo: boolean,
  ghostSpawns = level.ghostSpawns.slice(0, level.ghostCount),
) {
  return ghostSpawns.map((spawn, index) => {
    const template = level.ghosts[index % level.ghosts.length]
    const tunedSpeed = template.speed * level.ghostSpeedMultiplier
    const baseSpeed = isDemo ? Math.max(18, tunedSpeed * 0.8) : tunedSpeed
    const waypoints = template.waypoints?.length
      ? template.waypoints.map((waypoint) => ({ ...waypoint }))
      : [
          { x: spawn.x, y: spawn.y },
          { x: spawn.x + 96, y: spawn.y },
        ]

    return {
      x: spawn.x,
      y: spawn.y,
      startX: spawn.x,
      startY: spawn.y,
      type: template.type,
      radius: 16,
      speed: baseSpeed,
      patrolIndex: 0,
      pauseTime: 0,
      waypoints,
    }
  })
}

function getLevelSpotlightRadius(level: LevelData) {
  return level.spotlightRadius * level.spotlightRadiusMultiplier
}

function scheduleNextLightFlicker() {
  lightFlickerDelay = 8 + lightFlickerRng() * 4
}

function randomizeLevel(level: LevelData, levelIndex: number) {
  const rng = createSeededRandom(`${runSeed}:level-${levelIndex + 1}`)
  const usedKeys = new Set<string>()
  const chosenKeys = chooseUnique(level.keySpawns, level.keyCount, rng, usedKeys)
  const [symbol6] = chooseUnique(level.symbol6Spawns, 1, rng, usedKeys)
  const [symbol7] = chooseUnique(level.symbol7Spawns, 1, rng, usedKeys)
  const chosenGhosts = chooseUnique(level.ghostSpawns, level.ghostCount, rng, usedKeys)
  const chosenFakeKeys = chooseUnique(level.fakeKeySpawns, level.fakeKeyCount, rng, usedKeys)

  return {
    fakeKeys: chosenFakeKeys,
    ghostSpawns: chosenGhosts,
    keys: chosenKeys,
    symbols: [
      { ...symbol6, value: '6' as const },
      { ...symbol7, value: '7' as const },
    ],
  }
}

function loadLevel(levelIndex: number) {
  currentLevelIndex = levelIndex
  activeLevel = levels[currentLevelIndex]
  const placement = randomizeLevel(activeLevel, currentLevelIndex)
  lightFlickerRng = createSeededRandom(`${runSeed}:flicker-${currentLevelIndex + 1}`)
  lightFlickerTime = 0
  scheduleNextLightFlicker()

  playerStart = { ...activeLevel.playerStart }
  walls = activeLevel.walls
  keys = placement.keys.map((key) => ({ ...key, collected: false }))
  fakeKeys = placement.fakeKeys.map((key) => ({ ...key, collected: false }))
  door = { ...activeLevel.door }
  floor67Symbols = placement.symbols
  ghosts = createGhosts(activeLevel, demoMode, placement.ghostSpawns)
  spotlight.radius = getLevelSpotlightRadius(activeLevel)
  spotlight.x = playerStart.x + 124
  spotlight.y = playerStart.y
  spotlight.targetX = spotlight.x
  spotlight.targetY = spotlight.y
  resetLevelState()
}

function resetLevelState() {
  player.x = playerStart.x
  player.y = playerStart.y
  keysCollected = 0
  floor67Step = 'none'
  ritualHoldTime = 0
  pendingExitMessage = false
  wrong67WarningCooldown = 0
  ritualFlashes.length = 0
  ghosts.forEach((ghost) => {
    ghost.x = ghost.startX
    ghost.y = ghost.startY
  })
}

function resetGame() {
  currentLevelIndex = 0
  runSeed = replaySeed ?? createRunSeed()
  replaySeed = null
  elapsedSeconds = 0
  ghostHits = 0
  fakeKeysTriggered = 0
  ghostPanicTime = 0
  levelsCleared = 0
  hasWon = false
  finalTime = 0
  levelTransitionTime = 0
  levelTransitionTarget = null
  levelTransitionMessage = ''
  latestResult = null
  resultSaved = false
  isPaused = false
  gameMessage = null
  flashEffect = null
  loadLevel(0)
  lastFrame = performance.now()
  winScreen.classList.add('hidden')
  calibrationScreen.classList.remove('hidden')
}

function startGameplay(mode: SpotlightMode) {
  setSpotlightMode(mode)
  gameStarted = true
  isPaused = false
  lastFrame = performance.now()
  calibrationScreen.classList.add('hidden')
  initAudio()
}

function togglePause() {
  if (appScreen !== 'game' || !gameStarted || hasWon) {
    return
  }

  isPaused = !isPaused
  pauseButton.textContent = isPaused ? 'Resume' : 'Pause'
  showMessage(isPaused ? 'PAUSED' : 'RESUME', 0.5, 'cyan')
}

function showMessage(
  text: string,
  seconds = 1.15,
  tone: GameMessageTone = 'cyan',
  glitch = false,
) {
  gameMessage = {
    text,
    timeLeft: seconds,
    duration: seconds,
    tone,
    glitch,
  }
}

function triggerFlash(color: string, duration = 0.28) {
  flashEffect = {
    color,
    duration,
    timeLeft: duration,
  }
}

async function requestCamera() {
  if (cameraRequestInFlight) {
    return
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraReady = false
    cameraError = 'Camera API unavailable. Mouse fallback ready.'
    setSpotlightMode('mouse')
    updateCameraStatus()
    return
  }

  try {
    cameraRequestInFlight = true
    cameraError = ''
    cameraDetailEl.textContent = 'Requesting camera permission...'

    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        facingMode: 'user',
      },
      audio: false,
    })
    cameraPreview.srcObject = cameraStream
    await cameraPreview.play()
    cameraReady = true
    updateCameraStatus()
  } catch (error) {
    cameraReady = false
    cameraError = error instanceof Error ? error.message : 'Webcam failed. Mouse fallback ready.'
    setSpotlightMode('mouse')
    updateCameraStatus()
  } finally {
    cameraRequestInFlight = false
  }
}

function setSpotlightMode(mode: SpotlightMode) {
  spotlightMode = mode
  updateCameraStatus()
}

function updateCameraStatus() {
  cameraStatusEl.textContent = cameraReady ? 'CAMERA ON' : 'CAMERA OFF'
  cameraStatusEl.classList.toggle('detected', cameraReady)
  markerStatusEl.textContent = markerDetected ? 'MARKER DETECTED' : 'MARKER LOST'
  markerStatusEl.classList.toggle('detected', markerDetected)
  lightModeEl.textContent = `Mode ${spotlightMode.toUpperCase()}`

  if (cameraReady) {
    cameraDetailEl.textContent =
      spotlightMode === 'camera' ? 'Camera spotlight active.' : 'Camera ready. Press C to use it.'
    return
  }

  cameraDetailEl.textContent = cameraError || 'Camera starting...'
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

// Webcam tracking: sample the video every 100ms, find near-white pixels, weight the
// brightest ones most, and stretch the camera range so edge movement reaches the map edges.
function analyzeCameraFrame() {
  if (!cameraReady || cameraPreview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    markerDetected = false
    updateCameraStatus()
    return
  }

  const width = analysisCanvas.width
  const height = analysisCanvas.height
  analysisContext.save()
  analysisContext.translate(width, 0)
  analysisContext.scale(-1, 1)
  analysisContext.drawImage(cameraPreview, 0, 0, width, height)
  analysisContext.restore()

  const frame = analysisContext.getImageData(0, 0, width, height)
  let brightPixels = 0
  let weightedX = 0
  let weightedY = 0
  let totalWeight = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const red = frame.data[index]
      const green = frame.data[index + 1]
      const blue = frame.data[index + 2]
      const brightness = (red + green + blue) / 3
      const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue)

      if (brightness > 238 && red > 228 && green > 228 && blue > 228 && colorSpread < 26) {
        const weight = Math.max(1, brightness - 232)
        brightPixels += 1
        totalWeight += weight
        weightedX += x * weight
        weightedY += y * weight
      }
    }
  }

  markerDetected = brightPixels > 5 && totalWeight > 0

  if (markerDetected && spotlightMode === 'camera') {
    const averageX = weightedX / totalWeight
    const averageY = weightedY / totalWeight
    const normalizedX = clamp((averageX - width * 0.08) / (width * 0.84), 0, 1)
    const normalizedY = clamp((averageY - height * 0.08) / (height * 0.84), 0, 1)

    spotlight.targetX = normalizedX * canvasWidth
    spotlight.targetY = normalizedY * canvasHeight
  }

  updateCameraStatus()
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const tenths = Math.floor((totalSeconds % 1) * 10)

  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${tenths}`
}

function circleHitsRect(circle: Vec2 & { radius: number }, rect: Rect) {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width))
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height))
  const distanceX = circle.x - nearestX
  const distanceY = circle.y - nearestY

  return distanceX * distanceX + distanceY * distanceY < circle.radius * circle.radius
}

function circlesOverlap(
  first: Vec2 & { radius: number },
  second: Vec2 & { radius: number },
) {
  const distanceX = first.x - second.x
  const distanceY = first.y - second.y
  const minDistance = first.radius + second.radius

  return distanceX * distanceX + distanceY * distanceY < minDistance * minDistance
}

function hitsAnyWall(circle: Vec2 & { radius: number }) {
  return walls.some((wall) => circleHitsRect(circle, wall))
}

// Collision: move one axis at a time so sliding along rectangular walls feels stable.
function movePlayer(delta: Vec2) {
  player.x += delta.x
  if (hitsAnyWall(player)) {
    player.x -= delta.x
  }

  player.y += delta.y
  if (hitsAnyWall(player)) {
    player.y -= delta.y
  }
}

function respawnPlayerWithPenalty() {
  elapsedSeconds += 5
  ghostHits += 1
  showMessage('GHOST HIT: +5s', 1, 'red')
  triggerFlash('rgba(255, 25, 61, 0.34)', 0.32)
  playBeep(120, 0.18, 'sawtooth')
  player.x = playerStart.x
  player.y = playerStart.y
  ghosts.forEach((ghost) => {
    ghost.x = ghost.startX
    ghost.y = ghost.startY
    ghost.pauseTime = 0
    ghost.patrolIndex = 0
  })
}

function triggerFakeKeyPenalty() {
  elapsedSeconds += 5
  fakeKeysTriggered += 1
  ghostPanicTime = 5
  showMessage('FAKE KEY. WEAK AURA.', 1.1, 'red', true)
  triggerFlash('rgba(255, 25, 61, 0.34)', 0.32)
  playBeep(170, 0.16, 'sawtooth')
}

function isSpotlightOnGhost(ghost: GhostState) {
  const distanceX = spotlight.x - ghost.x
  const distanceY = spotlight.y - ghost.y

  return Math.hypot(distanceX, distanceY) <= spotlight.radius * 0.72
}

function moveGhostToward(ghost: GhostState, target: Vec2, speed: number, deltaSeconds: number) {
  const directionX = target.x - ghost.x
  const directionY = target.y - ghost.y
  const distance = Math.hypot(directionX, directionY)
  const riskSpeed = ghostPanicTime > 0 ? speed * 1.35 : speed

  if (distance <= 0) {
    return
  }

  ghost.x += (directionX / distance) * riskSpeed * deltaSeconds
  ghost.y += (directionY / distance) * riskSpeed * deltaSeconds
}

// Chaser: direct pressure enemy. It always heads for the player, but the spotlight slows it.
function updateChaserGhost(ghost: GhostState, spotlighted: boolean, deltaSeconds: number) {
  const speed = spotlighted ? ghost.speed * 0.42 : ghost.speed
  moveGhostToward(ghost, player, speed, deltaSeconds)
}

// Patrol: route blocker. It follows waypoints and pauses briefly whenever the spotlight hits it.
function updatePatrolGhost(ghost: GhostState, spotlighted: boolean, deltaSeconds: number) {
  if (spotlighted) {
    ghost.pauseTime = Math.max(ghost.pauseTime, 0.35)
  }

  ghost.pauseTime = Math.max(0, ghost.pauseTime - deltaSeconds)
  if (ghost.pauseTime > 0 || ghost.waypoints.length === 0) {
    return
  }

  const target = ghost.waypoints[ghost.patrolIndex % ghost.waypoints.length]
  if (Math.hypot(target.x - ghost.x, target.y - ghost.y) < 8) {
    ghost.patrolIndex = (ghost.patrolIndex + 1) % ghost.waypoints.length
  }

  moveGhostToward(ghost, target, ghost.speed, deltaSeconds)
}

// Stalker: light-check enemy. It advances only in darkness and freezes under the spotlight.
function updateStalkerGhost(ghost: GhostState, spotlighted: boolean, deltaSeconds: number) {
  if (spotlighted) {
    return
  }

  moveGhostToward(ghost, player, ghost.speed, deltaSeconds)
}

function updateGhost(ghost: GhostState, deltaSeconds: number) {
  const spotlighted = isSpotlightOnGhost(ghost)

  if (ghost.type === 'patrol') {
    updatePatrolGhost(ghost, spotlighted, deltaSeconds)
    return
  }

  if (ghost.type === 'stalker') {
    updateStalkerGhost(ghost, spotlighted, deltaSeconds)
    return
  }

  updateChaserGhost(ghost, spotlighted, deltaSeconds)
}

function isDoorOpen() {
  return floor67Step === 'complete'
}

function getObjectiveText() {
  if (keysCollected < requiredKeys) {
    return 'Collect 3 keys'
  }

  if (floor67Step === 'need6') {
    return 'Find 6 with the spotlight'
  }

  if (floor67Step === 'need7') {
    return 'Find 7 with the spotlight'
  }

  return 'Escape through the door'
}

function getRitualSymbol(value: '6' | '7') {
  return floor67Symbols.find((symbol) => symbol.value === value)!
}

function isSpotlightOnSymbol(symbol: Floor67Symbol) {
  const distanceX = spotlight.x - symbol.x
  const distanceY = spotlight.y - symbol.y

  return Math.hypot(distanceX, distanceY) <= ritualSpotlightRange
}

function showRitualMessage(message: string, seconds = 1.35) {
  showMessage(message, seconds, message.includes('WEAK') ? 'red' : 'yellow', true)
}

function activateRitualSymbol(symbol: Floor67Symbol) {
  ritualFlashes.push({ x: symbol.x, y: symbol.y, timeLeft: 0.45 })
  ritualHoldTime = 0

  if (symbol.value === '6') {
    floor67Step = 'need7'
    showRitualMessage('NOW FIND SEVEN', 1)
    return
  }

  floor67Step = 'complete'
  showRitualMessage('SIX SEVEN CERTIFIED', 1.8)
  pendingExitMessage = true
  triggerFlash('rgba(35, 255, 145, 0.34)', 0.42)
  playBeep(880, 0.18, 'triangle')
}

function updateFloor67Ritual(deltaSeconds: number) {
  if (keysCollected === requiredKeys && floor67Step === 'none') {
    floor67Step = 'need6'
    ritualHoldTime = 0
    showMessage('FIND SIX', 1.1, 'yellow', true)
  }

  wrong67WarningCooldown = Math.max(0, wrong67WarningCooldown - deltaSeconds)

  for (let index = ritualFlashes.length - 1; index >= 0; index -= 1) {
    ritualFlashes[index].timeLeft -= deltaSeconds
    if (ritualFlashes[index].timeLeft <= 0) {
      ritualFlashes.splice(index, 1)
    }
  }

  if (floor67Step !== 'need6' && floor67Step !== 'need7') {
    ritualHoldTime = 0
    return
  }

  const six = getRitualSymbol('6')
  const seven = getRitualSymbol('7')
  const neededSymbol = floor67Step === 'need6' ? six : seven

  if (floor67Step === 'need6' && isSpotlightOnSymbol(seven)) {
    ritualHoldTime = 0

    if (wrong67WarningCooldown === 0) {
      showRitualMessage('WEAK 67. FIND SIX FIRST.', 1.2)
      wrong67WarningCooldown = 1
    }

    return
  }

  if (!isSpotlightOnSymbol(neededSymbol)) {
    ritualHoldTime = 0
    return
  }

  ritualHoldTime += deltaSeconds

  if (ritualHoldTime >= ritualHoldSeconds) {
    activateRitualSymbol(neededSymbol)
  }
}

function updateFeedback(deltaSeconds: number) {
  if (gameMessage) {
    gameMessage.timeLeft = Math.max(0, gameMessage.timeLeft - deltaSeconds)

    if (gameMessage.timeLeft === 0) {
      gameMessage = null

      if (pendingExitMessage && isDoorOpen()) {
        pendingExitMessage = false
        showMessage('EXIT UNLOCKED', 1.25, 'green')
        playBeep(1040, 0.18, 'triangle')
      }
    }
  }

  if (flashEffect) {
    flashEffect.timeLeft = Math.max(0, flashEffect.timeLeft - deltaSeconds)
    if (flashEffect.timeLeft === 0) {
      flashEffect = null
    }
  }
}

function beginLevelTransition() {
  const nextLevelIndex = currentLevelIndex + 1
  levelsCleared = Math.max(levelsCleared, currentLevelIndex + 1)

  if (nextLevelIndex >= levels.length) {
    hasWon = true
    finalTime = elapsedSeconds
    saveWinResult()
    winScreen.classList.remove('hidden')
    return
  }

  levelTransitionTarget = nextLevelIndex
  levelTransitionTime = 2.25
  levelTransitionMessage = `LEVEL ${currentLevelIndex + 1} CLEARED|ENTERING FLOOR ${nextLevelIndex + 1}`
  showMessage(`LEVEL ${currentLevelIndex + 1} CLEARED`, 0.9, 'green', true)
  triggerFlash('rgba(35, 255, 145, 0.28)', 0.34)
  playBeep(760, 0.14, 'triangle')
}

function updateLevelTransition(deltaSeconds: number) {
  if (levelTransitionTime <= 0 || levelTransitionTarget === null) {
    return false
  }

  elapsedSeconds += deltaSeconds
  levelTransitionTime = Math.max(0, levelTransitionTime - deltaSeconds)

  if (levelTransitionTime === 0) {
    const nextLevelIndex = levelTransitionTarget
    levelTransitionTarget = null
    levelTransitionMessage = ''
    loadLevel(nextLevelIndex)
    showMessage(`FLOOR ${nextLevelIndex + 1}`, 1, 'cyan', true)
  }

  return true
}

// Floor 67 flicker: every 8-12 seconds the spotlight contracts briefly, then recovers.
function updateLightFlicker(deltaSeconds: number) {
  if (demoMode || !activeLevel.flicker) {
    lightFlickerDelay = 0
    lightFlickerTime = 0
    return
  }

  if (lightFlickerTime > 0) {
    lightFlickerTime = Math.max(0, lightFlickerTime - deltaSeconds)
    if (lightFlickerTime === 0) {
      scheduleNextLightFlicker()
    }
    return
  }

  lightFlickerDelay = Math.max(0, lightFlickerDelay - deltaSeconds)
  if (lightFlickerDelay === 0) {
    lightFlickerTime = 0.5
  }
}

// Game loop: advance the timer, read controls, update pickups, chase, and win state.
function update(deltaSeconds: number) {
  spotlight.x += (spotlight.targetX - spotlight.x) * 0.18
  spotlight.y += (spotlight.targetY - spotlight.y) * 0.18
  updateFeedback(deltaSeconds)

  if (appScreen !== 'game' || !gameStarted || hasWon) {
    return
  }

  if (isPaused) {
    return
  }

  if (updateLevelTransition(deltaSeconds)) {
    return
  }

  elapsedSeconds += deltaSeconds
  updateLightFlicker(deltaSeconds)

  const movement: Vec2 = { x: 0, y: 0 }
  if (input.has('w') || input.has('arrowup')) movement.y -= 1
  if (input.has('s') || input.has('arrowdown')) movement.y += 1
  if (input.has('a') || input.has('arrowleft')) movement.x -= 1
  if (input.has('d') || input.has('arrowright')) movement.x += 1

  const magnitude = Math.hypot(movement.x, movement.y)
  if (magnitude > 0) {
    movePlayer({
      x: (movement.x / magnitude) * player.speed * deltaSeconds,
      y: (movement.y / magnitude) * player.speed * deltaSeconds,
    })
  }

  keys.forEach((key) => {
    if (!key.collected && circlesOverlap(player, { ...key, radius: 13 })) {
      key.collected = true
      keysCollected += 1
      showMessage('KEY ACQUIRED', 0.9, 'green')
      triggerFlash('rgba(35, 255, 145, 0.26)', 0.22)
      playBeep(660, 0.1, 'square')
    }
  })

  fakeKeys.forEach((key) => {
    if (!key.collected && circlesOverlap(player, { ...key, radius: 13 })) {
      key.collected = true
      triggerFakeKeyPenalty()
    }
  })

  updateFloor67Ritual(deltaSeconds)
  ghostPanicTime = Math.max(0, ghostPanicTime - deltaSeconds)

  for (const ghost of ghosts) {
    updateGhost(ghost, deltaSeconds)

    if (circlesOverlap(player, ghost)) {
      respawnPlayerWithPenalty()
      break
    }
  }

  if (isDoorOpen() && circleHitsRect(player, door)) {
    beginLevelTransition()
  }
}

function drawGridFloor() {
  ctx.fillStyle = '#0c0d12'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  ctx.strokeStyle = 'rgba(70, 255, 226, 0.08)'
  ctx.lineWidth = 1

  for (let x = 22; x < canvasWidth; x += 48) {
    ctx.beginPath()
    ctx.moveTo(x, 22)
    ctx.lineTo(x, canvasHeight - 22)
    ctx.stroke()
  }

  for (let y = 22; y < canvasHeight; y += 48) {
    ctx.beginPath()
    ctx.moveTo(22, y)
    ctx.lineTo(canvasWidth - 22, y)
    ctx.stroke()
  }
}

function drawWalls() {
  walls.forEach((wall) => {
    const gradient = ctx.createLinearGradient(wall.x, wall.y, wall.x + wall.width, wall.y)
    gradient.addColorStop(0, '#202229')
    gradient.addColorStop(0.5, '#323640')
    gradient.addColorStop(1, '#181a20')
    ctx.fillStyle = gradient
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height)
    ctx.strokeStyle = 'rgba(150, 255, 232, 0.16)'
    ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.width - 1, wall.height - 1)
  })
}

function drawKeys() {
  fakeKeys.forEach((key) => {
    if (key.collected) {
      return
    }

    ctx.save()
    ctx.globalAlpha = 0.86
    ctx.shadowColor = '#ff3f73'
    ctx.shadowBlur = 14
    ctx.strokeStyle = '#ffd966'
    ctx.fillStyle = '#ffeeb0'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(key.x, key.y, 7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(key.x + 7, key.y)
    ctx.lineTo(key.x + 25, key.y)
    ctx.lineTo(key.x + 25, key.y + 8)
    ctx.moveTo(key.x + 17, key.y)
    ctx.lineTo(key.x + 17, key.y + 7)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = '#ff3f73'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(key.x - 3, key.y - 5)
    ctx.lineTo(key.x + 3, key.y + 5)
    ctx.moveTo(key.x + 18, key.y - 3)
    ctx.lineTo(key.x + 23, key.y + 4)
    ctx.stroke()
    ctx.restore()
  })

  keys.forEach((key) => {
    if (key.collected) {
      return
    }

    ctx.save()
    ctx.shadowColor = '#ffe45c'
    ctx.shadowBlur = 18
    ctx.strokeStyle = '#ffe45c'
    ctx.fillStyle = '#fff2a8'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(key.x, key.y, 7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(key.x + 7, key.y)
    ctx.lineTo(key.x + 25, key.y)
    ctx.lineTo(key.x + 25, key.y + 8)
    ctx.moveTo(key.x + 17, key.y)
    ctx.lineTo(key.x + 17, key.y + 7)
    ctx.stroke()
    ctx.fillRect(key.x - 2, key.y - 2, 4, 4)
    ctx.restore()
  })
}

function drawFloor67Symbols() {
  if (floor67Step === 'none') {
    return
  }

  ritualFlashes.forEach((flash) => {
    const progress = flash.timeLeft / 0.45

    ctx.save()
    ctx.globalAlpha = progress
    ctx.strokeStyle = '#fff7a8'
    ctx.lineWidth = 5
    ctx.shadowColor = '#ffe45c'
    ctx.shadowBlur = 28
    ctx.beginPath()
    ctx.arc(flash.x, flash.y, 42 + (1 - progress) * 38, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  })

  floor67Symbols.forEach((symbol) => {
    const isCurrent =
      (floor67Step === 'need6' && symbol.value === '6') ||
      (floor67Step === 'need7' && symbol.value === '7')
    const isComplete = floor67Step === 'complete'
    const isHeld = isCurrent && isSpotlightOnSymbol(symbol)

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 58px Inter, system-ui, sans-serif'
    ctx.shadowColor = symbol.value === '6' ? '#52ffe4' : '#ff3f73'
    ctx.shadowBlur = isCurrent || isComplete ? 26 : 14
    ctx.fillStyle = symbol.value === '6' ? '#b8fff7' : '#ffd2dc'
    ctx.strokeStyle = symbol.value === '6' ? '#1de7d6' : '#ff3f73'
    ctx.lineWidth = 3
    ctx.strokeText(symbol.value, symbol.x, symbol.y)
    ctx.fillText(symbol.value, symbol.x, symbol.y)

    if (isHeld) {
      const progress = Math.min(ritualHoldTime / ritualHoldSeconds, 1)

      ctx.shadowBlur = 18
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.arc(symbol.x, symbol.y, 46, -Math.PI / 2, Math.PI * 1.5)
      ctx.stroke()

      ctx.strokeStyle = '#ffe45c'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.arc(symbol.x, symbol.y, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
      ctx.stroke()
    }

    ctx.restore()
  })
}

function drawDoor() {
  const open = isDoorOpen()
  ctx.save()
  ctx.shadowColor = open ? '#22ff90' : '#ff304f'
  ctx.shadowBlur = 22
  ctx.fillStyle = open ? '#11b868' : '#9f1d32'
  ctx.fillRect(door.x, door.y, door.width, door.height)
  ctx.strokeStyle = open ? '#a9ffd5' : '#ff94a4'
  ctx.lineWidth = 3
  ctx.strokeRect(door.x + 1.5, door.y + 1.5, door.width - 3, door.height - 3)
  ctx.fillStyle = open ? '#d7ffe9' : '#ffd2d8'
  ctx.fillRect(door.x + 7, door.y + 42, 5, 8)
  ctx.restore()
}

function drawRitualOverlay() {
  if (!gameMessage) {
    return
  }

  const progress = gameMessage.timeLeft / gameMessage.duration
  const isBig = gameMessage.text === 'SIX SEVEN CERTIFIED'
  const toneColor = {
    cyan: '#b8fff7',
    green: '#b5ffd3',
    red: '#ffd2dc',
    yellow: '#fff7a8',
  }[gameMessage.tone]
  const shadowColor = {
    cyan: '#52ffe4',
    green: '#23ff91',
    red: '#ff3f73',
    yellow: '#ffe45c',
  }[gameMessage.tone]
  const jitter = gameMessage.glitch ? Math.sin(performance.now() / 28) * 4 : 0

  ctx.save()
  ctx.globalAlpha = Math.min(progress * 3, 1)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = isBig
    ? '900 56px Inter, system-ui, sans-serif'
    : '900 42px Inter, system-ui, sans-serif'
  ctx.shadowColor = shadowColor
  ctx.shadowBlur = 24
  ctx.fillStyle = toneColor
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.lineWidth = 8

  if (gameMessage.glitch) {
    ctx.fillStyle = '#52ffe4'
    ctx.fillText(gameMessage.text, canvasWidth / 2 - 5 - jitter, 73)
    ctx.fillStyle = '#ff3f73'
    ctx.fillText(gameMessage.text, canvasWidth / 2 + 5 + jitter, 77)
    ctx.fillStyle = toneColor
  }

  ctx.strokeText(gameMessage.text, canvasWidth / 2, 74)
  ctx.fillText(gameMessage.text, canvasWidth / 2 + jitter * 0.3, 74)
  ctx.restore()
}

function drawFlashEffect() {
  if (!flashEffect) {
    return
  }

  ctx.save()
  ctx.globalAlpha = (flashEffect.timeLeft / flashEffect.duration) * 0.9
  ctx.fillStyle = flashEffect.color
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.restore()
}

function drawLevelTransitionOverlay() {
  if (levelTransitionTime <= 0 || levelTransitionMessage === '') {
    return
  }

  const [clearedText, enteringText] = levelTransitionMessage.split('|')

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.76)'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#52ffe4'
  ctx.shadowBlur = 24
  ctx.fillStyle = '#e9fbff'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)'
  ctx.lineWidth = 8
  ctx.font = '900 54px Inter, system-ui, sans-serif'
  ctx.strokeText(clearedText, canvasWidth / 2, canvasHeight / 2 - 28)
  ctx.fillText(clearedText, canvasWidth / 2, canvasHeight / 2 - 28)
  ctx.shadowColor = '#ffe45c'
  ctx.font = '900 34px Inter, system-ui, sans-serif'
  ctx.strokeText(enteringText, canvasWidth / 2, canvasHeight / 2 + 38)
  ctx.fillText(enteringText, canvasWidth / 2, canvasHeight / 2 + 38)
  ctx.restore()
}

function drawPauseOverlay() {
  if (!isPaused) {
    return
  }

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.52)'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '900 58px Inter, system-ui, sans-serif'
  ctx.shadowColor = '#52ffe4'
  ctx.shadowBlur = 24
  ctx.fillStyle = '#e9fbff'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.lineWidth = 8
  ctx.strokeText('PAUSED', canvasWidth / 2, canvasHeight / 2)
  ctx.fillText('PAUSED', canvasWidth / 2, canvasHeight / 2)
  ctx.font = '900 20px Inter, system-ui, sans-serif'
  ctx.fillStyle = '#ffe45c'
  ctx.fillText('Press P or Resume', canvasWidth / 2, canvasHeight / 2 + 48)
  ctx.restore()
}

function drawPlayer() {
  ctx.save()
  ctx.shadowColor = '#5fffee'
  ctx.shadowBlur = 20
  ctx.fillStyle = '#b8fff7'
  ctx.beginPath()
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#1de7d6'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.restore()
}

function drawGhost(ghost: GhostState) {
  const ghostPalette = {
    chaser: {
      body: '#d9d7ff',
      eye: '#ff193d',
      shadow: '#ff3158',
      stroke: '#ff3f73',
    },
    patrol: {
      body: '#ffe0a3',
      eye: '#ff6b00',
      shadow: '#ff9f1c',
      stroke: '#ffb84d',
    },
    stalker: {
      body: '#241a34',
      eye: '#d8b5ff',
      shadow: '#9b5cff',
      stroke: '#b38cff',
    },
  }[ghost.type]

  ctx.save()
  ctx.shadowColor = ghostPalette.shadow
  ctx.shadowBlur = 18
  ctx.fillStyle = ghostPalette.body
  ctx.beginPath()
  ctx.arc(ghost.x, ghost.y, ghost.radius, Math.PI, 0)
  ctx.lineTo(ghost.x + ghost.radius, ghost.y + 14)
  ctx.lineTo(ghost.x + 7, ghost.y + 8)
  ctx.lineTo(ghost.x, ghost.y + 15)
  ctx.lineTo(ghost.x - 7, ghost.y + 8)
  ctx.lineTo(ghost.x - ghost.radius, ghost.y + 14)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = ghostPalette.stroke
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = ghostPalette.eye
  ctx.beginPath()
  ctx.arc(ghost.x - 6, ghost.y - 3, 3, 0, Math.PI * 2)
  ctx.arc(ghost.x + 6, ghost.y - 3, 3, 0, Math.PI * 2)
  ctx.fill()

  if (ghost.type === 'patrol') {
    ctx.globalAlpha = 0.72
    ctx.beginPath()
    ctx.arc(ghost.x, ghost.y + 8, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function drawGhosts() {
  ghosts.forEach(drawGhost)
}

// Spotlight logic: build darkness on an offscreen canvas so the light cuts only
// the darkness layer, not the actual maze pixels underneath.
function drawDarkness() {
  if (!spotlight.enabled) {
    return
  }

  const flickerScale = activeLevel.flicker && !demoMode && lightFlickerTime > 0 ? 0.58 : 1
  const effectiveRadius = spotlight.radius * flickerScale

  darknessCtx.clearRect(0, 0, canvasWidth, canvasHeight)
  darknessCtx.fillStyle = 'rgba(0, 0, 0, 1)'
  darknessCtx.fillRect(0, 0, canvasWidth, canvasHeight)
  darknessCtx.globalCompositeOperation = 'destination-out'

  const gradient = darknessCtx.createRadialGradient(
    spotlight.x,
    spotlight.y,
    effectiveRadius * 0.2,
    spotlight.x,
    spotlight.y,
    effectiveRadius,
  )
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
  gradient.addColorStop(0.56, 'rgba(0, 0, 0, 1)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  darknessCtx.fillStyle = gradient
  darknessCtx.beginPath()
  darknessCtx.arc(spotlight.x, spotlight.y, effectiveRadius, 0, Math.PI * 2)
  darknessCtx.fill()
  darknessCtx.globalCompositeOperation = 'source-over'

  ctx.drawImage(darknessCanvas, 0, 0)

  ctx.save()
  const glow = ctx.createRadialGradient(
    spotlight.x,
    spotlight.y,
    0,
    spotlight.x,
    spotlight.y,
    effectiveRadius,
  )
  glow.addColorStop(0, 'rgba(178, 255, 242, 0.14)')
  glow.addColorStop(0.62, 'rgba(82, 255, 228, 0.06)')
  glow.addColorStop(1, 'rgba(82, 255, 228, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(spotlight.x, spotlight.y, effectiveRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(158, 255, 236, 0.58)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(spotlight.x, spotlight.y, effectiveRadius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// Rendering: paint the maze and characters first, then apply the darkness overlay last.
function render() {
  drawGridFloor()
  drawWalls()
  drawDoor()
  drawKeys()
  drawFloor67Symbols()
  drawPlayer()
  drawGhosts()
  drawDarkness()
  drawFlashEffect()
  drawLevelTransitionOverlay()
  drawRitualOverlay()
  drawPauseOverlay()

  timeEl.textContent = formatTime(hasWon ? finalTime : elapsedSeconds)
  keysEl.textContent = `Keys ${keysCollected} / ${requiredKeys}`
  doorStateEl.textContent = isDoorOpen() ? 'Door open' : 'Door locked'
  doorStateEl.classList.toggle('open', isDoorOpen())
  objectiveEl.textContent = getObjectiveText()
  levelStatusEl.textContent = `Level ${currentLevelIndex + 1} / ${levels.length}`
  floorDifficultyEl.textContent = activeLevel.difficultyLabel
  teamStatusEl.textContent = currentTeamName
  ghostHitsEl.textContent = `Ghost hits ${ghostHits}`
  fakeKeysEl.textContent = `Fake keys ${fakeKeysTriggered}`
  lightModeEl.textContent = `Mode ${spotlightMode.toUpperCase()}`
  markerHudEl.textContent = markerDetected ? 'Marker detected' : 'Marker lost'
  markerHudEl.classList.toggle('detected', markerDetected)
  seedHudEl.textContent = `Seed ${runSeed}`
  controlsHudEl.textContent = 'WASD/Arrows - P pause - M mouse - C camera - L darkness'
  pauseButton.textContent = isPaused ? 'Resume' : 'Pause'
  updateScoreCalculator()
}

function gameLoop(now: number) {
  const deltaSeconds = Math.min((now - lastFrame) / 1000, 0.05)
  lastFrame = now

  update(deltaSeconds)
  render()
  requestAnimationFrame(gameLoop)
}

requestAnimationFrame(gameLoop)
