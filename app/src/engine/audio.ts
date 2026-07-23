// 程序生成的火车环境音：棕噪声底噪（过轨隆隆声）+ 节奏性"咣当"声
export class TrainAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private clackTimer: number | null = null;
  private clackAcc = 0;
  private speed = 0;
  private running = false;

  start() {
    if (this.running) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    // 棕噪声循环
    const len = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0;
    src.connect(lp).connect(this.rumbleGain).connect(this.master);
    src.start();

    this.master.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 2);
    this.clackTimer = window.setInterval(() => this.tickClack(), 60);
    this.running = true;
  }

  setSpeed(s: number) {
    this.speed = s;
    if (this.rumbleGain && this.ctx) {
      this.rumbleGain.gain.setTargetAtTime(s * 0.6, this.ctx.currentTime, 0.4);
    }
  }

  private tickClack() {
    if (!this.ctx || this.speed < 0.06) return;
    // 速度越快，咣当越密
    this.clackAcc += this.speed * 0.06 * 2.2;
    if (this.clackAcc >= 1) {
      this.clackAcc = 0;
      this.clack();
      window.setTimeout(() => this.clack(), 130); // "咣-当"双响
    }
  }

  private clack() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const dur = 0.05;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 300;
    bp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.value = 0.35 * this.speed;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
  }

  // 进站提示音"叮-咚"
  chime() {
    if (!this.ctx || !this.master) return;
    const notes = [880, 660];
    notes.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const t = this.ctx!.currentTime + i * 0.35;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  stop() {
    if (!this.running || !this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    if (this.clackTimer) window.clearInterval(this.clackTimer);
    const ctx = this.ctx;
    window.setTimeout(() => ctx.close(), 1500);
    this.running = false;
    this.ctx = null;
    this.master = null;
    this.rumbleGain = null;
  }

  get isRunning() {
    return this.running;
  }
}
