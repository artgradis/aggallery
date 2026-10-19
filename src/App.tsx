import { Suspense, useMemo, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, SoftShadows } from '@react-three/drei';
import * as THREE from 'three';

// ----------------------------------------------------
// 1. Единый контроллер ввода (Клавиатура + Сенсорные кнопки)
// ----------------------------------------------------
interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

// ----------------------------------------------------
// 2. Адаптивная камера для мобильных экранов
// ----------------------------------------------------
function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const isMobile = size.width < 768;
    // На мобильных чуть расширяем FOV, чтобы комната не казалась узкой
    (camera as THREE.PerspectiveCamera).fov = isMobile ? 62 : 50;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

// ----------------------------------------------------
// 3. Персонаж-робот (Дрон)
// ----------------------------------------------------
function Drone({ input }: { input: React.MutableRefObject<InputState> }) {
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

  const DRONE_RADIUS = 0.4;
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const downDir = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const rayDir = useMemo(() => new THREE.Vector3(), []);

  const state = useRef({
    pos: new THREE.Vector3(0, 1.2, 2.0),
    angle: 0,
    tilt: 0,
    roll: 0,
    speed: 3.5,
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

  useFrame((stateThree, delta) => {
    if (!groupRef.current) return;
    const inp = input.current;
    const s = state.current;
    const time = stateThree.clock.getElapsedTime();

    // 1. Поворот влево-вправо
    const turnSpeed = 2.4;
    let targetRoll = 0;
    if (inp.left) {
      s.angle += turnSpeed * delta;
      targetRoll = 0.22;
    }
    if (inp.right) {
      s.angle -= turnSpeed * delta;
      targetRoll = -0.22;
    }

    // 2. Движение вперед-назад
    let forwardSpeed = 0;
    let targetTilt = 0;
    if (inp.forward) {
      forwardSpeed = s.speed;
      targetTilt = 0.18;
    }
    if (inp.backward) {
      forwardSpeed = -s.speed * 0.6;
      targetTilt = -0.12;
    }

    const moveX = Math.sin(s.angle) * forwardSpeed * delta;
    const moveZ = Math.cos(s.angle) * forwardSpeed * delta;

    s.pos.x += moveX;
    s.pos.z += moveZ;

    // 3. Отталкивание от стен
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      rayDir.set(Math.cos(a), 0, Math.sin(a));
      raycaster.set(s.pos, rayDir);
      raycaster.far = DRONE_RADIUS;
      const hits = raycaster.intersectObjects(roomMeshes, true);
      if (hits.length > 0) {
        const hit = hits[0];
        if (hit.face && Math.abs(hit.face.normal.y) < 0.7) {
          const penetration = DRONE_RADIUS - hit.distance;
          if (penetration > 0) {
            s.pos.x += hit.face.normal.x * penetration;
            s.pos.z += hit.face.normal.z * penetration;
          }
        }
      }
    }

    // 4. Подъем и спуск
    let moveY = 0;
    if (inp.up) moveY += 1.8 * delta;
    if (inp.down) moveY -= 1.8 * delta;
    s.pos.y += moveY;

    // 5. Ограничение высоты
    raycaster.set(new THREE.Vector3(s.pos.x, s.pos.y + 1.0, s.pos.z), downDir);
    raycaster.far = 10;
    const floorHits = raycaster.intersectObjects(roomMeshes, true);

    let currentFloorY = -1.0;
    if (floorHits.length > 0) {
      currentFloorY = floorHits[0].point.y;
    }

    const minHeight = currentFloorY + 0.35;
    const maxHeight = 2.6;
    s.pos.y = THREE.MathUtils.clamp(s.pos.y, minHeight, maxHeight);

    // 6. Покачивание
    const hoverY = Math.sin(time * 3) * 0.035;
    const hoverWobble = Math.cos(time * 2) * 0.015;

    s.tilt = THREE.MathUtils.lerp(s.tilt, targetTilt, 0.1);
    s.roll = THREE.MathUtils.lerp(s.roll, targetRoll, 0.1);

    groupRef.current.position.set(s.pos.x, s.pos.y + hoverY, s.pos.z);
    groupRef.current.rotation.set(s.tilt, s.angle + hoverWobble, s.roll, 'YXZ');

    // 7. Камера от 3-го лица
    const isNarrow = stateThree.size.width < 768;
    const cameraDistance = isNarrow ? 4.2 : 3.6;
    const cameraHeight = isNarrow ? 1.6 : 1.3;

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
      actualCamPos = s.pos.clone().addScaledVector(camDir, Math.max(1.0, camHits[0].distance - 0.25));
    }

    stateThree.camera.position.lerp(actualCamPos, 0.08);
    stateThree.camera.lookAt(
      s.pos.x + Math.sin(s.angle) * 1.5,
      s.pos.y + 0.2,
      s.pos.z + Math.cos(s.angle) * 1.5
    );
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={botScene}
        rotation={[0, Math.PI, 0]}
        scale={[0.45, 0.45, 0.45]}
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
// 6. Освещение
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
      <primitive object={target} position={[0, 0.5, 0]} />
      <SoftShadows size={58} samples={16} focus={0.4} />

      <ambientLight intensity={0.05} color="#cad2df" />

      <directionalLight
        ref={lightRef}
        castShadow
        position={[0, 16.5, -0.5]}
        intensity={3.6}
        color="#ffffff"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0001}
        shadow-normalBias={0.035}
        shadow-camera-near={0.5}
        shadow-camera-far={45}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      <directionalLight
        position={[8, 5, -8]}
        intensity={0.8}
        color="#c0d4ec"
      />
    </>
  );
}

// ----------------------------------------------------
// 7. Главный компонент
// ----------------------------------------------------
export default function App() {
  const [isMobile, setIsMobile] = useState(false);

  // Общий реф состояния нажатий
  const input = useRef<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
  });

  // Автоопределение устройства (тач-экран или мобильная ширина)
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

  // Слушатель клавиатуры (для ПК)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') input.current.forward = true;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') input.current.backward = true;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.current.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') input.current.right = true;
      if (e.code === 'Space') input.current.up = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.current.down = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') input.current.forward = false;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') input.current.backward = false;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.current.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') input.current.right = false;
      if (e.code === 'Space') input.current.up = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.current.down = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Хелпер для сенсорных кнопок
  const handleTouch = (key: keyof InputState, active: boolean) => {
    input.current[key] = active;
  };

  // Стиль для сенсорных круглых кнопок
  const btnStyle = {
    width: 54,
    height: 54,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.12)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    color: '#ffffff',
    fontSize: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    touchAction: 'none' as const,
    cursor: 'pointer',
    activeStyle: { background: 'rgba(0, 240, 255, 0.3)' }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0e1013', margin: 0, overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
      
      {/* 1. Если зашли с ПК — показываем лаконичную клавиатурную подсказку */}
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
          <div>🧭 <b>Стрелочки</b> (↑ ↓ ← →) — полет и поворот</div>
          <div>🚀 <b>Space</b> — подъем, <b>Shift</b> — спуск</div>
        </div>
      )}

      {/* 2. Если зашли с Мобильного — показываем экранный джойстик */}
      {isMobile && (
        <>
          {/* Слева: D-Pad движения */}
          <div style={{
            position: 'absolute',
            bottom: 30,
            left: 24,
            zIndex: 60,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 56px)',
            gridTemplateRows: 'repeat(3, 56px)',
            gap: 6,
            touchAction: 'none'
          }}>
            <div />
            <button
              style={btnStyle}
              onTouchStart={() => handleTouch('forward', true)}
              onTouchEnd={() => handleTouch('forward', false)}
            >▲</button>
            <div />

            <button
              style={btnStyle}
              onTouchStart={() => handleTouch('left', true)}
              onTouchEnd={() => handleTouch('left', false)}
            >◀</button>
            <div />
            <button
              style={btnStyle}
              onTouchStart={() => handleTouch('right', true)}
              onTouchEnd={() => handleTouch('right', false)}
            >▶</button>

            <div />
            <button
              style={btnStyle}
              onTouchStart={() => handleTouch('backward', true)}
              onTouchEnd={() => handleTouch('backward', false)}
            >▼</button>
            <div />
          </div>

          {/* Справа: Кнопки высоты (Вверх / Вниз) */}
          <div style={{
            position: 'absolute',
            bottom: 40,
            right: 28,
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            touchAction: 'none'
          }}>
            <button
              style={{ ...btnStyle, width: 62, height: 62, background: 'rgba(0, 240, 255, 0.2)', border: '1px solid rgba(0, 240, 255, 0.5)' }}
              onTouchStart={() => handleTouch('up', true)}
              onTouchEnd={() => handleTouch('up', false)}
            >
              UP
            </button>
            <button
              style={{ ...btnStyle, width: 62, height: 62 }}
              onTouchStart={() => handleTouch('down', true)}
              onTouchEnd={() => handleTouch('down', false)}
            >
              DN
            </button>
          </div>
        </>
      )}

      <Canvas
        shadows
        camera={{ position: [0, 2.5, 6], fov: 50 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <ResponsiveCamera />
        <Lighting />

        <Suspense fallback={null}>
          <Room />
          <Drone input={input} />
        </Suspense>
      </Canvas>
    </div>
  );
}