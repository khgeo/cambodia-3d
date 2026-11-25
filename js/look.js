// Cinematic look: soft glow around the sun and bright lights, ambient occlusion where things meet the ground,
// and a light colour grade (warmer highlights, cooler shadows, a little more colour, gentle vignette).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js?v=105';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js?v=105';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js?v=105';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js?v=105';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js?v=105';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.12 }, uCon: { value: 1.06 }, uVig: { value: 0.32 },
    uGain: { value: new THREE.Vector3(1.025, 1.0, 0.975) }, uLift: { value: new THREE.Vector3(0.0, 0.008, 0.02) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig; uniform vec3 uGain, uLift; varying vec2 vUv;
void main(){
  vec4 t = texture2D(tDiffuse, vUv); vec3 c = t.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);                       // a little more colour
  c = (c - 0.5) * uCon + 0.5;                      // a little more contrast
  c = c * uGain + uLift * (1.0 - c);               // warm highlights, cool shadows
  vec2 d = vUv - 0.5; c *= 1.0 - uVig * dot(d, d) * 1.6; // gentle vignette
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);
}`,
};

const CLEAN = { uniforms: { tDiffuse: { value: null } }, vertexShader: GRADE.vertexShader,
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bool bad = any(isnan(c)) || any(isinf(c)); gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : c; }' };

export class Look {
  constructor(world) {
    this.w = world; const r = world.renderer, s = r.getSize(new THREE.Vector2()), pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(s.x * pr, s.y * pr, { type: THREE.HalfFloatType, samples: r.capabilities.isWebGL2 ? 4 : 0 });
    const c = this.composer = new EffectComposer(r, rt);
    c.addPass(this.renderPass = new RenderPass(world.scene, world.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.12, 0.3, 3.0); // only the sun disc, lamps and bright highlights glow c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GRADE); c.addPass(this.grade);
    this.on = true; this.aoOn = false;
  }
  async setAO(on) { // ambient occlusion: darker where walls meet the ground, under eaves and trees (costly, so off by default)
    this.aoOn = on;
    if (on && !this.ao) {
      const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js?v=105');
      const s = this.w.renderer.getSize(new THREE.Vector2());
      this.ao = new GTAOPass(this.w.scene, this.w.camera, s.x, s.y);
      this.ao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
      this.ao.blendIntensity = 0.7; this.composer.insertPass(this.ao, 1);
      this.clean = new ShaderPass(CLEAN); this.composer.insertPass(this.clean, 2); // the sky has no depth: drop any NaN so the glow cannot spread it
    }
    if (this.ao) this.ao.enabled = this.clean.enabled = on;
  }
  setSize(w, h) { this.composer.setPixelRatio(this.w.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  render(dt) {
    // less glow in daylight haze, more at dusk and night when lamps and windows are lit
    const e = this.w.sunElev ?? 45; this.bloom.strength = e < 6 ? 0.3 : 0.12;
    this.composer.render(dt);
  }
}
