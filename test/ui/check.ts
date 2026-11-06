import { expect } from 'vitest'

let ran = 0

/**
 * gpuix-svelte/test's comparison (the JSON of each side) as a soft assertion: a failed check fails the test by its
 * label and the suite goes on
 */
export function check(label: string, actual: unknown, expected: unknown = true): void {
	ran++
	expect.soft(JSON.stringify(actual), label).toBe(JSON.stringify(expected))
}

/** how many checks ran, held to a fixed count by `every check ran` in document.test.ts */
export const countChecks = () => ran
