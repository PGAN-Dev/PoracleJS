const NodeCache = require('node-cache')

class UserRateChecker {
	constructor(config, redisClient) {
		this.config = config
		this.redisClient = redisClient || null
		this.discordCache = new NodeCache({ useClones: false, stdTTL: this.config.alertLimits.timingPeriod })
		this.limitCount = new NodeCache({ stdTTL: (24 * 60 * 60) })
	}

	// eslint-disable-next-line no-unused-vars
	getMessageTimeout(id, type) {
		return this.config.alertLimits.timingPeriod
	}

	// eslint-disable-next-line no-unused-vars
	getMessageLimit(id, type) {
		const limitOverride = this.config.alertLimits.limitOverride[id]
		if (limitOverride) return limitOverride

		const limit = type.includes('user') ? this.config.alertLimits.dmLimit : this.config.alertLimits.channelLimit
		return limit
	}

	async validateMessage(id, type) {
		const messageTimeout = this.getMessageTimeout(id, type)
		const messageLimit = this.getMessageLimit(id, type)

		if (this.redisClient) {
			return this._validateMessageRedis(id, messageTimeout, messageLimit)
		}
		return this._validateMessageLocal(id, messageTimeout, messageLimit)
	}

	_validateMessageLocal(id, messageTimeout, messageLimit) {
		let ch = this.discordCache.get(id)
		let newCount
		let resetTime
		if (!ch) {
			ch = { count: 1 }
			this.discordCache.set(id, ch, messageTimeout)

			newCount = 1
			resetTime = messageTimeout
		} else {
			newCount = ch.count + 1
			ch.count = newCount

			const ttl = this.discordCache.getTtl(id)
			resetTime = Math.floor((ttl - Date.now()) / 1000)
			if (resetTime > 0) this.discordCache.set(id, ch, resetTime)
		}

		if (newCount > messageLimit) {
			ch.badboy = true
		}

		return {
			passMessage: newCount <= messageLimit,
			justBreached: newCount === messageLimit + 1,
			messageCount: newCount,
			resetTime: Math.max(resetTime, 1),	// Don't look stupid if we are actually at 0
			messageLimit,
			messageTimeout,
		}
	}

	async _validateMessageRedis(id, messageTimeout, messageLimit) {
		const key = `poracle:ratelimit:${id}`
		const newCount = await this.redisClient.incr(key)
		if (newCount === 1) {
			await this.redisClient.expire(key, messageTimeout)
		}

		const ttl = await this.redisClient.ttl(key)
		const resetTime = ttl > 0 ? ttl : messageTimeout

		if (newCount > messageLimit) {
			// Track badboy locally for getBadBoys broadcasting
			let ch = this.discordCache.get(id)
			if (!ch) {
				ch = { count: newCount, badboy: true }
				this.discordCache.set(id, ch, resetTime)
			} else {
				ch.count = newCount
				ch.badboy = true
			}
		}

		return {
			passMessage: newCount <= messageLimit,
			justBreached: newCount === messageLimit + 1,
			messageCount: newCount,
			resetTime: Math.max(resetTime, 1),
			messageLimit,
			messageTimeout,
		}
	}

	getBadBoys() {
		const badboys = []
		for (const key of this.discordCache.keys()) {
			const ch = this.discordCache.get(key)

			if (ch && ch.badboy) {
				const ttl = this.discordCache.getTtl(key)
				badboys.push({
					key,
					ttlTimeout: ttl,
				})
			}
		}

		return badboys
	}

	/**
	 * Add user to banned list
	 * @param id user id
	 */
	// eslint-disable-next-line no-unused-vars
	async userIsBanned(id, type) {
		if (this.redisClient) {
			return this._userIsBannedRedis(id)
		}
		return this._userIsBannedLocal(id)
	}

	_userIsBannedLocal(id) {
		let ch = this.limitCount.get(id)
		const messageLimit = this.config.alertLimits.maxLimitsBeforeStop
		const messageTimeout = 24 * 60 * 60
		let newCount
		let resetTime
		if (!ch) {
			ch = { count: 1 }
			this.limitCount.set(id, ch, messageTimeout)

			newCount = 1
			resetTime = messageTimeout
		} else {
			newCount = ch.count + 1
			ch.count = newCount

			const ttl = this.limitCount.getTtl(id)
			resetTime = Math.floor((ttl - Date.now()) / 1000)
			if (resetTime > 0) this.limitCount.set(id, ch, resetTime)
		}

		return {
			canContinue: newCount <= messageLimit,
			justBreached: newCount === messageLimit + 1,
			messageCount: newCount,
			resetTime: Math.max(resetTime, 1),	// Don't look stupid if we are actually at 0
			messageLimit,
			messageTimeout,
		}
	}

	async _userIsBannedRedis(id) {
		const key = `poracle:ratelimit:ban:${id}`
		const messageLimit = this.config.alertLimits.maxLimitsBeforeStop
		const messageTimeout = 24 * 60 * 60

		const newCount = await this.redisClient.incr(key)
		if (newCount === 1) {
			await this.redisClient.expire(key, messageTimeout)
		}

		const ttl = await this.redisClient.ttl(key)
		const resetTime = ttl > 0 ? ttl : messageTimeout

		return {
			canContinue: newCount <= messageLimit,
			justBreached: newCount === messageLimit + 1,
			messageCount: newCount,
			resetTime: Math.max(resetTime, 1),
			messageLimit,
			messageTimeout,
		}
	}
}

module.exports = UserRateChecker
