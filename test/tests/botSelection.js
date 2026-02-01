const assert = require('assert')

/**
 * Replicate the deterministic bot selection logic from src/app.js
 * so it can be tested in isolation without Discord connections.
 */
function selectWorker(discordWorkers, target) {
	const workerCount = BigInt(discordWorkers.length)
	const targetBigInt = BigInt(target)
	const primaryIndex = Number(targetBigInt % workerCount)
	let worker = discordWorkers[primaryIndex]

	if (worker.busy) {
		const fallback = discordWorkers.filter((w) => !w.busy)
		if (fallback.length) {
			fallback.sort((a, b) => a.discordQueue.length - b.discordQueue.length)
			worker = fallback[0]
		}
	}

	return worker
}

function makeWorker(id, busy = false, queueLength = 0) {
	return {
		id,
		busy,
		discordQueue: new Array(queueLength),
	}
}

describe('Deterministic bot selection', () => {
	it('assigns the same bot for the same user ID every time', () => {
		const workers = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const userId = '123456789012345678' // typical Discord snowflake

		const first = selectWorker(workers, userId)
		const second = selectWorker(workers, userId)
		const third = selectWorker(workers, userId)

		assert.strictEqual(first.id, second.id)
		assert.strictEqual(second.id, third.id)
	})

	it('produces the same result regardless of instance (stateless)', () => {
		// Simulate two independent instances with identical worker arrays
		const instanceA = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const instanceB = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const userId = '987654321098765432'

		const resultA = selectWorker(instanceA, userId)
		const resultB = selectWorker(instanceB, userId)

		assert.strictEqual(resultA.id, resultB.id)
	})

	it('distributes users across bots', () => {
		const workers = [makeWorker(1), makeWorker(2), makeWorker(3)]
		const assignments = new Set()

		// Use a range of Discord-like snowflake IDs
		const userIds = [
			'100000000000000000',
			'100000000000000001',
			'100000000000000002',
			'200000000000000000',
			'300000000000000000',
			'400000000000000000',
		]

		for (const uid of userIds) {
			assignments.add(selectWorker(workers, uid).id)
		}

		// With 6 users and 3 bots, we expect at least 2 bots to be used
		assert(assignments.size >= 2, `Expected distribution across bots, got ${assignments.size} unique bot(s)`)
	})

	it('falls back to a healthy bot when primary is busy', () => {
		const workers = [
			makeWorker(1, true),  // busy (disconnected)
			makeWorker(2, false),
			makeWorker(3, false),
		]

		// Pick a user ID that maps to worker index 0 (the busy one)
		// BigInt('300000000000000000') % 3n === 0n
		const userId = '300000000000000000'
		const primaryIndex = Number(BigInt(userId) % BigInt(workers.length))
		assert.strictEqual(primaryIndex, 0, 'Test setup: user should map to index 0')

		const result = selectWorker(workers, userId)
		assert.notStrictEqual(result.id, 1, 'Should not use the busy bot')
		assert.strictEqual(result.busy, false)
	})

	it('falls back to the bot with the shortest queue', () => {
		const workers = [
			makeWorker(1, true),           // busy
			makeWorker(2, false, 10),      // healthy, 10 queued
			makeWorker(3, false, 2),       // healthy, 2 queued
		]

		const userId = '300000000000000000' // maps to index 0 (busy)
		const result = selectWorker(workers, userId)

		assert.strictEqual(result.id, 3, 'Should pick bot with shortest queue')
	})

	it('uses primary anyway if all bots are busy', () => {
		const workers = [
			makeWorker(1, true),
			makeWorker(2, true),
			makeWorker(3, true),
		]

		const userId = '300000000000000000' // maps to index 0
		const result = selectWorker(workers, userId)

		assert.strictEqual(result.id, 1, 'Should fall back to primary when all busy')
	})

	it('works with a single bot', () => {
		const workers = [makeWorker(1)]
		const userId = '123456789012345678'

		const result = selectWorker(workers, userId)
		assert.strictEqual(result.id, 1)
	})

	it('handles large Discord snowflake IDs without overflow', () => {
		const workers = [makeWorker(1), makeWorker(2)]

		// Max-range snowflake IDs
		const largeIds = [
			'999999999999999999',
			'1099511627775999999',
			'18446744073709551615', // near uint64 max
		]

		for (const uid of largeIds) {
			const result = selectWorker(workers, uid)
			assert(result.id === 1 || result.id === 2, `Should return a valid worker for ID ${uid}`)
		}
	})
})
