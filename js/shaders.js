// Shader patches: one material draws every road surface type with markings
// computed in metres, and buildings get procedural windows.
import * as THREE from 'three';

const ROAD_GLSL = /* glsl */`
uniform sampler2D uImg; uniform vec4 uImgA; uniform sampler2D uNoise;
varying vec4 vRoad; varying vec4 vRoad2; varying vec3 vWPos;
float lineMask(float d, float w){ return 1.0 - smoothstep(w*0.55, w, d); }
float dashMask(float along, float period, float duty){ return step(fract(along/period), duty); }
vec3 roadColor(){
  float lat = vRoad.x; float along = vRoad.y; float hw = vRoad.z; float a = abs(lat);
  float mk = vRoad2.x; float lanes = max(vRoad2.y, 1.0); float surf = vRoad2.z;
  vec2 iuv = vec2(uImgA.x*vWPos.x + uImgA.y, uImgA.z*vWPos.z + uImgA.w);
  vec3 img = texture2D(uImg, iuv).rgb;
  float n = texture2D(uNoise, vWPos.xz*0.23).r;
  float n2 = texture2D(uNoise, vWPos.xz*0.031 + 0.37).r;
  vec3 col; float blend = 0.0;
  if (surf < 1.5) {                      // asphalt
    col = vec3(0.058,0.060,0.066)*(0.72+0.55*n)*(0.82+0.36*n2);
    blend = smoothstep(hw-0.35, hw, a)*0.45;
  } else if (surf < 2.5) {               // concrete slabs
    col = vec3(0.34,0.33,0.31)*(0.8+0.35*n)*(0.82+0.36*n2);
    float j = max(step(fract(along/4.5), 0.012), step(a, 0.03));
    col *= 1.0 - 0.45*j;
    blend = smoothstep(hw-0.3, hw, a)*0.45;
  } else if (surf < 3.5) {               // paving / bricks
    vec2 b = vec2(along/0.45, lat/0.22); if (mod(floor(b.y),2.0) > 0.5) b.x += 0.5;
    float e = min(fract(b.x), fract(b.y));
    col = mix(vec3(0.28,0.15,0.10), vec3(0.36,0.29,0.24), n) * (e < 0.1 ? 0.6 : 1.0);
  } else if (surf < 4.5) {               // red laterite / dirt
    col = vec3(0.40,0.16,0.065)*(0.62+0.62*n)*(0.78+0.44*n2);
    float rut = exp(-pow((a - hw*0.42)/0.35, 2.0));
    col *= 1.0 - 0.28*rut;
    blend = smoothstep(hw-1.3, hw, a)*0.9 + 0.12;
  } else if (surf < 5.5) {               // gravel / compacted
    col = vec3(0.29,0.24,0.19)*(0.6+0.8*n);
    blend = smoothstep(hw-0.9, hw, a)*0.8 + 0.1;
  } else if (surf < 6.5) {               // sand
    col = vec3(0.58,0.48,0.34)*(0.8+0.3*n); blend = smoothstep(hw-1.0, hw, a)*0.8 + 0.1;
  } else if (surf < 7.5) {               // grass
    col = img*0.85; blend = 0.6;
  } else if (surf < 8.5) {               // wooden planks
    col = vec3(0.22,0.14,0.08)*(0.7+0.5*n)*(step(0.08, fract(along/0.3))*0.4 + 0.6);
  } else if (surf < 9.5) {               // farm track: two ruts, grassy centre
    float r = exp(-pow((a-0.85)/0.33, 2.0));
    col = mix(img, vec3(0.38,0.16,0.065)*(0.7+0.5*n), r*0.92);
  } else if (surf < 10.5) {              // railway ballast + sleepers
    col = vec3(0.20,0.18,0.16)*(0.55+0.9*n);
    if (a < 1.15 && fract(along/0.6) < 0.38) col = vec3(0.12,0.085,0.055)*(0.8+0.3*n);
    blend = smoothstep(hw-0.5, hw, a)*0.7;
  } else {                               // footpath
    col = vec3(0.38,0.35,0.31)*(0.8+0.3*n); blend = smoothstep(hw-0.3, hw, a)*0.4;
  }
  if (surf < 2.5 && mk > 0.5) {          // lane markings
    vec3 W = vec3(0.78,0.78,0.74), Y = vec3(0.72,0.50,0.07);
    float lw = 0.085; float m = 0.0; vec3 mc = W;
    float edge = hw - 0.3;
    if (mk > 1.5) m = max(m, lineMask(abs(a-edge), lw));
    if (mk < 2.5) {
      m = max(m, lineMask(a, lw) * dashMask(along, 9.0, 0.34));
    } else if (mk < 3.5) {
      float y2 = lineMask(abs(a-0.14), lw); if (y2 > m) { m = y2; mc = Y; }
      float n1 = max(1.0, floor(lanes/2.0 + 0.5)); float lw2 = edge / n1;
      for (int k = 1; k < 4; k++) { if (float(k) < n1) m = max(m, lineMask(abs(a - float(k)*lw2), lw) * dashMask(along, 12.0, 0.25)); }
    } else {
      float x = lat + edge; float lw2 = 2.0*edge/lanes;
      for (int k = 1; k < 5; k++) { if (float(k) < lanes) m = max(m, lineMask(abs(x - float(k)*lw2), lw) * dashMask(along, 12.0, 0.25)); }
      if (lat < 0.0 && lineMask(abs(a-edge), lw) > 0.0) mc = Y;
    }
    col = mix(col, mc*(0.82+0.25*n), m*0.92);
  }
  return mix(col, img, clamp(blend, 0.0, 1.0));
}
`;

export function makeRoadMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aRoad; attribute vec4 aRoad2; varying vec4 vRoad; varying vec4 vRoad2; varying vec3 vWPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vRoad = aRoad; vRoad2 = aRoad2; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ROAD_GLSL)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = roadColor();');
  };
  m.customProgramCacheKey = () => 'road-v1';
  return m;
}

export const NIGHT = { value: 0 }; // 0 day … 1 night: lights up windows
export function makeBuildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWall; varying vec4 vWall;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWall = aWall;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWall; uniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.62, 0.28) * winLit * uNight * 0.9;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float winLit = 0.0;
if (vWall.z > 0.5) {
  float big = step(1.5, vWall.z);
  float fl = mod(vWall.y, 3.2);
  float c = mod(vWall.x, mix(3.4, 2.7, big));
  float win = step(1.0, fl) * step(fl, 2.35) * step(0.75, c) * step(c, mix(1.9, 2.15, big))
            * step(0.9, vWall.y) * step(vWall.y, vWall.w - 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.05, 0.065), win * 0.88);
  vec2 cell = floor(vec2(vWall.x / mix(3.4, 2.7, big), vWall.y / 3.2));
  winLit = win * step(0.45, fract(sin(dot(cell + floor(vWall.w * 7.0), vec2(12.9898, 78.233))) * 43758.5453));
}`);
  };
  m.customProgramCacheKey = () => 'bldg-v2';
  return m;
}

/* ---------- terrain: satellite drape + near-camera detail splatting + rice-field bunds ---------- */
export function makeTerrainMaterial(map, u) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWT;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWT = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWT; uniform sampler2D uSplat, uGrass, uRice, uSoil, uGravel; uniform vec4 uGrid; uniform vec2 uTexel; uniform float uDetailOn; uniform vec4 uSeason;`)
      .replace('#include <map_fragment>', `
vec4 sat = texture2D(map, vMapUv);
vec3 col = sat.rgb;
float dist = length(vWT - cameraPosition);
// rice season: tint the rice fields (splat green channel) – flooded, green, golden or harvested
if (uSeason.a > 0.0) {
  vec4 sp0 = texture2D(uSplat, vec2((vWT.x - uGrid.x) / uGrid.z, (vWT.z - uGrid.y) / uGrid.w));
  float rw = sp0.g / (sp0.r + sp0.g + sp0.b + sp0.a + 0.001);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, uSeason.rgb * (0.7 + 0.9 * lum), rw * uSeason.a);
}
float k = (1.0 - smoothstep(35.0, 280.0, dist)) * uDetailOn;
if (k > 0.002) {
  vec2 suv = vec2((vWT.x - uGrid.x) / uGrid.z, (vWT.z - uGrid.y) / uGrid.w);
  vec4 sp = texture2D(uSplat, suv);
  float ws = sp.r + sp.g + sp.b + sp.a + 0.001;
  vec2 w = vWT.xz;
  float d = (texture2D(uGrass, w / 3.0).r * sp.r + texture2D(uRice, w / 2.4).r * sp.g
           + texture2D(uSoil, w / 4.5).r * sp.b + texture2D(uGravel, w / 2.0).r * sp.a) / ws;
  float d2 = (texture2D(uGrass, w / 11.0).r * (sp.r + sp.g) + texture2D(uSoil, w / 13.0).r * (sp.b + sp.a)) / ws;
  d = mix(d, d2, smoothstep(30.0, 140.0, dist));
  const vec3 LW = vec3(0.3, 0.59, 0.11);
  float lx = dot(texture2D(map, vMapUv + vec2(uTexel.x, 0.0)).rgb - texture2D(map, vMapUv - vec2(uTexel.x, 0.0)).rgb, LW);
  float ly = dot(texture2D(map, vMapUv + vec2(0.0, uTexel.y)).rgb - texture2D(map, vMapUv - vec2(0.0, uTexel.y)).rgb, LW);
  float edge = smoothstep(0.025, 0.07, length(vec2(lx, ly))) * (sp.g / ws);
  col *= mix(1.0, d * 2.0, k * 0.85);
  col = mix(col, vec3(0.24, 0.20, 0.12), edge * k * 0.6);
}
diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'terrain-v3';
  return m;
}

/* ---------- water: opaque, colour by depth over the carved terrain, shoreline foam ---------- */
export function makeWaterMaterial(normalMap, u) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.0, normalMap, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide, envMapIntensity: 0.2 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWW; uniform sampler2D uHgt, uImg, uRefl; uniform vec4 uGrid, uImgA; uniform float uTime, uReflOn; uniform mat4 uTexMat;`)
      .replace('#include <map_fragment>', `
vec2 suv = vec2((vWW.x - uGrid.x) / uGrid.z, (vWW.z - uGrid.y) / uGrid.w);
float depth = vWW.y - texture2D(uHgt, suv).r;
vec3 img = texture2D(uImg, vec2(uImgA.x * vWW.x + uImgA.y, uImgA.z * vWW.z + uImgA.w)).rgb;
vec3 deep = mix(img * 0.55, vec3(0.025, 0.06, 0.07), 0.55);
vec3 col = mix(img * 0.92, deep, smoothstep(0.05, 2.2, depth));
float reflK = 0.0; vec3 reflAdd = vec3(0.0);
if (uReflOn > 0.5) { // planar reflection, rippled by the normal map, Fresnel-weighted
  vec4 rc = uTexMat * vec4(vWW, 1.0);
  vec2 rip = (texture2D(normalMap, vNormalMapUv).xy - 0.5) * 0.05;
  vec3 refl = texture2D(uRefl, rc.xy / rc.w + rip).rgb;
  vec3 vdir = normalize(cameraPosition - vWW);
  float fres = 0.1 + 0.9 * pow(1.0 - clamp(vdir.y, 0.0, 1.0), 4.0);
  reflK = clamp(fres * 0.85 + 0.3, 0.0, 0.92) * smoothstep(0.04, 0.35, depth);
  reflAdd = refl * reflK;          // added as emitted light so the lighting/env specular doesn't wash it out
}
float foam = (1.0 - smoothstep(0.0, 0.18, depth)) * (0.6 + 0.4 * sin(uTime * 1.7 + vWW.x * 0.9 + vWW.z * 0.7));
col += vec3(0.22) * foam;
diffuseColor.rgb = col * (1.0 - reflK);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += reflAdd;');
  };
  m.customProgramCacheKey = () => 'water-v4';
  return m;
}

/* ---------- grass / rice blades with wind ---------- */
export function makeGrassMaterial(u) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float sway = sin(uTime * 1.9 + ip.x * 0.35 + ip.z * 0.27) * 0.6 + sin(uTime * 3.1 + ip.x * 1.3) * 0.25;
transformed.x += sway * 0.12 * position.y * position.y;
transformed.z += sway * 0.06 * position.y * position.y;`);
  };
  m.customProgramCacheKey = () => 'grass-v2';
  return m;
}
