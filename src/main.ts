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
  getRank,
  loadLeaderboard,
  saveLeaderboardEntry,
} from './leaderboard'
import { levels } from './levels'
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
let keys: CollectibleKey[] = activeLevel.keys.map((key) => ({ ...key, collected: false }))
let door: Rect = { ...activeLevel.door }
let floor67Symbols: Floor67Symbol[] = activeLevel.symbols
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
let ghostHits = 0
let latestResult: LeaderboardEntry | null = null
let resultSaved = false
let gameStarted = false
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
          <span id="team-status">Team NPC</span>
          <span id="ghost-hits">Ghost hits 0</span>
          <span id="marker-hud">Marker lost</span>
          <span id="controls-hud">WASD/Arrows - M mouse - C camera - L darkness</span>
        </div>
        <canvas id="game" width="${canvasWidth}" height="${canvasHeight}" aria-label="Spotlight Panic game board"></canvas>
        <video id="camera-preview" class="camera-preview" autoplay muted playsinline aria-label="Webcam preview"></video>
        <canvas id="camera-analysis" class="analysis-canvas" width="160" height="90" aria-hidden="true"></canvas>
        <div id="win-screen" class="win-screen hidden" role="status" aria-live="polite">
          <strong>You escaped the panic.</strong>
          <span id="final-time">Completion time: 00:00.0</span>
          <span id="final-team">Team NPC</span>
          <span id="final-score">Score: 0</span>
          <span id="final-rank">Rank: NPC in the Dark</span>
          <span id="final-ghosts">Ghost hits: 0</span>
          <div class="win-actions">
            <button id="next-team" type="button">Next Team</button>
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

      <aside class="leaderboard" aria-label="Local leaderboard placeholder">
        <h2>Local Leaderboard</h2>
        <ol>
          <li><span>Awaiting first escape</span><strong>--:--.-</strong></li>
          <li><span>Persistence later</span><strong>--:--.-</strong></li>
          <li><span>Webcam chaos soon</span><strong>--:--.-</strong></li>
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
const teamStatusEl = document.querySelector<HTMLSpanElement>('#team-status')!
const ghostHitsEl = document.querySelector<HTMLSpanElement>('#ghost-hits')!
const markerHudEl = document.querySelector<HTMLSpanElement>('#marker-hud')!
const controlsHudEl = document.querySelector<HTMLSpanElement>('#controls-hud')!
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
const restartButton = document.querySelector<HTMLButtonElement>('#restart')!
const landingStartButton = document.querySelector<HTMLButtonElement>('#landing-start')!
const demoModeButton = document.querySelector<HTMLButtonElement>('#demo-mode')!
const landingLeaderboardButton = document.querySelector<HTMLButtonElement>('#landing-leaderboard')!
const startRunButton = document.querySelector<HTMLButtonElement>('#start-run')!
const setupLeaderboardButton = document.querySelector<HTMLButtonElement>('#setup-leaderboard')!
const setupMenuButton = document.querySelector<HTMLButtonElement>('#setup-menu')!
const nextTeamButton = document.querySelector<HTMLButtonElement>('#next-team')!
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
nextTeamButton.addEventListener('click', () => {
  showScreen('teamSetup')
  teamNameInput.select()
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
  const timeMs = Math.round(finalTime * 1000)
  const score = calculateScore(timeMs, ghostHits, floor67Step === 'complete')

  return {
    teamName: currentTeamName,
    timeMs,
    ghostHits,
    score,
    rank: getRank(score),
    createdAt: new Date().toISOString(),
  }
}

function formatResultTime(timeMs: number) {
  return formatTime(timeMs / 1000)
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
  finalTimeEl.textContent = `Completion time: ${formatResultTime(latestResult.timeMs)}`
  finalScoreEl.textContent = `Score: ${latestResult.score}`
  finalRankEl.textContent = `Rank: ${latestResult.rank}`
  finalGhostsEl.textContent = `Ghost hits: ${latestResult.ghostHits}`
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
              <span>${formatResultTime(entry.timeMs)}</span>
              <span>${entry.ghostHits} hits</span>
              <strong>${entry.score}</strong>
              <span>${escapeHtml(entry.rank)}</span>
            </li>
          `,
        )
        .join('')}
    </ol>
  `
}

function createGhosts(level: LevelData, isDemo: boolean) {
  return level.ghosts.map((ghostData) => {
    const baseSpeed = isDemo ? Math.max(22, ghostData.speed - 16) : ghostData.speed

    return {
      x: ghostData.x,
      y: ghostData.y,
      startX: ghostData.x,
      startY: ghostData.y,
      radius: 16,
      speed: baseSpeed,
    }
  })
}

function loadLevel(levelIndex: number) {
  currentLevelIndex = levelIndex
  activeLevel = levels[currentLevelIndex]
  playerStart = { ...activeLevel.playerStart }
  walls = activeLevel.walls
  keys = activeLevel.keys.map((key) => ({ ...key, collected: false }))
  door = { ...activeLevel.door }
  floor67Symbols = activeLevel.symbols
  ghosts = createGhosts(activeLevel, demoMode)
  spotlight.radius = activeLevel.spotlightRadius
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
  elapsedSeconds = 0
  ghostHits = 0
  hasWon = false
  finalTime = 0
  levelTransitionTime = 0
  levelTransitionTarget = null
  levelTransitionMessage = ''
  latestResult = null
  resultSaved = false
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
  lastFrame = performance.now()
  calibrationScreen.classList.add('hidden')
  initAudio()
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

// Webcam tracking: sample the video every 100ms, find very bright pixels, average their
// position, mirror X for natural movement, and move only the target so the spotlight lerps.
function analyzeCameraFrame() {
  if (!cameraReady || cameraPreview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    markerDetected = false
    updateCameraStatus()
    return
  }

  const width = analysisCanvas.width
  const height = analysisCanvas.height
  analysisContext.drawImage(cameraPreview, 0, 0, width, height)

  const frame = analysisContext.getImageData(0, 0, width, height)
  let brightPixels = 0
  let totalX = 0
  let totalY = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const red = frame.data[index]
      const green = frame.data[index + 1]
      const blue = frame.data[index + 2]
      const brightness = (red + green + blue) / 3

      if (brightness > 220 && red > 205 && green > 205 && blue > 205) {
        brightPixels += 1
        totalX += x
        totalY += y
      }
    }
  }

  markerDetected = brightPixels > 12

  if (markerDetected && spotlightMode === 'camera') {
    const averageX = totalX / brightPixels
    const averageY = totalY / brightPixels
    const mirroredX = width - averageX

    spotlight.targetX = (mirroredX / width) * canvasWidth
    spotlight.targetY = (averageY / height) * canvasHeight
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
  })
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

// Game loop: advance the timer, read controls, update pickups, chase, and win state.
function update(deltaSeconds: number) {
  spotlight.x += (spotlight.targetX - spotlight.x) * 0.18
  spotlight.y += (spotlight.targetY - spotlight.y) * 0.18
  updateFeedback(deltaSeconds)

  if (appScreen !== 'game' || !gameStarted || hasWon) {
    return
  }

  if (updateLevelTransition(deltaSeconds)) {
    return
  }

  elapsedSeconds += deltaSeconds

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

  updateFloor67Ritual(deltaSeconds)

  for (const ghost of ghosts) {
    const ghostDirectionX = player.x - ghost.x
    const ghostDirectionY = player.y - ghost.y
    const ghostDistance = Math.hypot(ghostDirectionX, ghostDirectionY)

    if (ghostDistance > 0) {
      ghost.x += (ghostDirectionX / ghostDistance) * ghost.speed * deltaSeconds
      ghost.y += (ghostDirectionY / ghostDistance) * ghost.speed * deltaSeconds
    }

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
  ctx.save()
  ctx.shadowColor = '#ff3158'
  ctx.shadowBlur = 18
  ctx.fillStyle = '#d9d7ff'
  ctx.beginPath()
  ctx.arc(ghost.x, ghost.y, ghost.radius, Math.PI, 0)
  ctx.lineTo(ghost.x + ghost.radius, ghost.y + 14)
  ctx.lineTo(ghost.x + 7, ghost.y + 8)
  ctx.lineTo(ghost.x, ghost.y + 15)
  ctx.lineTo(ghost.x - 7, ghost.y + 8)
  ctx.lineTo(ghost.x - ghost.radius, ghost.y + 14)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ff193d'
  ctx.beginPath()
  ctx.arc(ghost.x - 6, ghost.y - 3, 3, 0, Math.PI * 2)
  ctx.arc(ghost.x + 6, ghost.y - 3, 3, 0, Math.PI * 2)
  ctx.fill()
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

  const flickerScale = activeLevel.flicker
    ? 0.92 + Math.sin(performance.now() / 65) * 0.05 + Math.sin(performance.now() / 19) * 0.025
    : 1
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

  timeEl.textContent = formatTime(hasWon ? finalTime : elapsedSeconds)
  keysEl.textContent = `Keys ${keysCollected} / ${requiredKeys}`
  doorStateEl.textContent = isDoorOpen() ? 'Door open' : 'Door locked'
  doorStateEl.classList.toggle('open', isDoorOpen())
  objectiveEl.textContent = getObjectiveText()
  levelStatusEl.textContent = `Level ${currentLevelIndex + 1} / ${levels.length}`
  teamStatusEl.textContent = currentTeamName
  ghostHitsEl.textContent = `Ghost hits ${ghostHits}`
  lightModeEl.textContent = `Mode ${spotlightMode.toUpperCase()}`
  markerHudEl.textContent = markerDetected ? 'Marker detected' : 'Marker lost'
  markerHudEl.classList.toggle('detected', markerDetected)
  controlsHudEl.textContent = 'WASD/Arrows - M mouse - C camera - L darkness'
}

function gameLoop(now: number) {
  const deltaSeconds = Math.min((now - lastFrame) / 1000, 0.05)
  lastFrame = now

  update(deltaSeconds)
  render()
  requestAnimationFrame(gameLoop)
}

requestAnimationFrame(gameLoop)
