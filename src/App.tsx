import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

type Mode = 'walk' | 'paint_center' | 'view_left' | 'view_right';
type Zone = 'none' | 'center' | 'left' | 'right';
interface Poster { id: string; image: string; author: string; date: string; }

const KEY = 'artgradis_gallery_posters_v1';
const COLORS = ['#ff3b30','#ff007a','#7928ca','#0029ff','#00f2fe','#00e096','#a8ff3e','#ffd60a','#ff8800','#ffffff','#141416'];

function Player({ mode, setZone }: { mode: Mode; setZone: (z: Zone) => void }) {
  const mesh = useRef<THREE.Mesh>(null!);
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const s = useRef({ pos: new THREE.Vector3(0, 0.45, 1.8), rot: 0, k: { w:0, s:0, a:0, d:0 } });

  const ballTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#9e9ea6';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#111114';
    ctx.fillRect(216, 0, 80, 512);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(212, 0, 4, 512);
    ctx.fillRect(296, 0, 4, 512);
    return new THREE.CanvasTexture(c);
  }, []);

  useEffect(() => {
    const onK = (e: KeyboardEvent, v: number) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') s.current.k.w = v;
      if (k === 's' || k === 'arrowdown') s.current.k.s = v;
      if (k === 'a' || k === 'arrowleft') s.current.k.a = v;
      if (k === 'd' || k === 'arrowright') s.current.k.d = v;
    };
    const d = (e: KeyboardEvent) => onK(e, 1), u = (e: KeyboardEvent) => onK(e, 0);
    window.addEventListener('keydown', d); window.addEventListener('keyup', u);
    return () => { window.removeEventListener('keydown', d); window.removeEventListener('keyup', u); };
  }, []);

  useFrame(({ camera }, dt) => {
    const targets: Record<string, [THREE.Vector3, THREE.Vector3]> = {
      paint_center: [new THREE.Vector3(0, 2.3, -2.1), new THREE.Vector3(0, 2.3, -4.9)],
      view_left: [new THREE.Vector3(-2.2, 2.3, -1), new THREE.Vector3(-4.9, 2.3, -1)],
      view_right: [new THREE.Vector3(2.2, 2.3, -1), new THREE.Vector3(4.9, 2.3, -1)],
    };

    if (targets[mode]) {
      camera.position.lerp(targets[mode][0], dt * 4);
      look.current.lerp(targets[mode][1], dt * 5);
      camera.lookAt(look.current);
      return;
    }

    const { k } = s.current;
    if (k.a) s.current.rot += 2.9 * dt;
    if (k.d) s.current.rot -= 2.9 * dt;
    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.current.rot);
    const n = s.current.pos.clone();
    if (k.w) n.addScaledVector(fwd, 5.2 * dt);
    if (k.s) n.addScaledVector(fwd, -3.5 * dt);

    n.x = Math.max(-4.3, Math.min(4.3, n.x));
    n.z = Math.max(-4.3, Math.min(25.2, n.z));
    if (!(n.x > -1.95 && n.x < 1.95 && n.z > -0.35 && n.z < 1.35)) s.current.pos.copy(n);
    if (mesh.current) { mesh.current.position.copy(s.current.pos); mesh.current.rotation.y = s.current.rot; }

    const dC = s.current.pos.distanceTo(new THREE.Vector3(0, 0.45, -4.9));
    const dL = s.current.pos.distanceTo(new THREE.Vector3(-4.9, 0.45, -1));
    const dR = s.current.pos.distanceTo(new THREE.Vector3(4.9, 0.45, -1));
    setZone(dC < 2.7 ? 'center' : dL < 2.7 ? 'left' : dR < 2.7 ? 'right' : 'none');

    const camT = s.current.pos.clone().add(new THREE.Vector3(0, 2.1, 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.current.rot));
    camera.position.lerp(camT, Math.min(dt * 8, 1));
    look.current.lerp(s.current.pos.clone().add(new THREE.Vector3(0, 0.75, 0)), Math.min(dt * 10, 1));
    camera.lookAt(look.current);
  });

  return (
    <mesh ref={mesh} position={[0, 0.45, 1.8]}>
      <sphereGeometry args={[0.42, 32, 32]} />
      <meshStandardMaterial map={ballTex} roughness={0.25} metalness={0.15} />
    </mesh>
  );
}

function MainPoster({ tex, cvs, mode, tool, color, size, text, font }: {
  tex: THREE.CanvasTexture; cvs: HTMLCanvasElement; mode: Mode; tool: string; color: string; size: number; text: string; font: string;
}) {
  const down = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const snap = useRef<ImageData | null>(null);
  const xy = (uv: THREE.Vector2) => ({ x: uv.x * 1024, y: (1 - uv.y) * 1024 });

  return (
    <group position={[0, 2.3, -4.9]}>
      <mesh
        onPointerDown={(e) => {
          if (mode !== 'paint_center' || !e.uv) return;
          e.stopPropagation(); down.current = true;
          const p = xy(e.uv); start.current = p;
          const ctx = cvs.getContext('2d'); if (!ctx) return;
          snap.current = ctx.getImageData(0, 0, 1024, 1024);
          ctx.fillStyle = ctx.strokeStyle = color;
          if (tool === 'brush') { ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill(); }
          else if (tool === 'spray') { for (let i = 0; i < 25; i++) ctx.fillRect(p.x + Math.cos(Math.random()*6.28)*Math.random()*size*1.6, p.y + Math.sin(Math.random()*6.28)*Math.random()*size*1.6, 2, 2); }
          else if (tool === 'stamp_cross') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x - 30, p.y); ctx.lineTo(p.x + 30, p.y); ctx.moveTo(p.x, p.y - 30); ctx.lineTo(p.x, p.y + 30); ctx.stroke(); }
          else if (tool === 'stamp_barcode') { for (let i = 0; i < 14; i++) ctx.fillRect(p.x - 60 + i * 9, p.y - 25, i % 3 === 0 ? 7 : 3, 50); }
          else if (tool === 'text') { ctx.font = `bold ${Math.max(32, size * 2)}px ${font}`; ctx.fillText(text || 'ARTGRADIS', p.x, p.y); }
          tex.needsUpdate = true;
        }}
        onPointerMove={(e) => {
          if (mode !== 'paint_center' || !down.current || !e.uv) return;
          e.stopPropagation();
          const p = xy(e.uv); const ctx = cvs.getContext('2d'); if (!ctx) return;
          ctx.fillStyle = ctx.strokeStyle = color;
          if (tool === 'brush') { ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill(); tex.needsUpdate = true; }
          else if (tool === 'spray') { for (let i = 0; i < 20; i++) ctx.fillRect(p.x + Math.cos(Math.random()*6.28)*Math.random()*size*1.6, p.y + Math.sin(Math.random()*6.28)*Math.random()*size*1.6, 2, 2); tex.needsUpdate = true; }
          else if (['rect', 'circle', 'line'].includes(tool) && start.current && snap.current) {
            ctx.putImageData(snap.current, 0, 0); ctx.lineWidth = Math.max(4, size / 2);
            if (tool === 'rect') ctx.strokeRect(start.current.x, start.current.y, p.x - start.current.x, p.y - start.current.y);
            else if (tool === 'circle') { ctx.beginPath(); ctx.arc(start.current.x, start.current.y, Math.hypot(p.x - start.current.x, p.y - start.current.y), 0, Math.PI * 2); ctx.stroke(); }
            else if (tool === 'line') { ctx.beginPath(); ctx.moveTo(start.current.x, start.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
            tex.needsUpdate = true;
          }
        }}
        onPointerUp={() => { down.current = false; }}
      >
        <planeGeometry args={[2.8, 3.8]} /><meshBasicMaterial map={tex} />
      </mesh>
      <mesh position={[0, 0, -0.02]}><planeGeometry args={[2.95, 3.95]} /><meshStandardMaterial color="#161618" roughness={0.4} /></mesh>
    </group>
  );
}

function LeftPoster({ mode }: { mode: Mode }) {
  const [m, setM] = useState({ x: 0.5, y: 0.5 });
  const [kineticMode, setKineticMode] = useState(0);
  const cvs = useMemo(() => document.createElement('canvas'), []);
  const tex = useMemo(() => new THREE.CanvasTexture(cvs), [cvs]);
  const modeNames = ['1/4: ВОЛНА', '2/4: СЖАТИЕ', '3/4: ГЛИТЧ', '4/4: ВИХРЬ'];

  useEffect(() => {
    cvs.width = 512; cvs.height = 768;
    const ctx = cvs.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = kineticMode === 2 ? '#ff2b06' : '#0e0e12';
    ctx.fillRect(0, 0, 512, 768);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let x = 0; x < 512; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 768); ctx.stroke(); }

    ctx.fillStyle = '#00f2fe'; ctx.font = 'bold 22px monospace';
    ctx.fillText(`[ ${modeNames[kineticMode]} ]`, 40, 60);
    ctx.fillStyle = '#888894'; ctx.font = '14px monospace';
    ctx.fillText('КЛИКАЙ ДЛЯ СМЕНЫ ФИЗИКИ', 40, 85);

    const words = ['KINETIC', 'SWISS', 'MOTION', 'DESIGN', 'SYSTEM', 'FUTURE'];
    words.forEach((w, i) => {
      ctx.save();
      const baseY = 160 + i * 95;
      if (kineticMode === 0) {
        const wave = Math.sin((m.y * 768 - baseY) * 0.015) * (m.x - 0.5) * 160;
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#ffd60a';
        ctx.font = '900 66px Helvetica, Arial, sans-serif';
        ctx.fillText(w, 40 + wave, baseY);
      } else if (kineticMode === 1) {
        const distY = Math.abs(m.y * 768 - baseY);
        ctx.translate(40, baseY);
        ctx.scale(1 + (m.x - 0.5) * 0.8, Math.max(0.4, 2.2 - distY * 0.005));
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 52px Helvetica, Arial, sans-serif';
        ctx.fillText(w, 0, 0);
      } else if (kineticMode === 2) {
        ctx.fillStyle = i % 2 === 0 ? '#111113' : '#ffffff';
        ctx.font = '900 68px monospace';
        ctx.fillText(w, 40 + (Math.random() - 0.5) * (m.x * 120), baseY);
      } else if (kineticMode === 3) {
        ctx.translate(256, baseY);
        ctx.rotate((m.x - 0.5) * (i + 1) * 0.35);
        ctx.fillStyle = '#00f2fe';
        ctx.font = '900 62px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(w, 0, 0);
      }
      ctx.restore();
    });

    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x * 512, m.y * 768, 30, 0, Math.PI * 2); ctx.stroke();
    tex.needsUpdate = true;
  }, [m, kineticMode, cvs, tex]);

  return (
    <group position={[-4.9, 2.3, -1]} rotation={[0, Math.PI / 2, 0]}>
      <mesh
        onPointerMove={(e) => { if (mode === 'view_left' && e.uv) setM({ x: e.uv.x, y: 1 - e.uv.y }); }}
        onClick={() => { if (mode === 'view_left') setKineticMode((p) => (p + 1) % 4); }}
      >
        <planeGeometry args={[2.2, 3.2]} /><meshBasicMaterial map={tex} />
      </mesh>
      <mesh position={[0, 0, -0.02]}><planeGeometry args={[2.3, 3.3]} /><meshStandardMaterial color="#111113" /></mesh>
    </group>
  );
}

function RightSculpture({ mode }: { mode: Mode }) {
  const mesh = useRef<THREE.Mesh>(null!);
  const [shape, setShape] = useState(0);
  useFrame((_, dt) => {
    if (mesh.current) {
      mesh.current.rotation.x += dt * 0.6; mesh.current.rotation.y += dt * 0.8;
      mesh.current.position.y = 2.3 + Math.sin(Date.now() * 0.002) * 0.15;
    }
  });

  return (
    <group position={[4.9, 0, -1]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, 2.3, -0.02]}><planeGeometry args={[2.3, 3.3]} /><meshStandardMaterial color="#111114" /></mesh>
      <mesh ref={mesh} position={[0, 2.3, 0.9]} scale={0.75} onClick={(e) => { if (mode === 'view_right') { e.stopPropagation(); setShape((p) => (p + 1) % 3); } }}>
        {shape === 0 && <icosahedronGeometry args={[1, 0]} />}
        {shape === 1 && <torusKnotGeometry args={[0.7, 0.25, 64, 16]} />}
        {shape === 2 && <octahedronGeometry args={[1, 0]} />}
        {shape === 0 && <meshStandardMaterial color="#ffd60a" metalness={0.9} roughness={0.15} />}
        {shape === 1 && <meshStandardMaterial color="#00f2fe" wireframe />}
        {shape === 2 && <meshStandardMaterial color="#ff007a" metalness={0.4} roughness={0.3} />}
      </mesh>
    </group>
  );
}

function PosterSlot({ poster, idx }: { poster?: Poster; idx: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 768;
    const ctx = c.getContext('2d')!;
    if (!poster) {
      ctx.fillStyle = '#18181f'; ctx.fillRect(0, 0, 512, 768);
      ctx.strokeStyle = '#3f3f4e'; ctx.lineWidth = 6; ctx.strokeRect(20, 20, 472, 728);
      ctx.fillStyle = '#71717a'; ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center'; ctx.fillText(`СЛОТ #${idx + 1}`, 256, 380);
      return new THREE.CanvasTexture(c);
    }
    const t = new THREE.CanvasTexture(c);
    const img = new Image();
    img.src = poster.image;
    img.onload = () => { ctx.drawImage(img, 0, 0, 512, 768); t.needsUpdate = true; };
    return t;
  }, [poster, idx]);

  const plq = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 80;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#18181c'; ctx.fillRect(0, 0, 256, 80);
    ctx.strokeStyle = '#52525e'; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 248, 72);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(poster ? poster.author.slice(0, 16) : `МЕСТО #${idx + 1}`, 128, 35);
    ctx.fillStyle = '#ff441f'; ctx.font = '14px monospace'; ctx.fillText(poster ? poster.date : 'СВОБОДНО', 128, 58);
    return new THREE.CanvasTexture(c);
  }, [poster, idx]);

  return (
    <group>
      <mesh><planeGeometry args={[2, 3]} /><meshBasicMaterial map={tex} /></mesh>
      <mesh position={[0, 0, -0.02]}><planeGeometry args={[2.2, 3.2]} /><meshStandardMaterial color={poster ? '#0c0c0e' : '#272733'} roughness={0.2} /></mesh>
      <mesh position={[0, -1.8, 0.02]}><planeGeometry args={[0.9, 0.28]} /><meshBasicMaterial map={plq} /></mesh>
      <mesh position={[0, 1.8, 0.3]}><boxGeometry args={[0.6, 0.08, 0.25]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} /></mesh>
    </group>
  );
}

function Hall({ posters }: { posters: Poster[] }) {
  const zSlots = [8, 12, 16, 20, 24];

  const floorTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 3072;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e5e1d8'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.font = '900 84px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('STUDIO // МАСТЕРСКАЯ', 512, 540);
    ctx.fillStyle = '#ff441f'; ctx.fillRect(0, 1020, 1024, 10);
    ctx.fillStyle = '#1e1e24'; ctx.fillRect(0, 1030, 1024, 2042);

    const letters = ['Г', 'А', 'Л', 'Е', 'Р', 'Е', 'Я'];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.font = '900 240px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    letters.forEach((char, idx) => { ctx.fillText(char, 512, 1340 + idx * 240); });

    return new THREE.CanvasTexture(c);
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 10.5]}><planeGeometry args={[10, 31]} /><meshBasicMaterial map={floorTex} /></mesh>
      <mesh position={[0, 2.5, -5]}><planeGeometry args={[10, 5]} /><meshStandardMaterial color="#ded9ce" /></mesh>
      <mesh position={[-5, 2.5, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[10, 5]} /><meshStandardMaterial color="#d6d0c4" /></mesh>
      <mesh position={[5, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[10, 5]} /><meshStandardMaterial color="#d6d0c4" /></mesh>
      <mesh position={[-5, 2.5, 15.5]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[21, 5]} /><meshStandardMaterial color="#2d2d35" /></mesh>
      <mesh position={[5, 2.5, 15.5]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[21, 5]} /><meshStandardMaterial color="#2d2d35" /></mesh>
      <mesh position={[0, 2.5, 26]} rotation={[0, Math.PI, 0]}><planeGeometry args={[10, 5]} /><meshStandardMaterial color="#1a1a22" /></mesh>

      <group position={[0, 0.25, 0.5]}>
        <mesh position={[0, 0.2, 0]}><boxGeometry args={[3.2, 0.14, 1]} /><meshStandardMaterial color="#1f1f23" roughness={0.4} /></mesh>
        <mesh position={[-1.3, -0.05, 0]}><boxGeometry args={[0.12, 0.42, 0.85]} /><meshStandardMaterial color="#0e0e11" /></mesh>
        <mesh position={[1.3, -0.05, 0]}><boxGeometry args={[0.12, 0.42, 0.85]} /><meshStandardMaterial color="#0e0e11" /></mesh>
      </group>

      {zSlots.map((z, i) => (
        <group key={`l-${i}`} position={[-4.9, 2.3, z]} rotation={[0, Math.PI / 2, 0]}>
          <PosterSlot poster={posters[i]} idx={i} />
        </group>
      ))}
      {zSlots.map((z, i) => (
        <group key={`r-${i}`} position={[4.9, 2.3, z]} rotation={[0, -Math.PI / 2, 0]}>
          <PosterSlot poster={posters[i + 5]} idx={i + 5} />
        </group>
      ))}
    </group>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>('walk');
  const [zone, setZone] = useState<Zone>('none');
  const [tool, setTool] = useState('brush');
  const [color, setColor] = useState('#ff3b30');
  const [size, setSize] = useState(20);
  const [text, setText] = useState('DESIGN');
  const [font, setFont] = useState('Helvetica, Arial, sans-serif');
  const [modal, setModal] = useState(false);
  const [author, setAuthor] = useState('Artgradis');

  const [posters, setPosters] = useState<Poster[]>(() => {
    try { const d = localStorage.getItem(KEY); return d ? JSON.parse(d) : []; } catch { return []; }
  });

  const cvs = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#141416'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#202024'; ctx.fillRect(40, 40, 944, 944);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 54px monospace'; ctx.textAlign = 'center'; ctx.fillText('ARTGRADIS', 512, 470);
    ctx.fillStyle = '#a1a1aa'; ctx.font = '24px monospace'; ctx.fillText('ЖМИ ПРОБЕЛ И СОЗДАВАЙ ПЛАКАТ', 512, 530);
    return c;
  }, []);

  const tex = useMemo(() => new THREE.CanvasTexture(cvs), [cvs]);

  const clear = () => {
    const ctx = cvs.getContext('2d')!; ctx.fillStyle = '#141416'; ctx.fillRect(0, 0, 1024, 1024); tex.needsUpdate = true;
  };

  const saveToGallery = () => {
    const p: Poster = { id: Date.now().toString(), image: cvs.toDataURL('image/png'), author: author.trim() || 'Anonymous', date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) };
    setPosters((prev) => {
      const upd = [p, ...prev].slice(0, 10);
      try { localStorage.setItem(KEY, JSON.stringify(upd)); } catch (e) { console.warn(e); }
      return upd;
    });
    setModal(false); setMode('walk');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space' && mode === 'walk') {
        if (zone === 'center') { e.preventDefault(); setMode('paint_center'); }
        else if (zone === 'left') { e.preventDefault(); setMode('view_left'); }
        else if (zone === 'right') { e.preventDefault(); setMode('view_right'); }
      } else if (e.key === 'Escape' && mode !== 'walk') {
        setMode('walk'); setModal(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zone, mode]);

  const btn = (a: boolean) => ({
    background: a ? '#ffffff' : 'rgba(255,255,255,0.1)', color: a ? '#000' : '#fff',
    border: 'none', borderRadius: '14px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
  });

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#09090b', margin: 0, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: '13px', fontWeight: 600, zIndex: 10, background: 'rgba(0,0,0,0.7)', padding: '8px 24px', borderRadius: '24px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
        {mode === 'walk' && 'Светлая Мастерская и Тёмная Галерея в едином зале! Управление: W, A, S, D'}
        {mode === 'paint_center' && 'Редактор: создай плакат и нажми «Повесить в галерею»'}
        {mode === 'view_left' && 'Кинетика: кликай по плакату для переключения 4 режимов!'}
        {mode === 'view_right' && '3D-Монолит: кликай по парящему артефакту для смены формы'}
      </div>

      {mode === 'walk' && zone === 'center' && (
        <button onClick={() => setMode('paint_center')} style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', color: '#000', background: '#fff', fontWeight: 700, fontSize: '15px', padding: '14px 30px', borderRadius: '30px', border: 'none', cursor: 'pointer', boxShadow: '0 8px 30px rgba(255,255,255,0.3)', zIndex: 20 }}>
          [ ПРОБЕЛ ] Открыть генератор плаката
        </button>
      )}
      {mode === 'walk' && zone === 'left' && (
        <button onClick={() => setMode('view_left')} style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', color: '#000', background: '#00f2fe', fontWeight: 700, fontSize: '15px', padding: '14px 30px', borderRadius: '30px', border: 'none', cursor: 'pointer', boxShadow: '0 8px 30px rgba(0,242,254,0.4)', zIndex: 20 }}>
          [ ПРОБЕЛ ] Исследовать кинетический постер
        </button>
      )}
      {mode === 'walk' && zone === 'right' && (
        <button onClick={() => setMode('view_right')} style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', color: '#000', background: '#ffd60a', fontWeight: 700, fontSize: '15px', padding: '14px 30px', borderRadius: '30px', border: 'none', cursor: 'pointer', boxShadow: '0 8px 30px rgba(255,214,10,0.4)', zIndex: 20 }}>
          [ ПРОБЕЛ ] Осмотреть 3D-монолит
        </button>
      )}

      {(mode === 'view_left' || mode === 'view_right') && (
        <button onClick={() => setMode('walk')} style={{ position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', background: '#fff', color: '#000', fontWeight: 700, border: 'none', borderRadius: '24px', padding: '12px 28px', fontSize: '14px', cursor: 'pointer', zIndex: 20 }}>
          [ ESC ] Назад в зал
        </button>
      )}

      {modal && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(20,20,24,0.96)', padding: '28px 36px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.2)', zIndex: 50, display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center', color: '#fff' }}>
          <h3 style={{ margin: 0, fontSize: '20px' }}>🏛️ Повесить в галерею</h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#a1a1aa' }}>Постер появится в тёмной галерее. 11-й постер заменит самый старый.</p>
          <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Имя автора..." style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '12px', padding: '10px 14px', color: '#fff', fontSize: '14px', outline: 'none', textAlign: 'center' }} />
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button onClick={() => setModal(false)} style={{ background: 'transparent', color: '#aaa', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '16px', padding: '8px 18px', cursor: 'pointer' }}>Отмена</button>
            <button onClick={saveToGallery} style={{ background: '#ff441f', color: '#fff', fontWeight: 700, border: 'none', borderRadius: '16px', padding: '8px 22px', cursor: 'pointer' }}>Повесить на стену</button>
          </div>
        </div>
      )}

      {mode === 'paint_center' && (
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', background: 'rgba(18,18,22,0.96)', padding: '14px 24px', borderRadius: '28px', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.18)', zIndex: 20, boxShadow: '0 16px 40px rgba(0,0,0,0.7)' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              ['brush','🖌 Кисть'],['spray','💨 Спрей'],['line','📏 Линия'],['rect','⬛ Прямоугольник'],
              ['circle','⭕ Круг'],['stamp_cross','➕ Прицел'],['stamp_barcode','|||| Штрихкод'],['text','🔤 Текст']
            ].map(([v, l]) => (
              <button key={v} onClick={() => setTool(v)} style={btn(tool === v)}>{l}</button>
            ))}
            <select value={font} onChange={(e) => setFont(e.target.value)} style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '12px', padding: '6px 10px', fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
              <option value="Helvetica, Arial, sans-serif" style={{ background: '#222' }}>Swiss Sans</option>
              <option value="'Courier New', monospace" style={{ background: '#222' }}>Monospace</option>
              <option value="Impact, Charcoal, sans-serif" style={{ background: '#222' }}>Impact Black</option>
              <option value="Georgia, serif" style={{ background: '#222' }}>Editorial Serif</option>
            </select>
            {tool === 'text' && (
              <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст..." style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '12px', color: '#fff', padding: '6px 10px', fontSize: '12px', width: '110px', outline: 'none' }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ display: 'flex', gap: '5px' }}>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: color === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', transform: color === c ? 'scale(1.2)' : 'scale(1)', transition: '0.1s' }} />
              ))}
            </div>
            <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.2)' }} />
            <span style={{ color: '#888', fontSize: '11px' }}>Толщина:</span>
            <input type="range" min="4" max="60" value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: 65, cursor: 'pointer' }} />
            <button onClick={() => setModal(true)} style={{ background: '#00f2fe', color: '#000', fontWeight: 700, border: 'none', borderRadius: '14px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(0,242,254,0.35)' }}>🏛️ Повесить в галерею</button>
            <button onClick={clear} style={{ background: 'transparent', color: '#a1a1aa', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '14px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}>Стереть</button>
            <button onClick={() => { const a = document.createElement('a'); a.download = 'artgradis-poster.png'; a.href = cvs.toDataURL('image/png'); a.click(); }} style={{ background: '#ff441f', color: '#fff', fontWeight: 600, border: 'none', borderRadius: '14px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>💾 PNG</button>
            <button onClick={() => setMode('walk')} style={{ background: '#ffffff', color: '#000000', fontWeight: 600, border: 'none', borderRadius: '14px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer' }}>[ESC] Отойти</button>
          </div>
        </div>
      )}

      <Canvas>
        <PerspectiveCamera makeDefault fov={65} near={0.1} far={100} />
        <ambientLight intensity={0.9} />
        <pointLight position={[0, 4.2, 0]} intensity={1.5} />
        <pointLight position={[0, 3.5, -3.2]} intensity={2.2} color="#ffffff" />
        <pointLight position={[-3.5, 3.2, -1]} intensity={1.8} color="#00f2fe" />
        <pointLight position={[3.5, 3.2, -1]} intensity={1.8} color="#ffd60a" />
        <pointLight position={[0, 4, 10]} intensity={1.8} />
        <pointLight position={[0, 4, 17]} intensity={1.8} />
        <pointLight position={[0, 4, 23]} intensity={1.8} />

        <Player mode={mode} setZone={setZone} />
        <MainPoster tex={tex} cvs={cvs} mode={mode} tool={tool} color={color} size={size} text={text} font={font} />
        <LeftPoster mode={mode} />
        <RightSculpture mode={mode} />
        <Hall posters={posters} />
      </Canvas>
    </div>
  );
}