/**
 * Stateful mono resampler (linear interpolation), ported from the F0 algorithm
 * that already produced 16 kHz mono PCM16 the downstream consumer accepted.
 *
 * Contract:
 *  - output length is within ±1 sample of `inputLength * targetRate / sourceRate`
 *  - no drift across an unbounded number of pushes (the phase position is kept
 *    as a fractional carry, not rounded per chunk)
 *  - identity when sourceRate === targetRate (no resampling work at all)
 */

export class LinearResampler {
	private sourceRate: number
	private readonly targetRate: number
	private step = 1
	/** Fractional read position into `pending`. */
	private position = 0
	private pending: number[] = []

	constructor(targetRate: number) {
		this.targetRate = targetRate
		this.sourceRate = targetRate
	}

	reset(sourceRate: number): void {
		this.sourceRate = sourceRate
		this.step = sourceRate === this.targetRate ? 1 : sourceRate / this.targetRate
		this.position = 0
		this.pending = []
	}

	get isIdentity(): boolean {
		return this.step === 1
	}

	/** Buffer input; consumes nothing. */
	push(samples: Float32Array | number[]): void {
		if (this.pending.length === 0 && samples instanceof Float32Array) {
			// Avoid an extra copy for the common case.
			this.pending = Array.from(samples)
			return
		}
		for (let i = 0; i < samples.length; i++) {
			this.pending.push(samples[i])
		}
	}

	/** Produce every output sample the buffered input can support. */
	drain(): Float32Array {
		if (this.isIdentity) {
			const out = Float32Array.from(this.pending)
			this.pending = []
			this.position = 0
			return out
		}
		const out: number[] = []
		while (this.position + 1 < this.pending.length) {
			const index = Math.floor(this.position)
			const frac = this.position - index
			const a = this.pending[index]
			const b = this.pending[index + 1]
			out.push(a + (b - a) * frac)
			this.position += this.step
		}
		const consumed = Math.floor(this.position)
		if (consumed > 0) {
			this.pending.splice(0, consumed)
			this.position -= consumed
		}
		return Float32Array.from(out)
	}

	/** Flush the interpolation carry-over (end of stream). */
	flush(): Float32Array {
		if (this.isIdentity) {
			return this.drain()
		}
		const out: number[] = []
		while (this.position < this.pending.length) {
			const index = Math.floor(this.position)
			const frac = this.position - index
			const a = this.pending[index]
			const b = index + 1 < this.pending.length ? this.pending[index + 1] : a
			out.push(a + (b - a) * frac)
			this.position += this.step
		}
		this.pending = []
		this.position = 0
		return Float32Array.from(out)
	}
}

/** One-shot resampling for callers holding a complete buffer. */
export function resampleAll(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
	if (sourceRate === targetRate) return input
	const resampler = new LinearResampler(targetRate)
	resampler.reset(sourceRate)
	resampler.push(input)
	const out = resampler.drain()
	const tail = resampler.flush()
	if (tail.length === 0) {
		return out
	}
	const merged = new Float32Array(out.length + tail.length)
	merged.set(out, 0)
	merged.set(tail, out.length)
	return merged
}

/** Expected output length for a given input length (±1 sample in practice). */
export function expectedOutputLength(inputLength: number, sourceRate: number, targetRate: number): number {
	return Math.round((inputLength * targetRate) / sourceRate)
}
