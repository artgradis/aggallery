import { Suspense, useMemo, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useProgress, Html, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// ----------------------------------------------------
// 0. Экран загрузки моделей и текстур
// ----------------------------------------------------
function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#00f0ff',
        fontFamily: 'sans-serif',
        fontSize: 13,
        letterSpacing: 2,
        textTransform: 'uppercase',
        userSelect: 'none',
      }}>
        <div style={{
          width: 140,
          height: 3,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 12
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: '#00f0ff',
            transition: 'width 0.2s ease-out'
          }} />
        </div>
        <div>LOADING {Math.round(progress)}%</div>
      </div>
    </Html>
  );
}

// ----------------------------------------------------
// 1. Состояние ввода (Аналоговые оси для джойстика и клавиатуры)
// ----------------------------------------------------
interface JoystickInput {
  moveX: number; // от -1 (влево) до +1 (вправо)
  moveY: number; // от -1 (назад) до +1 (вперед)
}

// ----------------------------------------------------
// 2. Широкоугольная адаптивная камера
// ----------------------------------------------------
function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const isMobile = size.width < 768;
    (camera as THREE.PerspectiveCamera).fov = isMobile ? 78 : 68;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

// ----------------------------------------------------
// 3. Персонаж-робот (Плавный аналоговый отклик на палец)
// ----------------------------------------------------
function Drone({ input }: { input: React.MutableRefObject<JoystickInput> }) {
  const { scene: botScene } = useGLTF('/bot.glb');
  const { scene: roomScene } = useGLTF('/room.glb');
  const groupRef = useRef<THREE.Group>(null!);

  const roomMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    roomScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshes.push(child as THREE.Mesh);
      }
    });
    return meshes;
  }, [roomScene]);

  const BODY_RADIUS = 0.55;
  const FIXED_HOVER_Y = 1.15;

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const forwardDir = useMemo(() => new THREE.Vector3(), []);
  const sideDir = useMemo(() => new THREE.Vector3(), []);
  const probePos = useMemo(() => new THREE.Vector3(), []);

  const state = useRef({
    pos: new THREE.Vector3(0, FIXED_HOVER_Y, 2.0),
    angle: 0,
    tilt: 0,
    roll: 0,
    speed: 3.8,
  });

  useEffect(() => {
    botScene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [botScene]);

  const canMoveForward = (fromPos: THREE.Vector3, moveDist: number, moveAngle: number): boolean => {
    const dirX = Math.sin(moveAngle);
    const dirZ = Math.cos(moveAngle);
    forwardDir.set(dirX, 0, dirZ);
    sideDir.set(-dirZ, 0, dirX);

    const offsets = [-BODY_RADIUS, -BODY_RADIUS * 0.5, 0, BODY_RADIUS * 0.5, BODY_RADIUS];

    for (const off of offsets) {
      probePos.copy(fromPos);
      probePos.x += sideDir.x * off;
      probePos.z += sideDir.z * off;

      for (const h of [-0.2, 0, 0.2]) {
        probePos.y = FIXED_HOVER_Y + h;
        raycaster.set(probePos, forwardDir);
        raycaster.far = Math.abs(moveDist) + 0.35;

        const hits = raycaster.intersectObjects(roomMeshes, true);
        if (hits.length > 0) {
          return false;
        }
      }
    }
    return true;
  };

  useFrame((stateThree, delta) => {
    if (!groupRef.current) return;
    const inp = input.current;
    const s = state.current;
    const time = stateThree.clock.getElapsedTime();

    // 1. Плавный поворот от горизонтального движения пальца / кнопок
    const turnSpeed = 2.4;
    if (Math.abs(inp.moveX) > 0.05) {
      s.angle += -inp.moveX * turnSpeed * delta;
    }
    const targetRoll = -inp.moveX * 0.22;

    // 2. Движение вперед/назад от вертикального движения пальца / кнопок
    let forwardSpeed = 0;
    let targetTilt = 0;
    if (Math.abs(inp.moveY) > 0.05) {
      forwardSpeed = inp.moveY * s.speed;
      targetTilt = (inp.moveY > 0 ? 0.18 : -0.12) * Math.abs(inp.moveY);
    }

    if (forwardSpeed !== 0) {
      const step = forwardSpeed * delta;
      const moveAngle = forwardSpeed > 0 ? s.angle : s.angle + Math.PI;

      if (canMoveForward(s.pos, Math.abs(step), moveAngle)) {
        s.pos.x += Math.sin(s.angle) * step;
        s.pos.z += Math.cos(s.angle) * step;
      }
    }

    // 3. Выталкивание от близких стен
    const rayDir = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      rayDir.set(Math.cos(a), 0, Math.sin(a));
      raycaster.set(new THREE.Vector3(s.pos.x, FIXED_HOVER_Y, s.pos.z), rayDir);
      raycaster.far = BODY_RADIUS;

      const hits = raycaster.intersectObjects(roomMeshes, true);
      if (hits.length > 0) {
        const hit = hits[0];
        const penetration = BODY_RADIUS - hit.distance;
        if (penetration > 0) {
          const nx = hit.face ? hit.face.normal.x : -rayDir.x;
          const nz = hit.face ? hit.face.normal.z : -rayDir.z;
          const len = Math.hypot(nx, nz) || 1;

          s.pos.x += (nx / len) * (penetration + 0.005);
          s.pos.z += (nz / len) * (penetration + 0.005);
        }
      }
    }

    // 4. Фиксация высоты
    s.pos.y = FIXED_HOVER_Y;

    // 5. Покачивание
    const hoverY = Math.sin(time * 3) * 0.03;
    const hoverWobble = Math.cos(time * 2) * 0.012;

    s.tilt = THREE.MathUtils.lerp(s.tilt, targetTilt, 0.1);
    s.roll = THREE.MathUtils.lerp(s.roll, targetRoll, 0.1);

    groupRef.current.position.set(s.pos.x, s.pos.y + hoverY, s.pos.z);
    groupRef.current.rotation.set(s.tilt, s.angle + hoverWobble, s.roll, 'YXZ');

    // 6. Широкоугольная камера
    const isNarrow = stateThree.size.width < 768;
    const cameraDistance = isNarrow ? 6.8 : 5.2;
    const cameraHeight = isNarrow ? 2.5 : 1.9;

    const idealCamX = s.pos.x - Math.sin(s.angle) * cameraDistance;
    const idealCamZ = s.pos.z - Math.cos(s.angle) * cameraDistance;
    const idealCamY = s.pos.y + cameraHeight;
    const idealCamPos = new THREE.Vector3(idealCamX, idealCamY, idealCamZ);

    const camDir = idealCamPos.clone().sub(s.pos).normalize();
    const camMaxDist = idealCamPos.distanceTo(s.pos);
    raycaster.set(s.pos, camDir);
    raycaster.far = camMaxDist;
    const camHits = raycaster.intersectObjects(roomMeshes, true);

    let actualCamPos = idealCamPos;
    if (camHits.length > 0) {
      actualCamPos = s.pos.clone().addScaledVector(camDir, Math.max(1.5, camHits[0].distance - 0.25));
    }

    stateThree.camera.position.lerp(actualCamPos, 0.08);

    stateThree.camera.lookAt(
      s.pos.x + Math.sin(s.angle) * 2.0,
      s.pos.y + 0.2,
      s.pos.z + Math.cos(s.angle) * 2.0
    );
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={botScene}
        rotation={[0, Math.PI, 0]}
        scale={[0.42, 0.42, 0.42]}
      />
      <pointLight
        position={[0, -0.25, 0]}
        color="#00f0ff"
        intensity={2.2}
        distance={3.0}
        decay={2}
      />
    </group>
  );
}

useGLTF.preload('/bot.glb');

// ----------------------------------------------------
// 4. Текстура бетона
// ----------------------------------------------------
function useConcreteTextures() {
  return useMemo(() => {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#a2a4aa';
    ctx.fillRect(0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const grain = (Math.random() - 0.5) * 30;
      data[i] = Math.min(255, Math.max(0, data[i] + grain));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
    }
    ctx.putImageData(imgData, 0, 0);

    for (let i = 0; i < 45; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 35 + Math.random() * 110;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(3, 3);

    const bumpMap = new THREE.CanvasTexture(canvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(3, 3);

    return { map, bumpMap };
  }, []);
}

// ----------------------------------------------------
// 5. Комната
// ----------------------------------------------------
function Room() {
  const { scene } = useGLTF('/room.glb');
  const { map, bumpMap } = useConcreteTextures();

  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        mesh.material = new THREE.MeshStandardMaterial({
          map: map,
          bumpMap: bumpMap,
          bumpScale: 0.02,
          roughness: 0.86,
          metalness: 0.03,
          color: new THREE.Color('#a8abb2'),
          shadowSide: THREE.DoubleSide,
        });
      }
    });
  }, [scene, map, bumpMap]);

  return <primitive object={scene} position={[0, 0, 0]} />;
}

useGLTF.preload('/room.glb');

// ----------------------------------------------------
// 6. Компонент статичного арта из прозрачного PNG
// ----------------------------------------------------
interface WallDecalProps {
  url: string;
  position: [number, number, number];
  rotation: [number, number, number];
  size?: [number, number];
  opacity?: number;
}

function WallDecal({ url, position, rotation, size = [2.6, 2.6], opacity = 1.0 }: WallDecalProps) {
  const texture = useTexture(url);

  useMemo(() => {
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
  }, [texture]);

  const [w, h] = size;

  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={[w, h, 1]}
      receiveShadow
    >
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial
        map={texture}
        transparent={true}
        alphaTest={0.02}
        opacity={opacity}
        roughness={0.8}
        metalness={0.05}
        depthWrite={false}
        polygonOffset={true}
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ----------------------------------------------------
// 7. Компонент покадровой анимации (Идеальная прозрачность)
// ----------------------------------------------------
interface AnimatedWallDecalProps {
  urls: string[];
  position: [number, number, number];
  rotation: [number, number, number];
  size?: [number, number];
  fps?: number;
  opacity?: number;
}

function AnimatedWallDecal({
  urls,
  position,
  rotation,
  size = [2.6, 2.6],
  fps = 8,
  opacity = 1.0,
}: AnimatedWallDecalProps) {
  const textures = useTexture(urls);
  const [frameIndex, setFrameIndex] = useState(0);

  const texList = useMemo(() => {
    const list = (Array.isArray(textures) ? textures : [textures]) as THREE.Texture[];
    list.forEach((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
    });
    return list;
  }, [textures]);

  const materials = useMemo(() => {
    return texList.map(
      (tex) =>
        new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.05,
          opacity: opacity,
          roughness: 0.8,
          metalness: 0.05,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          side: THREE.DoubleSide,
        })
    );
  }, [texList, opacity]);

  useEffect(() => {
    if (!urls || urls.length <= 1) return;
    const interval = 1000 / fps;
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % urls.length);
    }, interval);
    return () => clearInterval(timer);
  }, [urls, fps]);

  const [w, h] = size;
  const currentMaterial = materials[frameIndex] || materials[0];

  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={[w, h, 1]}
      material={currentMaterial}
      receiveShadow
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

// ----------------------------------------------------
// 8. Освещение
// ----------------------------------------------------
function Lighting() {
  const lightRef = useRef<THREE.DirectionalLight>(null!);
  const [target] = useState(() => new THREE.Object3D());

  useEffect(() => {
    if (lightRef.current) {
      lightRef.current.target = target;
    }
  }, [target]);

  return (
    <>
      <primitive object={target} position={[0, 0, 0]} />

      <hemisphereLight
        color="#d8e4f5"
        groundColor="#3d4048"
        intensity={1.4}
      />

      <ambientLight intensity={0.4} color="#e0e6ed" />

      <directionalLight
        ref={lightRef}
        castShadow
        position={[4, 18, -2]}
        intensity={2.4}
        color="#ffffff"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00015}
        shadow-normalBias={0.04}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />

      <directionalLight
        position={[-8, 6, 8]}
        intensity={0.6}
        color="#9fb8d4"
      />
    </>
  );
}

// ----------------------------------------------------
// 9. Главный компонент (с плавающим сенсорным джойстиком)
// ----------------------------------------------------
export default function App() {
  const [isMobile, setIsMobile] = useState(false);

  // Аналоговый ввод (работает одновременно от пальца и от клавиатуры)
  const input = useRef<JoystickInput>({ moveX: 0, moveY: 0 });

  // Визуальное состояние плавающего джойстика
  const [touchActive, setTouchActive] = useState(false);
  const [touchOrigin, setTouchOrigin] = useState<{ x: number; y: number } | null>(null);
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);
  const activeTouchId = useRef<number | null>(null);

  useEffect(() => {
    const checkDevice = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isNarrow = window.innerWidth <= 820;
      setIsMobile(hasTouch || isNarrow);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  // Клавиатура (ПК)
  useEffect(() => {
    const keys = { w: false, s: false, a: false, d: false };

    const updateKeys = () => {
      let x = 0;
      let y = 0;
      if (keys.a) x -= 1;
      if (keys.d) x += 1;
      if (keys.w) y += 1;
      if (keys.s) y -= 1;
      input.current.moveX = x;
      input.current.moveY = y;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.w = true;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.s = true;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.a = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.d = true;
      updateKeys();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.w = false;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.s = false;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.a = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.d = false;
      updateKeys();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ----------------------------------------------------
  // Сенсорные события: палец касается В ЛЮБОМ МЕСТЕ ЭКРАНА
  // ----------------------------------------------------
  const handleTouchStart = (e: React.TouchEvent) => {
    if (activeTouchId.current !== null) return;
    const touch = e.changedTouches[0];
    activeTouchId.current = touch.identifier;

    setTouchOrigin({ x: touch.clientX, y: touch.clientY });
    setTouchPos({ x: touch.clientX, y: touch.clientY });
    setTouchActive(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (activeTouchId.current === null || !touchOrigin) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === activeTouchId.current) {
        const dx = touch.clientX - touchOrigin.x;
        const dy = touch.clientY - touchOrigin.y;

        const MAX_RADIUS = 55; // Максимальный ход джойстика в пикселях
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, MAX_RADIUS);
        const angle = Math.atan2(dy, dx);

        const clampedX = touchOrigin.x + Math.cos(angle) * clampedDist;
        const clampedY = touchOrigin.y + Math.sin(angle) * clampedDist;

        setTouchPos({ x: clampedX, y: clampedY });

        // Переводим в нормализованный вектор от -1 до +1
        input.current.moveX = (clampedDist / MAX_RADIUS) * Math.cos(angle);
        input.current.moveY = -(clampedDist / MAX_RADIUS) * Math.sin(angle); // Вверх по экрану = вперед
        break;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId.current) {
        activeTouchId.current = null;
        setTouchActive(false);
        setTouchOrigin(null);
        setTouchPos(null);
        input.current.moveX = 0;
        input.current.moveY = 0;
        break;
      }
    }
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0e1013',
        margin: 0,
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none'
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <style>{`
        [id*="netlify"], iframe[src*="netlify"], .netlify-badge {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `}</style>

      {/* Подсказка для ПК */}
      {!isMobile && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          zIndex: 50,
          background: 'rgba(15, 17, 22, 0.82)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '14px 20px',
          borderRadius: 12,
          color: '#d0d4dc',
          fontFamily: 'sans-serif',
          fontSize: 13,
          lineHeight: 1.6,
          pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}>
          <div>🧭 <b>Стрелочки / WASD</b> — полет и поворот</div>
        </div>
      )}

      {/* Плавающий сенсорный джойстик под пальцем (появляется только при касании) */}
      {touchActive && touchOrigin && touchPos && (
        <div style={{ pointerEvents: 'none' }}>
          {/* Базовый внешний круг */}
          <div style={{
            position: 'absolute',
            left: touchOrigin.x - 55,
            top: touchOrigin.y - 55,
            width: 110,
            height: 110,
            borderRadius: '50%',
            background: 'rgba(0, 240, 255, 0.08)',
            border: '2px solid rgba(0, 240, 255, 0.4)',
            boxShadow: '0 0 20px rgba(0, 240, 255, 0.25)',
            zIndex: 100,
          }} />

          {/* Центральный бегунок под пальцем */}
          <div style={{
            position: 'absolute',
            left: touchPos.x - 22,
            top: touchPos.y - 22,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(0, 240, 255, 0.75)',
            border: '2px solid #ffffff',
            boxShadow: '0 0 15px #00f0ff',
            zIndex: 101,
          }} />
        </div>
      )}

      {/* Легкая аккуратная подсказка на мобилках */}
      {isMobile && !touchActive && (
        <div style={{
          position: 'absolute',
          bottom: 30,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          background: 'rgba(15, 17, 22, 0.6)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '8px 16px',
          borderRadius: 20,
          color: '#a0a8b4',
          fontFamily: 'sans-serif',
          fontSize: 12,
          letterSpacing: 1,
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}>
          Коснитесь экрана в любом месте для управления
        </div>
      )}

      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 2.5, 6], fov: 68 }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
      >
        <ResponsiveCamera />
        <Lighting />

        <Suspense fallback={<Loader />}>
          <Room />
          <Drone input={input} />

          {/* 1. Изображение p1.png */}
          <WallDecal
            url="/p1.png"
            position={[6.5, 2.25, -13.39]}
            rotation={[0, 0, 0]}
            size={[15, 5]}
          />

          {/* 2. Изображение p2.png */}
          <WallDecal
            url="/p2.png"
            position={[-3, 0, 6.5]}
            rotation={[1.5708, 3.1415, 0]}
            size={[15, 7.5]}
          />

          {/* 3. Изображение p3.png */}
          <WallDecal
            url="/p3.png"
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            size={[2.5, 2.5]}
          />

          {/* 4. Изображение p4.png */}
          <WallDecal
            url="/p4.png"
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            size={[2.5, 2.5]}
          />

          {/* 5. Изображение p5.png */}
          <WallDecal
            url="/p5.png"
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            size={[2.5, 2.5]}
          />

          {/* 6. Изображение p6.png */}
          <WallDecal
            url="/p6.png"
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            size={[2.5, 2.5]}
          />

          {/* 7. Покадровая анимация a1 - a5 */}
          <AnimatedWallDecal
            urls={[
              '/a1.png',
              '/a2.png',
              '/a3.png',
              '/a4.png',
              '/a5.png',
            ]}
            position={[-14.63, 5, 0]}
            rotation={[0, 1.5708, 0]}
            size={[18.0, 3.0]}
            fps={4}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}