// Fair-weather clouds over the scene: cumulus heaps and high cirrus streaks on a dome that turns slowly with the
// wind, lit from the sun's side. Coverage and darkness follow the weather buttons (clear / haze / rain / storm).
import * as THREE from 'three';

export function makeCloudDome(uTime) {
  const U = { uTime, uSun: { value: new THREE.Vector3(0, 1, 0) }, uCover: { value: 0.42 }, uDark: { value: 0 }, uNight: { value: 0 }, uCirrus: { value: 0.6 } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ uniforms: U, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform float uCover; uniform float uDark; uniform float uNight; uniform float uCirrus; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 6; k++) { s += a * n(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
      void main(){ vec3 d = normalize(vD); if (d.y < 0.0) discard;
        vec2 uv = d.xz / (d.y + 0.08); vec2 wind = vec2(uTime * 0.004, uTime * 0.0015);
        // cumulus: heaps that thin out towards the horizon
        float c = fbm(uv * 1.6 + wind); float cov = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, c);
        float top = fbm(uv * 1.6 + wind + normalize(uSun.xz + 1e-4) * 0.06); float lit = clamp(0.62 + (c - top) * 6.0, 0.35, 1.0);
        // cirrus: long thin streaks high up
        float ci = fbm(vec2(uv.x * 0.6, uv.y * 3.5) + wind * 0.6) * smoothstep(0.45, 0.75, fbm(uv * 0.35 + 3.1)); ci = smoothstep(0.45, 0.85, ci) * uCirrus;
        float hz = smoothstep(0.0, 0.18, d.y); float a = max(cov, ci * 0.55) * hz;
        vec3 sunTint = mix(vec3(1.0, 0.86, 0.7), vec3(1.0), smoothstep(0.0, 0.4, uSun.y));
        vec3 col = mix(vec3(0.62, 0.66, 0.72), vec3(1.0) * sunTint, lit) * mix(1.0, 0.45, uDark);
        col *= mix(1.0, 0.08, uNight); gl_FragColor = vec4(col, a * mix(0.95, 1.0, uDark)); }` }));
  m.renderOrder = -1; m.frustumCulled = false; m.userData.U = U; return m;
}
