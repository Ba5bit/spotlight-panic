import { leaderboardStorageKey } from './constants'
import type { LeaderboardEntry } from './types'

export function getRank(score: number) {
  if (score >= 18000) return 'Six Seven Certified'
  if (score >= 15000) return 'Elite Light Operator'
  if (score >= 12000) return 'Ghost Dodger'
  if (score >= 9000) return 'Weak Aura Survivor'

  return 'NPC in the Dark'
}

export function calculateScore(
  completionTime: number,
  levelsCleared: number,
  ghostHits: number,
  fakeKeysTriggered: number,
  floor67Complete: boolean,
) {
  return calculateScoreBreakdown(
    completionTime,
    levelsCleared,
    ghostHits,
    fakeKeysTriggered,
    floor67Complete,
  ).score
}

export function calculateScoreBreakdown(
  completionTime: number,
  levelsCleared: number,
  ghostHits: number,
  fakeKeysTriggered: number,
  floor67Complete: boolean,
) {
  const completionTimeSeconds = completionTime / 1000
  const floor67Bonus = floor67Complete ? 670 : 0
  const timePenalty = Math.floor(completionTimeSeconds * 60)
  const ghostPenalty = ghostHits * 700
  const fakeKeyPenalty = fakeKeysTriggered * 400
  const levelBonus = levelsCleared * 1000
  const noGhostBonus = ghostHits === 0 ? 1000 : 0
  const noFakeKeyBonus = fakeKeysTriggered === 0 ? 500 : 0
  const score =
    20000 -
    timePenalty -
    ghostPenalty -
    fakeKeyPenalty +
    levelBonus +
    floor67Bonus +
    noGhostBonus +
    noFakeKeyBonus

  return {
    baseScore: 20000,
    fakeKeyPenalty,
    floor67Bonus,
    ghostPenalty,
    levelBonus,
    noFakeKeyBonus,
    noGhostBonus,
    score: Math.max(0, score),
    timePenalty,
  }
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

  return first.completionTime - second.completionTime
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
    typeof candidate.score === 'number' &&
    typeof candidate.completionTime === 'number' &&
    typeof candidate.levelsCleared === 'number' &&
    typeof candidate.ghostHits === 'number' &&
    typeof candidate.fakeKeysTriggered === 'number' &&
    typeof candidate.rank === 'string' &&
    typeof candidate.seed === 'string' &&
    typeof candidate.createdAt === 'string'
  )
}
