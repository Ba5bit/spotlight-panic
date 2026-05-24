import { leaderboardStorageKey } from './constants'
import type { LeaderboardEntry } from './types'

export function getRank(score: number) {
  if (score >= 9000) return 'Six Seven Certified'
  if (score >= 7500) return 'Light Operator'
  if (score >= 6000) return 'Ghost Dodger'
  if (score >= 4000) return 'Weak Aura Survivor'

  return 'NPC in the Dark'
}

export function calculateScore(timeMs: number, hits: number, floor67Complete: boolean) {
  const completionTimeSeconds = timeMs / 1000
  const floor67Bonus = floor67Complete ? 670 : 0
  const score = 10000 - Math.floor(completionTimeSeconds * 50) - hits * 500 + floor67Bonus

  return Math.max(0, score)
}

export function loadLeaderboard() {
  try {
    const rawEntries = localStorage.getItem(leaderboardStorageKey)
    if (!rawEntries) {
      return []
    }

    const parsedEntries = JSON.parse(rawEntries)
    if (!Array.isArray(parsedEntries)) {
      return []
    }

    return parsedEntries.filter(isLeaderboardEntry).sort(sortLeaderboard)
  } catch {
    return []
  }
}

export function sortLeaderboard(first: LeaderboardEntry, second: LeaderboardEntry) {
  if (second.score !== first.score) {
    return second.score - first.score
  }

  return first.timeMs - second.timeMs
}

export function saveLeaderboardEntry(entry: LeaderboardEntry) {
  const entries = [...loadLeaderboard(), entry].sort(sortLeaderboard).slice(0, 50)
  localStorage.setItem(leaderboardStorageKey, JSON.stringify(entries))
}

function isLeaderboardEntry(entry: unknown): entry is LeaderboardEntry {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  const candidate = entry as Partial<LeaderboardEntry>

  return (
    typeof candidate.teamName === 'string' &&
    typeof candidate.timeMs === 'number' &&
    typeof candidate.ghostHits === 'number' &&
    typeof candidate.score === 'number' &&
    typeof candidate.rank === 'string' &&
    typeof candidate.createdAt === 'string'
  )
}
