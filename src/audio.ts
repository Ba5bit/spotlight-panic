let audioContext: AudioContext | null = null
let backgroundMusic: HTMLAudioElement | null = null

export function initAudio() {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => undefined)
    }
  } catch {
    audioContext = null
  }
}

export function playBeep(frequency: number, duration = 0.12, type: OscillatorType = 'sine') {
  try {
    if (!audioContext) {
      return
    }

    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const now = audioContext.currentTime

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + duration + 0.03)
  } catch {
    audioContext = null
  }
}

export function startBackgroundMusic() {
  try {
    backgroundMusic ??= createBackgroundMusic()
    backgroundMusic.play().catch(() => undefined)
  } catch {
    backgroundMusic = null
  }
}

export function stopBackgroundMusic() {
  if (!backgroundMusic) {
    return
  }

  backgroundMusic.pause()
  backgroundMusic.currentTime = 0
}

function createBackgroundMusic() {
  const music = new Audio('/audio/pixel-mist.mp3')
  music.loop = true
  music.volume = 0.34

  return music
}
