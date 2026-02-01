const assert = require('assert')
const BotSelector = require('../../src/lib/botSelector')

function makeWorker(id, busy = false, queueLength = 0) {
	return {
		id,
		busy,
		discordQueue: new Array(queueLength),
	}
}

/**
 * Minimal fake Redis client for testing.
 * Tracks get/set calls and stores values with optional TTL.
 */
function makeFakeRedis() {
	const store = new Map()
	const calls = { get: 0, set: 0 }
	return {
		store,
		calls,
		async get(key) {
			calls.get++
			const entry = store.get(key)
			return entry !== undefined ? entry : null
		},
		async set(key, value, _ex, _ttl) {
			calls.set++
			store.set(key, value)
		},
	}
}

describe('Deterministic bot selection', () => {
	it('assigns the same bot for the same user ID every time', async () => {
		const workers = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const selector = new BotSelector(workers.length)
		const userId = '123456789012345678'

		const first = await selector.selectWorker(workers, userId)
		const second = await selector.selectWorker(workers, userId)
		const third = await selector.selectWorker(workers, userId)

		assert.strictEqual(first.id, second.id)
		assert.strictEqual(second.id, third.id)
	})

	it('produces the same result regardless of instance (stateless)', async () => {
		const instanceA = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const instanceB = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const selectorA = new BotSelector(instanceA.length)
		const selectorB = new BotSelector(instanceB.length)
		const userId = '987654321098765432'

		const resultA = await selectorA.selectWorker(instanceA, userId)
		const resultB = await selectorB.selectWorker(instanceB, userId)

		assert.strictEqual(resultA.id, resultB.id)
	})

	it('distributes users across bots', async () => {
		const workers = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const selector = new BotSelector(workers.length)
		const assignments = new Set()

		const userIds = [
			'100000000000000000',
			'100000000000000001',
			'100000000000000002',
			'200000000000000000',
			'300000000000000000',
			'400000000000000000',
		]

		for (const uid of userIds) {
			const result = await selector.selectWorker(workers, uid)
			assignments.add(result.id)
		}

		assert(assignments.size >= 2, `Expected distribution across bots, got ${assignments.size} unique bot(s)`)
	})

	it('falls back to a healthy bot when primary is busy', async () => {
		const workers = [
			makeWorker(1, true),
			makeWorker(2, false),
			makeWorker(3, false),
		]
		const selector = new BotSelector(workers.length)

		// BigInt('300000000000000000') % 3n === 0n
		const userId = '300000000000000000'
		assert.strictEqual(selector.getPrimaryIndex(userId), 0, 'Test setup: user should map to index 0')

		const result = await selector.selectWorker(workers, userId)
		assert.notStrictEqual(result.id, 1, 'Should not use the busy bot')
		assert.strictEqual(result.busy, false)
	})

	it('falls back to the bot with the shortest queue', async () => {
		const workers = [
			makeWorker(1, true),
			makeWorker(2, false, 10),
			makeWorker(3, false, 2),
		]
		const selector = new BotSelector(workers.length)

		const userId = '300000000000000000' // maps to index 0 (busy)
		const result = await selector.selectWorker(workers, userId)

		assert.strictEqual(result.id, 3, 'Should pick bot with shortest queue')
	})

	it('uses primary anyway if all bots are busy', async () => {
		const workers = [
			makeWorker(1, true),
			makeWorker(2, true),
			makeWorker(3, true),
		]
		const selector = new BotSelector(workers.length)

		const userId = '300000000000000000'
		const result = await selector.selectWorker(workers, userId)

		assert.strictEqual(result.id, 1, 'Should fall back to primary when all busy')
	})

	it('works with a single bot', async () => {
		const workers = [makeWorker(1)]
		const selector = new BotSelector(workers.length)

		const result = await selector.selectWorker(workers, '123456789012345678')
		assert.strictEqual(result.id, 1)
	})

	it('handles large Discord snowflake IDs without overflow', async () => {
		const workers = [makeWorker(1), makeWorker(2)]
		const selector = new BotSelector(workers.length)

		const largeIds = [
			'999999999999999999',
			'1099511627775999999',
			'18446744073709551615',
		]

		for (const uid of largeIds) {
			const result = await selector.selectWorker(workers, uid)
			assert(result.id === 1 || result.id === 2, `Should return a valid worker for ID ${uid}`)
		}
	})
})

describe('Redis sticky fallback overrides', () => {
	it('stores override in Redis when primary is busy', async () => {
		const redis = makeFakeRedis()
		const workers = [
			makeWorker(1, true),
			makeWorker(2, false, 5),
			makeWorker(3, false, 1),
		]
		const selector = new BotSelector(workers.length, redis)

		const userId = '300000000000000000' // maps to index 0
		const result = await selector.selectWorker(workers, userId)

		assert.strictEqual(result.id, 3, 'Should pick least-loaded')
		assert.strictEqual(redis.calls.set, 1, 'Should SET override in Redis')
		assert.strictEqual(redis.store.get(`poracle:botassign:${userId}`), '2') // index of worker 3
	})

	it('reuses cached override on subsequent calls', async () => {
		const redis = makeFakeRedis()
		const workers = [
			makeWorker(1, true),
			makeWorker(2, false, 5),
			makeWorker(3, false, 1),
		]
		const selector = new BotSelector(workers.length, redis)
		const userId = '300000000000000000'

		const first = await selector.selectWorker(workers, userId)
		assert.strictEqual(first.id, 3)
		assert.strictEqual(redis.calls.set, 1)

		// Second call should GET the cached value, not SET again
		const second = await selector.selectWorker(workers, userId)
		assert.strictEqual(second.id, 3)
		assert.strictEqual(redis.calls.get, 2)
		assert.strictEqual(redis.calls.set, 1, 'Should not SET again when override is valid')
	})

	it('ignores override if that bot is also busy and stores new fallback', async () => {
		const redis = makeFakeRedis()
		const workers = [
			makeWorker(1, true),
			makeWorker(2, true),
			makeWorker(3, false),
		]
		const selector = new BotSelector(workers.length, redis)
		const userId = '300000000000000000'

		// Pre-populate with an override pointing to worker index 1 (busy)
		redis.store.set(`poracle:botassign:${userId}`, '1')

		const result = await selector.selectWorker(workers, userId)
		assert.strictEqual(result.id, 3, 'Should skip busy override and find new fallback')
		assert.strictEqual(redis.store.get(`poracle:botassign:${userId}`), '2', 'Should update override to new bot')
	})

	it('two instances with same Redis agree on fallback bot', async () => {
		const redis = makeFakeRedis()
		const workersA = [
			makeWorker(1, true),
			makeWorker(2, false, 5),
			makeWorker(3, false, 1),
		]
		const workersB = [
			makeWorker(1, true),
			makeWorker(2, false, 5),
			makeWorker(3, false, 1),
		]
		const selectorA = new BotSelector(workersA.length, redis)
		const selectorB = new BotSelector(workersB.length, redis)
		const userId = '300000000000000000'

		// Instance A computes and stores override
		const resultA = await selectorA.selectWorker(workersA, userId)

		// Instance B reads the same override from Redis
		const resultB = await selectorB.selectWorker(workersB, userId)

		assert.strictEqual(resultA.id, resultB.id, 'Both instances should route to the same fallback bot')
	})

	it('makes no Redis calls when primary is healthy', async () => {
		const redis = makeFakeRedis()
		const workers = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const selector = new BotSelector(workers.length, redis)

		const userId = '300000000000000000' // maps to index 0, which is healthy
		await selector.selectWorker(workers, userId)

		assert.strictEqual(redis.calls.get, 0, 'Should not GET when primary is healthy')
		assert.strictEqual(redis.calls.set, 0, 'Should not SET when primary is healthy')
	})

	it('falls back to local behavior when no Redis client', async () => {
		const workers = [
			makeWorker(1, true),
			makeWorker(2, false, 10),
			makeWorker(3, false, 2),
		]
		const selector = new BotSelector(workers.length) // no redis

		const userId = '300000000000000000'
		const result = await selector.selectWorker(workers, userId)

		assert.strictEqual(result.id, 3, 'Should use least-loaded fallback without Redis')
	})

	it('falls back to local behavior when Redis throws', async () => {
		const brokenRedis = {
			async get() { throw new Error('connection refused') },
			async set() { throw new Error('connection refused') },
		}
		const workers = [
			makeWorker(1, true),
			makeWorker(2, false, 10),
			makeWorker(3, false, 2),
		]
		const selector = new BotSelector(workers.length, brokenRedis)

		const userId = '300000000000000000'
		const result = await selector.selectWorker(workers, userId)

		assert.strictEqual(result.id, 3, 'Should use local fallback when Redis errors')
	})
})
