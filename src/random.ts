import type { Vec2 } from './types'

export type SeededRandom = () => number

export function createRunSeed() {
  return Math.floor(Date.now() % 1_000_000_000).toString(36).toUpperCase()
}

export function createSeededRandom(seed: string) {
  let state = hashSeed(seed)

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function chooseUnique<T extends Vec2>(
  spawns: T[],
  count: number,
  rng: SeededRandom,
  usedKeys = new Set<string>(),
) {
  const available = spawns.filter((spawn) => !usedKeys.has(getSpawnKey(spawn)))
  const chosen: T[] = []

  while (chosen.length < count && available.length > 0) {
    const index = Math.floor(rng() * available.length)
    const [spawn] = available.splice(index, 1)
    chosen.push(spawn)
    usedKeys.add(getSpawnKey(spawn))
  }

  return chosen
}

export function getSpawnKey(point: Vec2) {
  return `${point.x},${point.y}`
}

function hashSeed(seed: string) {
  let hash = 1779033703 ^ seed.length

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }

  return hash >>> 0
}
