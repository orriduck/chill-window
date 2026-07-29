export interface TrainAudioMotion {
  speedRatio: number
  /** Physical speed change in world units per second squared. */
  acceleration: number
}

export interface TrainSoundMix {
  rollingGain: number
  tractionGain: number
  brakeGain: number
  tractionHz: number
  railInterval: number
  railGain: number
  brakePulseInterval: number
  brakePulseGain: number
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max)
}

/** A quiet electric commuter profile: traction rises while pulling away,
 * rolling texture takes over at cruise, and pneumatic/friction noise appears
 * only while the train is physically slowing down. */
export function trainSoundMix(motion: TrainAudioMotion): TrainSoundMix {
  const speed = clamp(motion.speedRatio)
  const acceleration = clamp(motion.acceleration / 3.5, -1, 1)
  const pulling = Math.max(0, acceleration)
  const braking = Math.max(0, -acceleration)

  return {
    rollingGain: 0.015 + speed * 0.21,
    tractionGain: pulling * (0.045 + speed * 0.2),
    brakeGain: braking * (0.025 + speed * 0.17),
    tractionHz: 46 + speed * 178 + pulling * 22,
    railInterval: 1 / (1.05 + speed * 4.15),
    railGain: speed * 0.16,
    brakePulseInterval: 1.45 - braking * 0.55,
    brakePulseGain: braking * (0.035 + speed * 0.1),
  }
}

/** Procedural in-cabin soundscape for an electric commuter train. */
export class TrainAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private rollingGain: GainNode | null = null
  private tractionGain: GainNode | null = null
  private brakeGain: GainNode | null = null
  private tractionOscillator: OscillatorNode | null = null
  private tractionHarmonic: OscillatorNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private steadySources: AudioScheduledSourceNode[] = []
  private nextRailPulseAt = 0
  private nextBrakePulseAt = 0
  private speedRatio = 0
  private running = false

  start() {
    if (this.running) return

    const ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    this.ctx = ctx
    this.master = master
    this.noiseBuffer = this.createNoiseBuffer(ctx)

    const rollingGain = ctx.createGain()
    const tractionGain = ctx.createGain()
    const brakeGain = ctx.createGain()
    rollingGain.gain.value = 0
    tractionGain.gain.value = 0
    brakeGain.gain.value = 0
    rollingGain.connect(master)
    tractionGain.connect(master)
    brakeGain.connect(master)
    this.rollingGain = rollingGain
    this.tractionGain = tractionGain
    this.brakeGain = brakeGain

    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.loop = true
    const rollingFilter = ctx.createBiquadFilter()
    rollingFilter.type = 'lowpass'
    rollingFilter.frequency.value = 220
    const brakeHighpass = ctx.createBiquadFilter()
    brakeHighpass.type = 'highpass'
    brakeHighpass.frequency.value = 360
    const brakeLowpass = ctx.createBiquadFilter()
    brakeLowpass.type = 'lowpass'
    brakeLowpass.frequency.value = 1450
    noise.connect(rollingFilter).connect(rollingGain)
    noise.connect(brakeHighpass).connect(brakeLowpass).connect(brakeGain)
    noise.start()
    this.steadySources.push(noise)

    const tractionOscillator = ctx.createOscillator()
    tractionOscillator.type = 'sine'
    tractionOscillator.frequency.value = 46
    tractionOscillator.connect(tractionGain)
    tractionOscillator.start()
    const tractionHarmonic = ctx.createOscillator()
    tractionHarmonic.type = 'triangle'
    tractionHarmonic.detune.value = 6
    tractionHarmonic.frequency.value = 92
    const harmonicGain = ctx.createGain()
    harmonicGain.gain.value = 0.34
    tractionHarmonic.connect(harmonicGain).connect(tractionGain)
    tractionHarmonic.start()
    this.tractionOscillator = tractionOscillator
    this.tractionHarmonic = tractionHarmonic
    this.steadySources.push(tractionOscillator, tractionHarmonic)

    master.gain.linearRampToValueAtTime(0.46, ctx.currentTime + 1.1)
    this.running = true
    void ctx.resume()
  }

  setMotion(motion: TrainAudioMotion) {
    if (!this.ctx || !this.master || !this.running) return

    const mix = trainSoundMix(motion)
    const time = this.ctx.currentTime
    this.speedRatio = clamp(motion.speedRatio)
    this.rollingGain?.gain.setTargetAtTime(mix.rollingGain, time, 0.28)
    this.tractionGain?.gain.setTargetAtTime(mix.tractionGain, time, 0.16)
    this.brakeGain?.gain.setTargetAtTime(mix.brakeGain, time, 0.12)
    this.tractionOscillator?.frequency.setTargetAtTime(mix.tractionHz, time, 0.18)
    this.tractionHarmonic?.frequency.setTargetAtTime(mix.tractionHz * 2.02, time, 0.18)

    if (this.speedRatio < 0.06) {
      this.nextRailPulseAt = time
      this.nextBrakePulseAt = time
      return
    }
    if (time >= this.nextRailPulseAt) {
      this.emitRailPulse(mix, time)
      this.nextRailPulseAt = time + mix.railInterval
    }
    if (mix.brakePulseGain > 0.004 && time >= this.nextBrakePulseAt) {
      this.emitBrakePulse(mix, time)
      this.nextBrakePulseAt = time + mix.brakePulseInterval
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 3
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let brown = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      brown = (brown + white * 0.035) / 1.035
      data[i] = brown * 0.82 + white * 0.18
    }
    return buffer
  }

  private emitRailPulse(mix: TrainSoundMix, time: number) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return
    const source = this.ctx.createBufferSource()
    source.buffer = this.noiseBuffer
    const bandpass = this.ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = 420 + this.speedRatio * 280
    bandpass.Q.value = 1.5
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.001, time)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, mix.railGain), time + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07)
    source.connect(bandpass).connect(gain).connect(this.master)
    source.start(time)
    source.stop(time + 0.08)
  }

  /** A short filtered air release gives braking a physical cadence without
   * masking the rolling bed. It only appears while measured deceleration is
   * present, so coasting remains quiet. */
  private emitBrakePulse(mix: TrainSoundMix, time: number) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return
    const source = this.ctx.createBufferSource()
    source.buffer = this.noiseBuffer
    const highpass = this.ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 650
    const lowpass = this.ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 2100
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.001, time)
    gain.gain.linearRampToValueAtTime(Math.max(0.001, mix.brakePulseGain), time + 0.035)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.34)
    source.connect(highpass).connect(lowpass).connect(gain).connect(this.master)
    source.start(time)
    source.stop(time + 0.36)
  }

  /** A restrained two-note departure/arrival signal, independent of train motion. */
  chime() {
    if (!this.ctx || !this.master) return
    const notes = [880, 660]
    notes.forEach((frequency, index) => {
      const oscillator = this.ctx!.createOscillator()
      const gain = this.ctx!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const time = this.ctx!.currentTime + index * 0.35
      gain.gain.setValueAtTime(0, time)
      gain.gain.linearRampToValueAtTime(0.16, time + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.9)
      oscillator.connect(gain).connect(this.master!)
      oscillator.start(time)
      oscillator.stop(time + 1)
    })
  }

  stop() {
    if (!this.running || !this.ctx || !this.master) return
    const ctx = this.ctx
    const sources = this.steadySources
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.24)
    window.setTimeout(() => {
      for (const source of sources) {
        try {
          source.stop()
        } catch {
          // A source may already have been stopped by the browser.
        }
      }
      void ctx.close()
    }, 900)
    this.running = false
    this.ctx = null
    this.master = null
    this.rollingGain = null
    this.tractionGain = null
    this.brakeGain = null
    this.tractionOscillator = null
    this.tractionHarmonic = null
    this.noiseBuffer = null
    this.steadySources = []
  }

  get isRunning() {
    return this.running
  }
}
