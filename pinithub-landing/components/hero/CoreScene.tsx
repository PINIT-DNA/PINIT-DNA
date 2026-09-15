'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/* ------------------------------------------------------------------
   The orbiting asset nodes. Rendered as glass "file chips" rather than
   icons so they read as real assets at small scale.
------------------------------------------------------------------ */
const NODES = [
  { label: 'IMG', name: 'Images', tint: '#55E6FF' },
  { label: 'MP4', name: 'Video', tint: '#2D7BFF' },
  { label: '</>', name: 'Source Code', tint: '#14D991' },
  { label: 'FIG', name: 'Design Files', tint: '#6F5CFF' },
  { label: 'DOC', name: 'Documents', tint: '#55E6FF' },
  { label: 'ADS', name: 'Marketing', tint: '#2D7BFF' },
  { label: 'WAV', name: 'Music', tint: '#6F5CFF' },
  { label: '.AI', name: 'AI Models', tint: '#55E6FF' },
  { label: 'PDF', name: 'PDF', tint: '#2D7BFF' },
  { label: 'PPT', name: 'Presentations', tint: '#6F5CFF' },
] as const;

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRESNEL_FRAG = /* glsl */ `
  uniform vec3  uInner;
  uniform vec3  uEdge;
  uniform float uPower;
  uniform float uIntensity;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float f = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), uPower);
    float pulse = 0.86 + 0.14 * sin(uTime * 1.5);
    vec3 col = mix(uInner, uEdge, f);
    gl_FragColor = vec4(col, f * uIntensity * pulse);
  }
`;

/** Draws a chip sprite (rounded glass panel + label) into a canvas texture. */
function chipTexture(label: string, tint: string): THREE.Texture {
  const w = 256;
  const h = 144;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = 30;

  const rounded = (inset: number, radius: number) => {
    g.beginPath();
    g.moveTo(inset + radius, inset);
    g.arcTo(w - inset, inset, w - inset, h - inset, radius);
    g.arcTo(w - inset, h - inset, inset, h - inset, radius);
    g.arcTo(inset, h - inset, inset, inset, radius);
    g.arcTo(inset, inset, w - inset, inset, radius);
    g.closePath();
  };

  // Body: dark glass with a lit top edge
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, 'rgba(23, 39, 68, 0.96)');
  body.addColorStop(1, 'rgba(6, 11, 26, 0.94)');
  rounded(6, r);
  g.fillStyle = body;
  g.fill();

  g.lineWidth = 2;
  g.strokeStyle = 'rgba(184,194,208,0.22)';
  g.stroke();

  rounded(6, r);
  g.save();
  g.clip();
  const sheen = g.createLinearGradient(0, 0, 0, h * 0.55);
  sheen.addColorStop(0, 'rgba(248,250,252,0.14)');
  sheen.addColorStop(1, 'rgba(248,250,252,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h * 0.55);
  g.restore();

  // Accent bar + status dot
  g.fillStyle = tint;
  g.globalAlpha = 0.9;
  g.fillRect(26, h - 34, 46, 4);
  g.beginPath();
  g.arc(w - 40, 40, 6, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  g.font = '600 46px "IBM Plex Mono", ui-monospace, monospace';
  g.fillStyle = 'rgba(248,250,252,0.94)';
  g.textBaseline = 'middle';
  g.fillText(label, 26, h / 2 - 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export default function CoreScene({ className = '' }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return; // No WebGL: the CSS backdrop behind this canvas stands on its own.
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.35, 7.4);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const world = new THREE.Group();
    scene.add(world);

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(o: T) => {
      disposables.push(o);
      return o;
    };

    const makeFresnel = (inner: string, edge: string, power: number, intensity: number) =>
      track(
        new THREE.ShaderMaterial({
          vertexShader: FRESNEL_VERT,
          fragmentShader: FRESNEL_FRAG,
          uniforms: {
            uInner: { value: new THREE.Color(inner) },
            uEdge: { value: new THREE.Color(edge) },
            uPower: { value: power },
            uIntensity: { value: intensity },
            uTime: { value: 0 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );

    /* ---------------- Core ---------------- */
    const coreGroup = new THREE.Group();
    world.add(coreGroup);

    const coreGeo = track(new THREE.IcosahedronGeometry(1.18, 1));
    const coreSolid = new THREE.Mesh(
      coreGeo,
      track(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#0a1834'),
          transparent: true,
          opacity: 0.92,
        }),
      ),
    );
    coreGroup.add(coreSolid);

    const coreEdges = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(coreGeo)),
      track(new THREE.LineBasicMaterial({ color: new THREE.Color('#55E6FF'), transparent: true, opacity: 0.5 })),
    );
    coreGroup.add(coreEdges);

    const coreGlow = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(1.24, 3)),
      makeFresnel('#12306b', '#55E6FF', 2.6, 1.15),
    );
    coreGroup.add(coreGlow);

    const halo = new THREE.Mesh(
      track(new THREE.SphereGeometry(2.05, 48, 48)),
      makeFresnel('#050816', '#2D7BFF', 3.4, 0.55),
    );
    coreGroup.add(halo);

    // Inner shard that counter-rotates, giving the core visible internal depth
    const shard = new THREE.Mesh(
      track(new THREE.OctahedronGeometry(0.66, 0)),
      track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#6F5CFF'), transparent: true, opacity: 0.55, wireframe: true })),
    );
    coreGroup.add(shard);

    /* ---------------- Energy rings ---------------- */
    const rings: THREE.Mesh[] = [];
    const ringSpecs = [
      { r: 2.15, tilt: [1.32, 0, 0.18], color: '#2D7BFF', opacity: 0.5 },
      { r: 2.75, tilt: [1.16, 0.42, -0.3], color: '#55E6FF', opacity: 0.34 },
      { r: 3.35, tilt: [1.48, -0.34, 0.5], color: '#6F5CFF', opacity: 0.26 },
    ] as const;

    for (const s of ringSpecs) {
      const mesh = new THREE.Mesh(
        track(new THREE.TorusGeometry(s.r, 0.0075, 6, 220)),
        track(
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(s.color),
            transparent: true,
            opacity: s.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      );
      mesh.rotation.set(s.tilt[0], s.tilt[1], s.tilt[2]);
      world.add(mesh);
      rings.push(mesh);
    }

    /* ---------------- Orbiting asset nodes ---------------- */
    type Node = {
      sprite: THREE.Sprite;
      link: THREE.Line;
      radius: number;
      speed: number;
      phase: number;
      yTilt: number;
      bob: number;
    };

    const nodes: Node[] = [];
    const linkPositions: THREE.BufferAttribute[] = [];

    NODES.forEach((n, i) => {
      const tex = track(chipTexture(n.label, n.tint));
      const sprite = new THREE.Sprite(
        track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })),
      );
      sprite.scale.set(0.86, 0.48, 1);
      world.add(sprite);

      const geo = track(new THREE.BufferGeometry());
      const pos = new THREE.BufferAttribute(new Float32Array(6), 3);
      geo.setAttribute('position', pos);
      linkPositions.push(pos);
      const link = new THREE.Line(
        geo,
        track(
          new THREE.LineBasicMaterial({
            color: new THREE.Color(n.tint),
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      );
      world.add(link);

      const band = i % 3;
      nodes.push({
        sprite,
        link,
        radius: [2.55, 3.15, 3.75][band] + (i % 2) * 0.12,
        speed: [0.19, -0.14, 0.11][band],
        phase: (i / NODES.length) * Math.PI * 2,
        yTilt: [0.32, -0.18, 0.46][band],
        bob: 0.5 + (i % 4) * 0.35,
      });
    });

    /* ---------------- Star dust ---------------- */
    const STAR_COUNT = 620;
    const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const rr = 6 + Math.random() * 13;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = rr * Math.cos(phi) * 0.55;
      starPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta) - 4;
    }
    const starGeo = track(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      track(
        new THREE.PointsMaterial({
          color: new THREE.Color('#9fd4ff'),
          size: 0.035,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    scene.add(stars);

    /* ---------------- Interaction + loop ---------------- */
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Pull the camera back on narrow viewports so the orbits never clip.
      camera.position.z = w < 640 ? 9.4 : w < 1024 ? 8.4 : 7.4;
      camera.updateProjectionMatrix();
    };

    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;
    let intro = 0;
    let t = 0;

    const frame = () => {
      // Accumulate manually: getElapsedTime() consumes the same delta getDelta() does.
      const dt = Math.min(clock.getDelta(), 0.05);
      t += dt;
      intro = Math.min(1, intro + dt * 0.55);
      const easedIntro = 1 - Math.pow(1 - intro, 3);

      pointer.x += (pointer.tx - pointer.x) * 0.035;
      pointer.y += (pointer.ty - pointer.y) * 0.035;

      world.rotation.y = pointer.x * 0.22 + (reduce ? 0 : t * 0.035);
      world.rotation.x = -pointer.y * 0.13;

      const breath = 1 + Math.sin(t * 1.15) * 0.022;
      coreGroup.scale.setScalar(breath * (0.6 + 0.4 * easedIntro));
      coreGroup.rotation.y = reduce ? 0 : t * 0.14;
      coreGroup.rotation.x = Math.sin(t * 0.32) * 0.09;
      shard.rotation.y = -t * 0.42;
      shard.rotation.z = t * 0.22;

      rings.forEach((ring, i) => {
        if (!reduce) ring.rotation.z += (i % 2 === 0 ? 0.0022 : -0.0016);
        const m = ring.material as THREE.MeshBasicMaterial;
        m.opacity = ringSpecs[i].opacity * easedIntro * (0.75 + 0.25 * Math.sin(t * 0.9 + i));
        ring.scale.setScalar(0.82 + 0.18 * easedIntro);
      });

      nodes.forEach((n, i) => {
        const a = n.phase + (reduce ? 0 : t * n.speed);
        const x = Math.cos(a) * n.radius;
        const z = Math.sin(a) * n.radius;
        const y = Math.sin(a * 1.3) * n.yTilt + Math.sin(t * 0.8 + n.bob) * 0.09;
        n.sprite.position.set(x, y, z);
        n.sprite.scale.set(0.86, 0.48, 1).multiplyScalar(0.75 + 0.25 * easedIntro);

        const mat = n.sprite.material as THREE.SpriteMaterial;
        // Nodes swinging behind the core dim, which sells the depth.
        const depth = (Math.sin(a) + 1) / 2;
        mat.opacity = easedIntro * (0.42 + depth * 0.58);

        const arr = linkPositions[i].array as Float32Array;
        arr[0] = 0;
        arr[1] = 0;
        arr[2] = 0;
        arr[3] = x;
        arr[4] = y;
        arr[5] = z;
        linkPositions[i].needsUpdate = true;
        (n.link.material as THREE.LineBasicMaterial).opacity =
          easedIntro * (0.05 + 0.13 * Math.max(0, Math.sin(t * 0.7 + i * 0.9)));
      });

      if (!reduce) {
        stars.rotation.y = t * 0.012;
        stars.rotation.x = pointer.y * 0.03;
      }
      (stars.material as THREE.PointsMaterial).opacity = 0.6 * easedIntro;

      for (const d of disposables) {
        const mat = d as unknown as THREE.ShaderMaterial;
        if (mat.uniforms?.uTime) mat.uniforms.uTime.value = t;
      }

      renderer.render(scene, camera);
      if (running) raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const io = new IntersectionObserver(
      ([entry]) => {
        running = entry.isIntersecting;
        cancelAnimationFrame(raf);
        if (running) {
          clock.getDelta(); // drop the paused interval
          raf = requestAnimationFrame(frame);
        }
      },
      { threshold: 0.01 },
    );
    io.observe(mount);

    resize();
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} aria-hidden className={`h-full w-full ${className}`} />;
}
