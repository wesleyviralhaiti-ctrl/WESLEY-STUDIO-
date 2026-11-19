
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Disc,
  FolderOpen,
  Pause,
  Play,
  Radio,
  Search,
  Sliders,
  Sparkles,
  Usb,
  Volume2,
  Music,
} from 'lucide-react';
import {
  DeckTrack,
  extractWaveformPeaks,
  SeratoDeckEngine,
  StemState,
  synthesizeStarterTrack,
  triggerSamplerFX,
} from './lib/audioEngine';

type MidiAction =
  | 'deck1_play'
  | 'deck1_cue'
  | 'deck1_sync'
  | 'deck1_jog'
  | 'deck1_pitch'
  | 'deck1_vol'
  | 'deck1_low'
  | 'deck1_mid'
  | 'deck1_high'
  | 'deck1_filter'
  | 'deck2_play'
  | 'deck2_cue'
  | 'deck2_sync'
  | 'deck2_jog'
  | 'deck2_pitch'
  | 'deck2_vol'
  | 'deck2_low'
  | 'deck2_mid'
  | 'deck2_high'
  | 'deck2_filter'
  | 'crossfader';

const DEFAULT_MIDI_MAP: Record<string, MidiAction> = {
  '144:11': 'deck1_play',
  '145:11': 'deck2_play',
  '144:12': 'deck1_cue',
  '145:12': 'deck2_cue',
  '144:88': 'deck1_sync',
  '145:88': 'deck2_sync',
  '176:34': 'deck1_jog',
  '177:34': 'deck2_jog',
  '176:0': 'deck1_pitch',
  '177:0': 'deck2_pitch',
  '176:19': 'deck1_vol',
  '177:19': 'deck2_vol',
  '176:15': 'deck1_low',
  '176:11': 'deck1_mid',
  '176:7': 'deck1_high',
  '176:23': 'deck1_filter',
  '177:15': 'deck2_low',
  '177:11': 'deck2_mid',
  '177:7': 'deck2_high',
  '177:23': 'deck2_filter',
  '182:31': 'crossfader',
};

const HOT_CUE_COLORS = [
  '#EF4444',
  '#3B82F6',
  '#22C55E',
  '#EAB308',
  '#F97316',
  '#A855F7',
  '#06B6D4',
  '#EC4899',
];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

export default function App() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBusRef = useRef<GainNode | null>(null);
  const deck1EngineRef = useRef<SeratoDeckEngine | null>(null);
  const deck2EngineRef = useRef<SeratoDeckEngine | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [library, setLibrary] = useState<DeckTrack[]>([]);
  const [selectedCrate, setSelectedCrate] = useState<string>('All Audio');
  const [searchQuery, setSearchQuery] = useState('');
  const [clock, setClock] = useState('');

  const [d1Track, setD1Track] = useState<DeckTrack | null>(null);
  const [d1Playing, setD1Playing] = useState(false);
  const [d1Time, setD1Time] = useState(0);
  const [d1Pitch, setD1Pitch] = useState(1.0);
  const [d1Vol, setD1Vol] = useState(0.85);
  const [d1Eq, setD1Eq] = useState({ low: 0.5, mid: 0.5, high: 0.5, filter: 0.5 });
  const [d1Stems, setD1Stems] = useState<StemState>({ vocal: true, drums: true, bass: true, melody: true });
  const [d1Loop, setD1Loop] = useState<number | null>(null);
  const [d1Cues, setD1Cues] = useState<(number | null)[]>(Array(8).fill(null));
  const [d1Level, setD1Level] = useState(0);

  const [d2Track, setD2Track] = useState<DeckTrack | null>(null);
  const [d2Playing, setD2Playing] = useState(false);
  const [d2Time, setD2Time] = useState(0);
  const [d2Pitch, setD2Pitch] = useState(1.0);
  const [d2Vol, setD2Vol] = useState(0.85);
  const [d2Eq, setD2Eq] = useState({ low: 0.5, mid: 0.5, high: 0.5, filter: 0.5 });
  const [d2Stems, setD2Stems] = useState<StemState>({ vocal: true, drums: true, bass: true, melody: true });
  const [d2Loop, setD2Loop] = useState<number | null>(null);
  const [d2Cues, setD2Cues] = useState<(number | null)[]>(Array(8).fill(null));
  const [d2Level, setD2Level] = useState(0);

  const [crossfader, setCrossfader] = useState(0.5);
  const [masterVol, setMasterVol] = useState(0.9);
  const [isRecording, setIsRecording] = useState(false);
  const [showSampler, setShowSampler] = useState(true);

  const [midiDeviceName, setMidiDeviceName] = useState<string | null>(null);
  const [midiPreset, setMidiPreset] = useState<string>('Auto-Detect Universal');
  const [midiLearnMode, setMidiLearnMode] = useState(false);
  const [midiLearnTarget, setMidiLearnTarget] = useState<MidiAction | null>(null);
  const [midiMap, setMidiMap] = useState<Record<string, MidiAction>>(() => {
    try {
      const saved = localStorage.getItem('wesley_midi_map_v1');
      return saved ? { ...DEFAULT_MIDI_MAP, ...JSON.parse(saved) } : DEFAULT_MIDI_MAP;
    } catch {
      return DEFAULT_MIDI_MAP;
    }
  });

  const d1PlatterRef = useRef<HTMLCanvasElement | null>(null);
  const d2PlatterRef = useRef<HTMLCanvasElement | null>(null);
  const centerWaveRef = useRef<HTMLCanvasElement | null>(null);
  const scratchDragRef = useRef<{ deck: 1 | 2; lastX: number } | null>(null);

  const ensureAudio = useCallback(() => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    audioCtxRef.current = ctx;
    masterBusRef.current = master;
    deck1EngineRef.current = new SeratoDeckEngine(ctx, master);
    deck2EngineRef.current = new SeratoDeckEngine(ctx, master);
    return ctx;
  }, []);

  useEffect(() => {
    const ctx = ensureAudio();
    const starters: {
      id: string;
      title: string;
      artist: string;
      bpm: number;
      album: string;
      genre: string;
      key: string;
      style: 'konpa' | 'raboday' | 'afrobeat' | 'drill';
    }[] = [
      { id: 'st_1', title: 'Kreyòl Sunset Groove (Live)', artist: 'DJ Wesley VIP', bpm: 98, album: 'Konpa Sessions Vol. 1', genre: 'Konpa', key: '9d', style: 'konpa' },
      { id: 'st_2', title: 'Port-au-Prince Bassline', artist: 'Rabòday Riddim Crew', bpm: 126, album: 'Ayiti Chofe', genre: 'Rabòday', key: '11d', style: 'raboday' },
      { id: 'st_3', title: 'Delmas Midnight Konpa', artist: 'Klass & DJ Wesley', bpm: 95, album: 'Konpa Gold', genre: 'Konpa', key: '8m', style: 'konpa' },
      { id: 'st_4', title: 'Lagos To Jacmel Riddim', artist: 'AfroKreyòl Sound', bpm: 114, album: 'Afrobeat Fusion', genre: 'Afrobeat', key: '12m', style: 'afrobeat' },
      { id: 'st_5', title: 'Petion-Ville Heavy Drill', artist: '808 Haiti', bpm: 142, album: 'Street Anthems', genre: 'Rap Kreyòl', key: '6m', style: 'drill' },
      { id: 'st_6', title: 'Kanaval 2026 Brass Drop', artist: 'DJ Wesley Studio', bpm: 130, album: 'Kanaval Pack', genre: 'Rabòday', key: '10d', style: 'raboday' },
    ];

    const built: DeckTrack[] = starters.map((s) => {
      const buf = synthesizeStarterTrack(ctx, s.bpm, s.style);
      return {
        id: s.id,
        title: s.title,
        artist: s.artist,
        bpm: s.bpm,
        album: s.album,
        length: '00:32.0',
        genre: s.genre,
        musicalKey: s.key,
        buffer: buf,
        peaks: extractWaveformPeaks(buf),
      };
    });

    setLibrary(built);
    const first = built[0];
    const second = built[1];
    if (first && first.buffer) {
      setD1Track(first);
      deck1EngineRef.current?.loadBuffer(first.buffer);
    }
    if (second && second.buffer) {
      setD2Track(second);
      deck2EngineRef.current?.loadBuffer(second.buffer);
    }
  }, [ensureAudio]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const loadTrackToDeck = useCallback(
    (deck: 1 | 2, track: DeckTrack) => {
      ensureAudio();
      if (!track.buffer) return;
      if (deck === 1) {
        deck1EngineRef.current?.loadBuffer(track.buffer);
        setD1Track(track);
        setD1Playing(false);
        setD1Time(0);
        setD1Pitch(1.0);
        setD1Loop(null);
        setD1Cues(Array(8).fill(null));
        setD1Stems({ vocal: true, drums: true, bass: true, melody: true });
      } else {
        deck2EngineRef.current?.loadBuffer(track.buffer);
        setD2Track(track);
        setD2Playing(false);
        setD2Time(0);
        setD2Pitch(1.0);
        setD2Loop(null);
        setD2Cues(Array(8).fill(null));
        setD2Stems({ vocal: true, drums: true, bass: true, melody: true });
      }
    },
    [ensureAudio]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const ctx = ensureAudio();
    const loaded: DeckTrack[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const arrBuf = await file.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrBuf);
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        const parts = cleanName.split(' - ');
        const artist = parts.length > 1 ? parts[0].trim() : 'Local MP3';
        const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : cleanName;
        const mins = Math.floor(audioBuf.duration / 60);
        const secs = Math.floor(audioBuf.duration % 60);

        loaded.push({
          id: `loc_${Date.now()}_${i}`,
          title,
          artist,
          bpm: 118,
          album: 'Imported Audio',
          length: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.0`,
          genre: 'Local MP3',
          musicalKey: '9d',
          buffer: audioBuf,
          peaks: extractWaveformPeaks(audioBuf),
        });
      } catch {
        // skip unsupported file
      }
    }

    if (loaded.length > 0) {
      setLibrary((prev) => [...loaded, ...prev]);
      loadTrackToDeck(1, loaded[0]);
      if (loaded.length > 1) loadTrackToDeck(2, loaded[1]);
    }
