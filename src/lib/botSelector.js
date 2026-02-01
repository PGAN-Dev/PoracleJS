const KEY_PREFIX = 'poracle:botassign:'

class BotSelector {
	constructor(workerCount, redisClient = null, overrideTtl = 300) {
		this.workerCount = BigInt(workerCount)
		this.redisClient = redisClient
		this.overrideTtl = overrideTtl
	}

	/**
	 * Pure BigInt modulo — deterministic, sync, no Redis.
	 */
	getPrimaryIndex(target) {
		return Number(BigInt(target) % this.workerCount)
	}

	/**
	 * Full selection with Redis-backed sticky fallback overrides.
	 * Only touches Redis when the primary bot is busy.
	 */
	async selectWorker(workers, target) {
		const primaryIndex = this.getPrimaryIndex(target)
		const primary = workers[primaryIndex]

		// Hot path — primary healthy, no Redis call
		if (!primary.busy) {
			return primary
		}

		// Primary is busy — try Redis override
		if (this.redisClient) {
			try {
				const key = `${KEY_PREFIX}${target}`
				const cached = await this.redisClient.get(key)

				if (cached !== null) {
					const overrideIndex = Number(cached)
					if (overrideIndex >= 0 && overrideIndex < workers.length && !workers[overrideIndex].busy) {
						return workers[overrideIndex]
					}
				}

				// Cached override missing or its bot is also busy — compute new fallback
				const fallback = this._leastLoaded(workers)
				if (fallback !== null) {
					const fallbackIndex = workers.indexOf(fallback)
					await this.redisClient.set(key, String(fallbackIndex), 'EX', this.overrideTtl)
					return fallback
				}
			} catch {
				// Redis error — fall through to local logic
			}
		}

		// No Redis or Redis failed — local fallback
		return this.selectWorkerLocal(workers, target)
	}

	/**
	 * Sync fallback when Redis is unavailable (matches original behavior).
	 */
	selectWorkerLocal(workers, target) {
		const primaryIndex = this.getPrimaryIndex(target)
		const primary = workers[primaryIndex]

		if (!primary.busy) {
			return primary
		}

		const fallback = this._leastLoaded(workers)
		return fallback !== null ? fallback : primary
	}

	/**
	 * Return the non-busy worker with the shortest queue, or null if all busy.
	 */
	_leastLoaded(workers) {
		let best = null
		for (const w of workers) {
			if (!w.busy && (best === null || w.discordQueue.length < best.discordQueue.length)) {
				best = w
			}
		}
		return best
	}
}

module.exports = BotSelector
