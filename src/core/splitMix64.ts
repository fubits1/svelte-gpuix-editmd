/**
 * seeded generator, so a failing simulation can be replayed from its seed; `int`/`double` are not bit-compatible with Swift's `random(in:using:)`
 */

const MASK = (1n << 64n) - 1n

export class SplitMix64 {
	#state: bigint

	constructor(seed: number | bigint) {
		this.#state = BigInt(seed) & MASK
	}

	next(): bigint {
		this.#state = (this.#state + 0x9e3779b97f4a7c15n) & MASK
		let z = this.#state
		z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK
		z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK
		return z ^ (z >> 31n)
	}

	/** uniform in [0, 1) */
	unit(): number {
		return Number(this.next() >> 11n) / 2 ** 53
	}

	/** uniform in [low, high] */
	double(low: number, high: number): number {
		return low + this.unit() * (high - low)
	}

	/** uniform integer in [low, high] */
	int(low: number, high: number): number {
		return low + Math.floor(this.unit() * (high - low + 1))
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(0, items.length - 1)]!
	}
}
