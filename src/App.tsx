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
    // На мобильных снижаем FOV, чтобы постеры не казались далекими и мелкими, а выглядели крупно и четко
    (camera as THREE.PerspectiveCamera).fov = isMobile ? 66 : 68;
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
    const ignoredNames = [
      'pl1', 'pl2', 'pl3',
      'q1',
      '1w1', '1w2', '1w3', '1w4',
      '2w1', '2w2', '2w3',
      '3w1', '3w2', '3w3', '3w4',
      '4w1', '4w2'
    ];
    roomScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const name = (child.name || '').toLowerCase().trim();
        // Тонкие плоскости плакатов исключаем из коллизий, чтобы дрон об них не запинался
        if (!ignoredNames.includes(name)) {
          meshes.push(child as THREE.Mesh);
        }
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
// ----------------------------------------------------
// ----------------------------------------------------
// ----------------------------------------------------
// 5. КВЕСТ 1: Стенд со слоями плаката и 3 кнопками
// ----------------------------------------------------
const QUEST1_LAYERS = {
  layer1: ['/quest/m1.png', '/quest/m2.png', '/quest/m3.png', '/quest/m4.png'],
  layer2: ['/quest/m5.png', '/quest/m6.png', '/quest/m7.png', '/quest/m8.png'],
  layer3: ['/quest/m9.png', '/quest/m10.png', '/quest/m11.png', '/quest/m12.png'],
};

// Правильный ответ: m2 (индекс 1), m8 (индекс 3), m11 (индекс 2)
const QUEST1_CORRECT = [1, 3, 2];

interface QuestObjectsMap {
  [key: string]: THREE.Mesh | null;
}

function QuestStand({
  scene,
  choices,
  isSolved,
}: {
  scene: THREE.Group;
  choices: [number, number, number];
  isSolved: boolean;
}) {
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);

  // Предзагрузка текстур с правильным разворотом
  const loadedTextures = useMemo(() => {
    const setupTex = (url: string) => {
      const tex = textureLoader.load(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      tex.rotation = Math.PI / 2;
      tex.repeat.set(-1, 1);
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 16;
      return tex;
    };

    return {
      layer1: QUEST1_LAYERS.layer1.map(setupTex),
      layer2: QUEST1_LAYERS.layer2.map(setupTex),
      layer3: QUEST1_LAYERS.layer3.map(setupTex),
    };
  }, [textureLoader]);

  // Находим объекты квеста
  const questObjects = useMemo<QuestObjectsMap>(() => {
    const map: QuestObjectsMap = {
      p1: null,
      pl1: null,
      pl2: null,
      pl3: null,
      b1: null,
      b2: null,
      b3: null,
    };

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        const name = (mesh.name || '').toLowerCase().trim();
        if (name in map) {
          map[name] = mesh;
        }
      }
    });

    return map;
  }, [scene]);

  // Настройка материалов и строгой очередности слоев (renderOrder)
  useEffect(() => {
    const pl1 = questObjects['pl1'];
    const pl2 = questObjects['pl2'];
    const pl3 = questObjects['pl3'];
    const b1 = questObjects['b1'];
    const b2 = questObjects['b2'];
    const b3 = questObjects['b3'];

    // Слой 1: Задний фон (рисуется первым в очереди: renderOrder = 10)
    if (pl1) {
      pl1.renderOrder = 10;
      pl1.material = new THREE.MeshBasicMaterial({
        map: loadedTextures.layer1[choices[0]],
        transparent: false,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      });
    }

    // Слой 2: Средний прозрачный PNG
    if (pl2) {
      pl2.renderOrder = 20;
      pl2.material = new THREE.MeshBasicMaterial({
        map: loadedTextures.layer2[choices[1]],
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      });
    }

    // Слой 3: Передний прозрачный PNG
    if (pl3) {
      pl3.renderOrder = 3;
      pl3.material = new THREE.MeshBasicMaterial({
        map: loadedTextures.layer3[choices[2]],
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      });
    }

    // Кнопки b1, b2, b3 — монолитный матовый бетон
    const btns = [b1, b2, b3];
    btns.forEach((btn) => {
      if (btn) {
        btn.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#a8abb2'),
          roughness: 0.86,
          metalness: 0.03,
        });
      }
    });
  }, [questObjects, loadedTextures]);

  // Обновление картинок при смене вариантов
  useEffect(() => {
    const pl1 = questObjects['pl1'];
    const pl2 = questObjects['pl2'];
    const pl3 = questObjects['pl3'];

    if (pl1 && pl1.material instanceof THREE.MeshBasicMaterial) {
      pl1.material.map = loadedTextures.layer1[choices[0]];
      pl1.material.needsUpdate = true;
    }
    if (pl2 && pl2.material instanceof THREE.MeshBasicMaterial) {
      pl2.material.map = loadedTextures.layer2[choices[1]];
      pl2.material.needsUpdate = true;
    }
    if (pl3 && pl3.material instanceof THREE.MeshBasicMaterial) {
      pl3.material.map = loadedTextures.layer3[choices[2]];
      pl3.material.needsUpdate = true;
    }
  }, [choices, questObjects, loadedTextures]);

  // Анимация плавного исчезновения стенда при победе
  useFrame((_, delta) => {
    if (isSolved) {
      ['p1', 'pl1', 'pl2', 'pl3', 'b1', 'b2', 'b3'].forEach((name) => {
        const obj = questObjects[name];
        if (obj) {
          obj.scale.lerp(new THREE.Vector3(0, 0, 0), delta * 2.5);
          if (obj.scale.x < 0.02) {
            obj.visible = false;
          }
        }
      });
    }
  });

  return null;
}

// ----------------------------------------------------
// 5.1 КВЕСТ 2: Выбор постеров на 4 стенах и панель P2
// ----------------------------------------------------
// Стена 1 (4 постера): 1w1, 1w2, 1w3, 1w4
// Стена 2 (3 постера): 2w1, 2w2, 2w3
// Стена 3 (4 постера): 3w1, 3w2, 3w3, 3w4
// Стена 4 (2 постера): 4w1, 4w2
const QUEST2_ALL_POSTERS = [
  '1w1', '1w2', '1w3', '1w4',
  '2w1', '2w2', '2w3',
  '3w1', '3w2', '3w3', '3w4',
  '4w1', '4w2'
];

// Правильные ответы для каждой стены (1w2, 2w1, 3w3, 4w1)
const QUEST2_CORRECT: { [wallId: string]: string } = {
  '1': '1w2',
  '2': '2w1',
  '3': '3w3',
  '4': '4w1',
};

// Праздничная неоновая палитра для салюта победы
const CELEBRATION_COLORS = [
  '#00f0ff', '#ff00aa', '#00ff88', '#ffea00',
  '#aa00ff', '#ff3366', '#33ddff', '#ff9900'
];

function QuestWallPosters({
  scene,
  selectedPosters,
  isQuest1Solved,
  isQuest2Solved,
}: {
  scene: THREE.Group;
  selectedPosters: { [wallId: string]: string };
  isQuest1Solved: boolean;
  isQuest2Solved: boolean;
}) {
  const posterMeshes = useRef<{ [name: string]: THREE.Mesh }>({});
  const p2MeshRef = useRef<THREE.Mesh | null>(null);
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);

  // Предзагрузка текстур p2.png и p3.png (с поддержкой как папки /quest, так и корня /)
  const victoryTextures = useMemo(() => {
    const loadSafe = (path1: string, path2: string) => {
      const tex = textureLoader.load(path1, undefined, undefined, () => {
        textureLoader.load(path2, (fallbackTex) => {
          fallbackTex.colorSpace = THREE.SRGBColorSpace;
          fallbackTex.anisotropy = 16;
          tex.image = fallbackTex.image;
          tex.needsUpdate = true;
        });
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 16;
      return tex;
    };

    return {
      q1: loadSafe('/quest/q1.png', '/q1.png'),
      q2: loadSafe('/quest/q2.png', '/q2.png'),
    };
  }, [textureLoader]);

  // Загрузка текстур постеров 1w1...4w2 из папки /quest/
  const posterTextures = useMemo(() => {
    const texMap: { [name: string]: THREE.Texture } = {};
    QUEST2_ALL_POSTERS.forEach((name) => {
      const tex = textureLoader.load(`/quest/${name}.png`, undefined, undefined, () => {
        textureLoader.load(`/${name}.png`, (fb) => {
          fb.colorSpace = THREE.SRGBColorSpace;
          fb.anisotropy = 16;
          tex.image = fb.image;
          tex.needsUpdate = true;
        });
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 16;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      texMap[name] = tex;
    });
    return texMap;
  }, [textureLoader]);

  // Инициализация мешей постеров и панели p2
  useEffect(() => {
    const meshes: { [name: string]: THREE.Mesh } = {};

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        const name = (mesh.name || '').toLowerCase().trim();

        // Постеры квеста 2
        if (QUEST2_ALL_POSTERS.includes(name)) {
          meshes[name] = mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            map: posterTextures[name],
            roughness: 0.35,
            metalness: 0.05,
            color: new THREE.Color('#ffffff'),
            emissive: new THREE.Color('#000000'),
            emissiveIntensity: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -1.0,
            side: THREE.DoubleSide,
          });
          // По умолчанию скрыты до завершения 1 квеста
          mesh.visible = isQuest1Solved;
        }

        // Панель q1
        if (name === 'q1') {
          p2MeshRef.current = mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            map: victoryTextures.q1,
            roughness: 0.4,
            metalness: 0.05,
            color: new THREE.Color('#ffffff'),
            emissive: new THREE.Color('#000000'),
            emissiveIntensity: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -1.0,
            side: THREE.DoubleSide,
          });
          // По умолчанию скрыта до завершения 1 квеста
          mesh.visible = isQuest1Solved;
        }
      }
    });

    posterMeshes.current = meshes;
  }, [scene, posterTextures, victoryTextures]);

  // Появление постеров и p2 только после прохождения Квеста 1
  useEffect(() => {
    Object.values(posterMeshes.current).forEach((mesh) => {
      mesh.visible = isQuest1Solved;
    });
    if (p2MeshRef.current) {
      p2MeshRef.current.visible = isQuest1Solved;
    }
  }, [isQuest1Solved]);

  // Смена изображения на q1: при победе Квеста 2 ставим q2.png ("Победа!")
  useEffect(() => {
    if (p2MeshRef.current && p2MeshRef.current.material) {
      const mat = p2MeshRef.current.material as THREE.MeshStandardMaterial;
      if (isQuest2Solved) {
        mat.map = victoryTextures.q2;
        mat.emissive.set('#00ff88');
        mat.emissiveIntensity = 0.5;
      } else {
        mat.map = victoryTextures.q1;
        mat.emissive.set('#000000');
        mat.emissiveIntensity = 0.0;
      }
      mat.needsUpdate = true;
    }
  }, [isQuest2Solved, victoryTextures]);

  // Подсветка выбора во время игры
  useEffect(() => {
    if (isQuest2Solved) return;

    const selectedList = Object.values(selectedPosters);

    Object.entries(posterMeshes.current).forEach(([name, mesh]) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat) return;

      const isSelected = selectedList.includes(name);
      if (isSelected) {
        mat.emissive.set('#00f0ff');
        mat.emissiveIntensity = 0.85;
      } else {
        mat.emissive.set('#000000');
        mat.emissiveIntensity = 0.0;
      }
      mat.needsUpdate = true;
    });
  }, [selectedPosters, isQuest2Solved]);

  // Анимация в кадре:
  // 1) Пока игра идет — выбранные постеры мягко пульсируют
  // 2) При ПОБЕДЕ — все постеры на стенах устраивают яркий праздничный фейерверк разными неоновыми цветами!
  useFrame(({ clock }) => {
    if (!isQuest1Solved) return;
    const t = clock.getElapsedTime();

    if (isQuest2Solved) {
      // 🎉 ПРАЗДНИЧНЫЙ САЛЮТ: Все постеры мерцают разными яркими цветами
      Object.entries(posterMeshes.current).forEach(([_, mesh], index) => {
        if (!mesh || !mesh.material) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;

        const colorIdx = Math.floor((t * 3.5 + index * 1.3) % CELEBRATION_COLORS.length);
        const brightness = 0.55 + Math.sin(t * 7 + index * 1.7) * 0.45;

        mat.emissive.set(CELEBRATION_COLORS[colorIdx]);
        mat.emissiveIntensity = brightness;
      });
    } else {
      const selectedList = Object.values(selectedPosters);
      if (selectedList.length === 0) return;

      const pulse = 0.75 + Math.sin(t * 4) * 0.2;
      selectedList.forEach((name) => {
        const mesh = posterMeshes.current[name];
        if (mesh && mesh.material) {
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
        }
      });
    }
  });

  return null;
}

// ----------------------------------------------------
// 5.2 Комната со всеми объектами и логикой кликов
// ----------------------------------------------------
function Room() {
  const { scene } = useGLTF('/room.glb');
  const { map, bumpMap } = useConcreteTextures();

  // Состояние Квеста 1 (Стенд)
  const [choices, setChoices] = useState<[number, number, number]>([0, 0, 0]);
  const [isSolvedQuest1, setIsSolvedQuest1] = useState(false);

  // Состояние Квеста 2 (Постеры на 4 стенах)
  const [selectedPosters, setSelectedPosters] = useState<{ [wallId: string]: string }>({});
  const [isSolvedQuest2, setIsSolvedQuest2] = useState(false);

  const lastClickTime = useRef(0);

  useEffect(() => {
    const quest1Names = ['p1', 'pl1', 'pl2', 'pl3', 'b1', 'b2', 'b3'];
    const excludedMeshes = [...quest1Names, 'q1', ...QUEST2_ALL_POSTERS];

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const name = (mesh.name || '').toLowerCase().trim();
        // Красим бетоном стены и пол, но НЕ трогаем объекты обоих квестов и plane p2!
        if (!excludedMeshes.includes(name)) {
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
      }
    });
  }, [scene, map, bumpMap]);

  // Единая надежная обработка кликов по интерактивным объектам в 3D
  const handlePointerDown = (e: any) => {
    const clickedMesh = e.object as THREE.Mesh;
    const name = (clickedMesh?.name || '').toLowerCase().trim();

    const now = Date.now();
    if (now - lastClickTime.current < 220) return;

    // --- Обработка клика по кнопкам КВЕСТА 1 ---
    let btnIndex = -1;
    if (name === 'b1') btnIndex = 0;
    else if (name === 'b2') btnIndex = 1;
    else if (name === 'b3') btnIndex = 2;

    if (btnIndex !== -1 && !isSolvedQuest1) {
      e.stopPropagation();
      lastClickTime.current = now;

      setChoices((prev) => {
        const next: [number, number, number] = [...prev];
        next[btnIndex] = (next[btnIndex] + 1) % 4;

        if (
          next[0] === QUEST1_CORRECT[0] &&
          next[1] === QUEST1_CORRECT[1] &&
          next[2] === QUEST1_CORRECT[2]
        ) {
          setIsSolvedQuest1(true);
          console.log('🎉 КВЕСТ 1 УСПЕШНО ПРОЙДЕН! (m2, m8, m11) -> Постеры Квеста 2 активированы!');
        }

        return next;
      });
      return;
    }

    // --- Обработка клика по постерам КВЕСТА 2 (только если Квест 1 уже решен!) ---
    if (QUEST2_ALL_POSTERS.includes(name) && isSolvedQuest1 && !isSolvedQuest2) {
      e.stopPropagation();
      lastClickTime.current = now;

      const wallId = name.charAt(0);

      setSelectedPosters((prev) => {
        const next = { ...prev };

        if (next[wallId] === name) {
          delete next[wallId];
        } else {
          next[wallId] = name;
        }

        // Проверяем победную комбинацию (1w2, 2w1, 3w3, 4w1)
        const isCorrect =
          next['1'] === QUEST2_CORRECT['1'] &&
          next['2'] === QUEST2_CORRECT['2'] &&
          next['3'] === QUEST2_CORRECT['3'] &&
          next['4'] === QUEST2_CORRECT['4'];

        if (isCorrect) {
          setIsSolvedQuest2(true);
          console.log('🎉 КВЕСТ 2 УСПЕШНО ПРОЙДЕН! (1w2, 2w1, 3w3, 4w1) -> САЛЮТ И ПОБЕДА НА P2!');
        }

        return next;
      });
    }
  };

  return (
    <>
      <primitive
        object={scene}
        position={[0, 0, 0]}
        onPointerDown={handlePointerDown}
      />
      <QuestStand
        scene={scene}
        choices={choices}
        isSolved={isSolvedQuest1}
      />
      <QuestWallPosters
        scene={scene}
        selectedPosters={selectedPosters}
        isQuest1Solved={isSolvedQuest1}
        isQuest2Solved={isSolvedQuest2}
      />
    </>
  );
}

useGLTF.preload('/room.glb');


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
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 16;
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

    // Фоновая музыка бутика
    const [isMuted, setIsMuted] = useState(true);
    const audioRef = useRef<HTMLAudioElement | null>(null);
  
    // Инициализация аудио и попытка плавного старта при первом же клике/касании
    useEffect(() => {
      const audio = new Audio('/music.mp3');
      audio.loop = true;
      audio.volume = 0.45; // Мягкая ненавязчивая громкость 45%
      audioRef.current = audio;
  
      const startAudioOnFirstInteraction = () => {
        if (audioRef.current) {
          audioRef.current.play().then(() => {
            setIsMuted(false);
          }).catch(() => {
            // Если браузер заблокировал до клика по кнопке
          });
        }
        window.removeEventListener('pointerdown', startAudioOnFirstInteraction);
        window.removeEventListener('keydown', startAudioOnFirstInteraction);
      };
  
      window.addEventListener('pointerdown', startAudioOnFirstInteraction, { once: true });
      window.addEventListener('keydown', startAudioOnFirstInteraction, { once: true });
  
      return () => {
        audio.pause();
        audio.src = '';
      };
    }, []);
  
    // Переключение звука кнопкой
    const toggleSound = (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation(); // Чтобы клик по кнопке не двигал дрон
      if (!audioRef.current) return;
  
      if (isMuted) {
        audioRef.current.play().then(() => setIsMuted(false)).catch(console.error);
      } else {
        audioRef.current.pause();
        setIsMuted(true);
      }
    };

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
      {/* Кнопка включения/выключения музыки бутика */}
      <button
        onClick={toggleSound}
        onTouchEnd={toggleSound}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 90,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: isMuted ? 'rgba(15, 17, 22, 0.65)' : 'rgba(0, 240, 255, 0.15)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: isMuted ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 240, 255, 0.6)',
          boxShadow: isMuted ? 'none' : '0 0 15px rgba(0, 240, 255, 0.3)',
          color: isMuted ? '#8e96a4' : '#00f0ff',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          outline: 'none',
          transition: 'all 0.3s ease',
          pointerEvents: 'auto',
        }}
        title={isMuted ? 'Включить музыку' : 'Выключить музыку'}
      >
        {isMuted ? '🔇' : '🔊'}
      </button>
      
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 2.5]}
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

          {/* 1. Изображение главная стена p1.png */}
          <WallDecal
            url="/p1.png"
            position={[6.5, 2.25, -13.39]}
            rotation={[0, 0, 0]}
            size={[15, 5]}
          />

          {/* 2. Изображение задняя p2.png */}
          <WallDecal
            url="/p2.png"
            position={[14.5, 5, 0]}
            rotation={[0, -1.5708, 0]}
            size={[25, 15]}
          />

          {/* 3. Изображение p3.png */}
          <WallDecal
            url="/p3.png"
            position={[-14.62, 2.2, -0.5]}
            rotation={[0, 1.5708, 0]}
            size={[22, 5]}
          />

          {/* 4. Изображение p4.png */}
          <WallDecal
            url="/p4.png"
            position={[-9.5, 2.2, -13.39]}
            rotation={[0, 0, 0]}
            size={[10, 5]}
          />

          {/* 5. Изображение p5.png */}
          <WallDecal
            url="/p5.png"
            position={[-3.95, 2.2, -10]}
            rotation={[0, -1.5708, 0]}
            size={[6, 5]}
          />

          {/* 6. Изображение p6.png */}
          <WallDecal
            url="/p6.png"
            position={[0, -2, 0]}
            rotation={[0, 0, 0]}
            size={[2.5, 2.5]}
          />

          {/* 7. Изображение p7.png */}
          <WallDecal
            url="/p7.png"
            position={[-14.62, 4.2, 11]}
            rotation={[0, 1.5708, 0]}
            size={[12, 8]}
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
            position={[-14.63, 6, 0]}
            rotation={[0, 1.5708, 0]}
            size={[18.0, 3.0]}
            fps={4}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}