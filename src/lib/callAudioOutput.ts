export type OutputKind = 'speaker' | 'receiver' | 'external' | 'system' | 'unknown';
export type OutputElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
type OutputDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
export type AudioOutputState = {
  mobile: boolean; supported: boolean; picker: boolean; pending: boolean;
  devices: MediaDeviceInfo[]; sinkId: string | null; kind: OutputKind; label: string; error: string;
};

/** Device identity, rather than window size, determines phone routing preferences. */
export function isMobileAudioDevice(nav: Navigator = navigator) {
  const hints = nav as Navigator & { userAgentData?: { mobile?: boolean } };
  return hints.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

// There is no standardized receiver/speaker role in MediaDeviceInfo. Only
// explicit labels can identify a phone output; opaque/localized labels stay unknown.
export function outputKind(device: Pick<MediaDeviceInfo, 'label'>): OutputKind {
  const label = device.label.trim();
  if (/bluetooth|headset|headphones?|earbuds?|airpods|\busb\b|wired|hands.?free|\bhdmi\b|\bdock\b/i.test(label)) return 'external';
  if (/^(default|communications|system default)\b/i.test(label)) return 'system';
  if (/\bearpiece\b|\b(internal|phone|built.in) receiver\b|^receiver$/i.test(label)) return 'receiver';
  if (/\bloudspeaker\b|\bspeakerphone\b|\b(phone|internal|built.in) speakers?\b|^speakers?$/i.test(label)) return 'speaker';
  return 'unknown';
}

function uniquePhoneOutput(devices: MediaDeviceInfo[], kind: 'speaker' | 'receiver') {
  const matches = devices.filter(d => d.kind === 'audiooutput' && d.deviceId && outputKind(d) === kind);
  const unique = [...new Map(matches.map(d => [d.deviceId, d])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function phoneOutputPair(devices: MediaDeviceInfo[]) {
  return { speaker: uniquePhoneOutput(devices, 'speaker'), receiver: uniquePhoneOutput(devices, 'receiver') };
}

function preserveSystemOutput(devices: MediaDeviceInfo[]) {
  return devices.some(d => d.kind !== 'videoinput' && (outputKind(d) === 'external'
    || (d.kind === 'audiooutput' && outputKind(d) === 'unknown')
    // An opaque microphone could be a headset whose output is permission-hidden.
    || (d.kind === 'audioinput' && outputKind(d) === 'unknown'
      && !/\b(built.in|internal|phone|iPhone|iPad) microphones?\b/i.test(d.label))));
}

function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Audio output selection timed out.')), ms);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, cause => { window.clearTimeout(timer); reject(cause); });
  });
}

/** One output policy per call. No capture, signaling or peer-connection changes. */
export class CallAudioOutput {
  private listeners = new Set<() => void>();
  private nodes = new Set<OutputElement>();
  private probe: OutputElement;
  private mediaDevices: OutputDevices | undefined;
  private running = false;
  private generation = 0;
  private initial: Promise<void> = Promise.resolve();
  private chain: Promise<unknown> = Promise.resolve();
  private operations = new Map<OutputElement, Promise<void>>();
  private defaultAttempted = false;
  private unavailableAttempted = new Set<string>();
  private target = '';
  private source: 'auto' | 'manual' | 'system' = 'system';
  private requestPending = false;
  private state: AudioOutputState;
  constructor(private callType: 'voice' | 'video') {
    this.probe = document.createElement('audio');
    this.mediaDevices = navigator.mediaDevices as OutputDevices | undefined;
    const supported = window.isSecureContext && typeof this.probe.setSinkId === 'function' && typeof this.probe.sinkId === 'string';
    this.state = { mobile: isMobileAudioDevice(), supported, picker: supported && typeof this.mediaDevices?.selectAudioOutput === 'function',
      pending: false, devices: [], sinkId: '', kind: 'system', label: 'System audio', error: '' };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AudioOutputState>) {
    if (!this.running) return;
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  private elements() { return [this.probe, ...this.nodes]; }
  private confirm() {
    const ids = this.elements().map(node => node.sinkId);
    const id = ids.every(value => typeof value === 'string' && value === ids[0]) ? ids[0]! : null;
    const device = this.state.devices.find(d => d.kind === 'audiooutput' && d.deviceId === id);
    this.publish({ sinkId: id, kind: id === '' ? 'system' : device ? outputKind(device) : 'unknown',
      label: id === '' ? 'System audio' : device?.label || 'Output not confirmed' });
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task); this.chain = result.catch(() => {}); return result;
  }
  private changed = () => { if (!document.hidden) void this.refresh(false); };
  start() {
    if (this.running) return this.initial;
    this.running = true; this.generation++;
    this.mediaDevices?.addEventListener('devicechange', this.changed);
    window.addEventListener('focus', this.changed);
    document.addEventListener('visibilitychange', this.changed);
    this.initial = this.refresh(true);
    return this.initial;
  }
  stop() {
    this.running = false; this.generation++;
    this.mediaDevices?.removeEventListener('devicechange', this.changed);
    window.removeEventListener('focus', this.changed);
    document.removeEventListener('visibilitychange', this.changed);
    this.nodes.clear();
  }
  private async refresh(initial: boolean) {
    const generation = this.generation;
    if (!this.state.supported) return;
    let devices: MediaDeviceInfo[];
    try { devices = await bounded(this.mediaDevices!.enumerateDevices(), 1500); }
    catch { return; } // Keep OS routing if enumeration is denied or unavailable.
    if (!this.running || generation !== this.generation) return;
    this.publish({ devices });
    this.confirm();
    await this.enqueue(async () => {
      if (!this.running || generation !== this.generation) return;
      const disappeared = this.target && !devices.some(d => d.kind === 'audiooutput' && d.deviceId === this.target);
      if ((disappeared && !this.unavailableAttempted.has(this.target)) || (this.source === 'auto' && preserveSystemOutput(devices))) {
        if (disappeared) this.unavailableAttempted.add(this.target);
        this.source = 'system'; // A rejected fallback must not retry on every focus/device event.
        this.defaultAttempted = true;
        await this.apply('', 'system');
        if (disappeared) this.publish({ error: 'The selected output is unavailable. Use system audio or choose another output.' });
      } else if (initial && !this.defaultAttempted) {
        this.defaultAttempted = true;
        if (this.state.mobile && !preserveSystemOutput(devices)) {
          const candidate = uniquePhoneOutput(devices, this.callType === 'video' ? 'speaker' : 'receiver');
          if (candidate) await this.apply(candidate.deviceId, 'auto');
        }
      }
      this.confirm();
    });
  }
  private async set(node: OutputElement, id: string) {
    // Browser calls cannot be aborted. Never overlap a new request with a slow
    // request on the same element, even after the UI timeout has elapsed.
    const previous = this.operations.get(node);
    if (previous) await bounded(previous.catch(() => {}), 3000);
    if (!this.running || (node !== this.probe && !this.nodes.has(node))) return;
    if (node.sinkId === id) return;
    if (!node.setSinkId) throw new Error('Audio output selection is unavailable.');
    const operation = node.setSinkId(id);
    this.operations.set(node, operation);
    const settled = () => {
      if (this.operations.get(node) === operation) this.operations.delete(node);
      if (!this.running || this.state.pending || (node !== this.probe && !this.nodes.has(node))) return;
      this.confirm();
      if (node.sinkId !== this.target) void this.enqueue(async () => {
        if (!this.running || (node !== this.probe && !this.nodes.has(node))) return;
        // Restore the current choice once if an abandoned browser request completes late.
        this.publish({ pending: true });
        try { await this.set(node, this.target); } catch { /* Keep the confirmed actual state and existing error. */ }
        this.confirm(); this.publish({ pending: false });
      });
    };
    void operation.then(settled, settled);
    await bounded(operation, 3000);
    if (node.sinkId !== id) throw new Error('The audio output could not be confirmed.');
  }
  private async apply(id: string, source: typeof this.source) {
    if (!this.running || !this.state.supported) return false;
    const generation = this.generation, nodes = this.elements();
    const before = new Map(nodes.map(node => [node, node.sinkId ?? '']));
    this.publish({ pending: true, error: '' });
    const results = await Promise.allSettled(nodes.map(node => this.set(node, id)));
    if (!this.running || generation !== this.generation) return false;
    if (results.some(result => result.status === 'rejected')) {
      // Revert successful participants if a group-call output switch only partly succeeds.
      await Promise.allSettled(nodes.map(node => this.set(node, before.get(node)!)));
      if (!this.running || generation !== this.generation) return false;
      this.confirm();
      this.publish({ pending: false, error: 'Audio output could not be confirmed for the whole call. Check your phone audio controls or choose another output.' });
      return false;
    }
    this.target = id; this.source = source;
    this.unavailableAttempted.delete(id);
    this.confirm(); this.publish({ pending: false, error: '' });
    return true;
  }
  register(node: OutputElement) {
    this.nodes.add(node);
    if (this.running && this.state.supported) this.confirm();
    const ready = this.start().then(() => this.enqueue(async () => {
      if (!this.running || !this.nodes.has(node) || !this.state.supported) return;
      try { await this.set(node, this.target); this.confirm(); }
      catch { this.confirm(); this.publish({ error: 'This participant’s audio output could not be changed. Use system audio or choose another output.' }); }
    }));
    return { ready, release: () => { this.nodes.delete(node); if (this.running && this.state.supported) this.confirm(); } };
  }
  async select(id: string) {
    if (!this.state.supported || this.requestPending || this.state.pending) return;
    this.requestPending = true; this.defaultAttempted = true;
    try { await this.initial; await this.enqueue(() => this.apply(id, 'manual')); }
    finally { this.requestPending = false; }
  }
  async choose() {
    if (!this.state.picker || this.requestPending || this.state.pending) return;
    this.requestPending = true; this.defaultAttempted = true;
    this.publish({ pending: true, error: '' });
    try {
      // Invoke within the click handler, before any await: the picker needs activation.
      const device = await this.mediaDevices!.selectAudioOutput!();
      await this.initial;
      if (!this.running) return;
      const devices = this.state.devices.filter(d => d.deviceId !== device.deviceId || d.kind !== 'audiooutput');
      this.publish({ devices: [...devices, device] });
      await this.enqueue(() => this.apply(device.deviceId, 'manual'));
    } catch { this.publish({ error: 'No audio output was selected. The call keeps its current output.' }); }
    finally { this.requestPending = false; this.publish({ pending: false }); }
  }
  toggleSpeaker() {
    const { speaker, receiver } = phoneOutputPair(this.state.devices);
    if (speaker && receiver) return this.select(this.state.kind === 'speaker' ? receiver.deviceId : speaker.deviceId);
  }
}
