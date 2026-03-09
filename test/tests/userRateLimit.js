const assert = require('assert')
const UserRateChecker = require('../../src/userRateLimit')

function makeConfig(overrides = {}) {
	return {
		alertLimits: {
			timingPeriod: 240,
			dmLimit: 5,
			channelLimit: 10,
			maxLimitsBeforeStop: 3,
			limitOverride: {},
			...overrides,
		},
	}
}

/**
 * Create a mock Redis client that behaves like ioredis for INCR/EXPIRE/TTL
 */
function makeMockRedisClient() {
	const store = {}

	return {
		_store: store,
		async incr(key) {
			if (!store[key]) {
				store[key] = { value: 0, ttl: -1 }
			}
			store[key].value += 1
			return store[key].value
		},
		async expire(key, seconds) {
			if (store[key]) {
				store[key].ttl = seconds
			}
			return 1
		},
		async ttl(key) {
			if (!store[key]) return -2
			return store[key].ttl
		},
	}
}

/**
 * Wrap a mock Redis client in a redisManager-like object
 */
function makeMockRedis() {
	const client = makeMockRedisClient()
	return {
		enabled: true,
		connected: true,
		publisher: client,
		_store: client._store,
	}
}

describe('UserRateChecker (local / NodeCache)', () => {
	it('allows messages under the limit', async () => {
		const checker = new UserRateChecker(makeConfig({ dmLimit: 3 }))
		const r1 = await checker.validateMessage('user1', 'discord:user')
		assert.strictEqual(r1.passMessage, true)
		assert.strictEqual(r1.messageCount, 1)
	})

	it('blocks messages once limit is exceeded', async () => {
		const checker = new UserRateChecker(makeConfig({ dmLimit: 2 }))
		await checker.validateMessage('user1', 'discord:user')
		await checker.validateMessage('user1', 'discord:user')
		const r3 = await checker.validateMessage('user1', 'discord:user')
		assert.strictEqual(r3.passMessage, false)
		assert.strictEqual(r3.justBreached, true)
		assert.strictEqual(r3.messageCount, 3)
	})

	it('sets justBreached only on the first message past the limit', async () => {
		const checker = new UserRateChecker(makeConfig({ dmLimit: 1 }))
		await checker.validateMessage('user1', 'discord:user')
		const r2 = await checker.validateMessage('user1', 'discord:user')
		const r3 = await checker.validateMessage('user1', 'discord:user')
		assert.strictEqual(r2.justBreached, true)
		assert.strictEqual(r3.justBreached, false)
	})

	it('uses channelLimit for non-user types', async () => {
		const checker = new UserRateChecker(makeConfig({ dmLimit: 1, channelLimit: 3 }))
		await checker.validateMessage('chan1', 'discord:channel')
		await checker.validateMessage('chan1', 'discord:channel')
		const r3 = await checker.validateMessage('chan1', 'discord:channel')
		assert.strictEqual(r3.passMessage, true)
		assert.strictEqual(r3.messageCount, 3)
	})

	it('respects limitOverride per user', async () => {
		const checker = new UserRateChecker(makeConfig({ dmLimit: 1, limitOverride: { vip: 100 } }))
		for (let i = 0; i < 50; i++) {
			await checker.validateMessage('vip', 'discord:user')
		}
		const r = await checker.validateMessage('vip', 'discord:user')
		assert.strictEqual(r.passMessage, true)
	})

	it('tracks bad boys in getBadBoys', async () => {
		const checker = new UserRateChecker(makeConfig({ dmLimit: 1 }))
		await checker.validateMessage('user1', 'discord:user')
		await checker.validateMessage('user1', 'discord:user')
		const badboys = checker.getBadBoys()
		assert.strictEqual(badboys.length, 1)
		assert.strictEqual(badboys[0].key, 'user1')
	})

	it('userIsBanned tracks breach count', async () => {
		const checker = new UserRateChecker(makeConfig({ maxLimitsBeforeStop: 2 }))
		const r1 = await checker.userIsBanned('user1', 'discord:user')
		assert.strictEqual(r1.canContinue, true)
		assert.strictEqual(r1.messageCount, 1)

		const r2 = await checker.userIsBanned('user1', 'discord:user')
		assert.strictEqual(r2.canContinue, true)

		const r3 = await checker.userIsBanned('user1', 'discord:user')
		assert.strictEqual(r3.canContinue, false)
		assert.strictEqual(r3.justBreached, true)
	})
})

describe('UserRateChecker (Redis)', () => {
	it('allows messages under the limit via Redis', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ dmLimit: 3 }), redis)
		const r1 = await checker.validateMessage('user1', 'discord:user')
		assert.strictEqual(r1.passMessage, true)
		assert.strictEqual(r1.messageCount, 1)
	})

	it('blocks messages once limit is exceeded via Redis', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ dmLimit: 2 }), redis)
		await checker.validateMessage('user1', 'discord:user')
		await checker.validateMessage('user1', 'discord:user')
		const r3 = await checker.validateMessage('user1', 'discord:user')
		assert.strictEqual(r3.passMessage, false)
		assert.strictEqual(r3.justBreached, true)
		assert.strictEqual(r3.messageCount, 3)
	})

	it('sets EXPIRE only on first INCR (new key)', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ dmLimit: 5 }), redis)
		await checker.validateMessage('user1', 'discord:user')
		const firstTtl = redis._store['poracle:ratelimit:user1'].ttl
		assert.strictEqual(firstTtl, 240)

		// Manually change TTL to simulate time passing
		redis._store['poracle:ratelimit:user1'].ttl = 100
		await checker.validateMessage('user1', 'discord:user')
		// TTL should NOT be reset to 240 — EXPIRE only called on first INCR
		assert.strictEqual(redis._store['poracle:ratelimit:user1'].ttl, 100)
	})

	it('justBreached fires at exactly limit+1 via Redis', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ dmLimit: 2 }), redis)
		await checker.validateMessage('user1', 'discord:user') // 1
		await checker.validateMessage('user1', 'discord:user') // 2
		const r3 = await checker.validateMessage('user1', 'discord:user') // 3
		const r4 = await checker.validateMessage('user1', 'discord:user') // 4
		assert.strictEqual(r3.justBreached, true)
		assert.strictEqual(r4.justBreached, false)
	})

	it('tracks bad boys locally even when using Redis', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ dmLimit: 1 }), redis)
		await checker.validateMessage('user1', 'discord:user')
		await checker.validateMessage('user1', 'discord:user')
		const badboys = checker.getBadBoys()
		assert.strictEqual(badboys.length, 1)
		assert.strictEqual(badboys[0].key, 'user1')
	})

	it('userIsBanned works via Redis', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ maxLimitsBeforeStop: 2 }), redis)
		const r1 = await checker.userIsBanned('user1', 'discord:user')
		assert.strictEqual(r1.canContinue, true)

		const r2 = await checker.userIsBanned('user1', 'discord:user')
		assert.strictEqual(r2.canContinue, true)

		const r3 = await checker.userIsBanned('user1', 'discord:user')
		assert.strictEqual(r3.canContinue, false)
		assert.strictEqual(r3.justBreached, true)
	})

	it('uses correct Redis key prefixes', async () => {
		const redis = makeMockRedis()
		const checker = new UserRateChecker(makeConfig({ dmLimit: 5, maxLimitsBeforeStop: 3 }), redis)
		await checker.validateMessage('abc123', 'discord:user')
		await checker.userIsBanned('abc123', 'discord:user')
		assert.ok(redis._store['poracle:ratelimit:abc123'], 'rate limit key should exist')
		assert.ok(redis._store['poracle:ratelimit:ban:abc123'], 'ban key should exist')
	})

	it('shares counters across multiple checker instances with same Redis', async () => {
		const redis = makeMockRedis()
		const config = makeConfig({ dmLimit: 3 })
		const instance1 = new UserRateChecker(config, redis)
		const instance2 = new UserRateChecker(config, redis)

		await instance1.validateMessage('user1', 'discord:user') // 1
		await instance2.validateMessage('user1', 'discord:user') // 2
		await instance1.validateMessage('user1', 'discord:user') // 3
		const r4 = await instance2.validateMessage('user1', 'discord:user') // 4
		assert.strictEqual(r4.passMessage, false)
		assert.strictEqual(r4.justBreached, true)
		assert.strictEqual(r4.messageCount, 4)
	})
})
