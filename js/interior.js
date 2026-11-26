// Inside a planet or the Sun: a cutaway of nested layers at their real proportions, with animated textures
// (convection in mantles, swirling liquid metal, granulation in the Sun) and an "exploded" view that pulls the
// layers apart. Used by the globe (Earth) and the cosmos view (Sun, Moon, planets).
// Models (rounded): Earth PREM; Moon and Mars from seismometers (Apollo, InSight); Mercury, Venus, giant planets and
// the Sun from NASA fact sheets and standard textbook models; giant-planet interiors are still debated.
import * as THREE from 'three';

const L = (en, km, r0, r1, kind, a, b, state, stateKm, note, noteKm) => ({ en, km, r0, r1, kind, a, b, state, stateKm, note, noteKm });
// kind: 0 rock crust, 1 solid mantle (convecting), 2 liquid metal, 3 solid metal / rock core, 4 gas & cloud bands,
// 5 metallic hydrogen, 6 hot "ices", 7 fusion core, 8 radiative zone, 9 convective zone, 10 partial melt
export const INTERIORS = {
  Sun: { R: 696000, layers: [
    L('Core', 'ស្នូល', 0, 0.25, 7, '#fff7d6', '#ffe58a', 'plasma, about 15 million °C', 'ប្លាស្មា ប្រហែល ១៥ លាន °C', 'Nuclear fusion turns about 600 million tonnes of hydrogen into helium every second. All sunlight starts here.', 'ប្រតិកម្មលាយនុយក្លេអ៊ែរ ប្រែអ៊ីដ្រូសែនប្រហែល ៦០០ លានតោន ទៅជាអេលីយ៉ូមរៀងរាល់វិនាទី។ ពន្លឺព្រះអាទិត្យទាំងអស់ចាប់ផ្ដើមពីទីនេះ។'),
    L('Radiative zone', 'តំបន់បញ្ចេញកាំរស្មី', 0.25, 0.7, 8, '#ff9d2e', '#ffd36b', 'plasma, 7 to 2 million °C', 'ប្លាស្មា ៧ ទៅ ២ លាន °C', 'Light bounces from atom to atom: energy needs about 100,000 years to cross this zone.', 'ពន្លឺលោតពីអាតូមមួយទៅអាតូមមួយ៖ ថាមពលត្រូវការប្រហែល ១០០០០០ ឆ្នាំ ដើម្បីឆ្លងកាត់តំបន់នេះ។'),
    L('Convective zone', 'តំបន់ចរន្តកម្ដៅ', 0.7, 1, 9, '#d83a10', '#ffa040', 'plasma, 2 million °C down to 5,500 °C at the surface', 'ប្លាស្មា ពី ២ លាន °C ចុះដល់ ៥៥០០ °C នៅផ្ទៃ', 'Hot gas rises and cooler gas sinks in giant cells; on the surface (photosphere) they show as granules the size of Cambodia.', 'ឧស្ម័នក្ដៅឡើង ឧស្ម័នត្រជាក់ជាងចុះ ជាកោសិកាធំៗ។ នៅលើផ្ទៃ (ហ្វូតូស្វ៊ែ) វាលេចជាគ្រាប់ៗ ធំប៉ុនប្រទេសកម្ពុជា។')] },
  Mercury: { R: 2440, layers: [
    L('Iron core', 'ស្នូលដែក', 0, 0.85, 2, '#d9822b', '#ffc15a', 'iron, partly liquid', 'ដែក ខ្លះរាវ', 'The largest core for its size of any planet: about 85% of the radius, so Mercury is very dense.', 'ស្នូលធំបំផុតធៀបនឹងទំហំ ក្នុងចំណោមភពទាំងអស់៖ ប្រហែល ៨៥% នៃកាំ ដូច្នេះភពពុធមានដង់ស៊ីតេខ្ពស់។'),
    L('Mantle', 'មែនថល', 0.85, 0.985, 1, '#6e4b35', '#9a6440', 'solid rock', 'ថ្មរឹង', 'A thin rocky mantle, only about 400 km thick.', 'មែនថលថ្មស្ដើង ក្រាស់ប្រហែលតែ ៤០០ គ.ម។'),
    L('Crust', 'សំបក', 0.985, 1, 0, '#7f7a74', '#a7a19a', 'solid rock', 'ថ្មរឹង', 'Cratered crust, about 35 km thick.', 'សំបកមានរណ្ដៅច្រើន ក្រាស់ប្រហែល ៣៥ គ.ម។')] },
  Venus: { R: 6052, layers: [
    L('Iron core', 'ស្នូលដែក', 0, 0.5, 2, '#d9822b', '#ffc15a', 'iron and nickel, probably liquid', 'ដែក និងនីកែល ប្រហែលជារាវ', 'Similar in size to Earth’s core, but Venus has almost no magnetic field: its core may not be churning.', 'ទំហំប្រហាក់ប្រហែលស្នូលផែនដី តែភពសុក្រស្ទើរគ្មានដែនម៉ាញេទិច៖ ស្នូលរបស់វាប្រហែលមិនកូរ។'),
    L('Mantle', 'មែនថល', 0.5, 0.995, 1, '#7a3318', '#c25a24', 'hot solid rock', 'ថ្មរឹងក្ដៅ', 'Hot rock that feeds the many volcanoes on Venus.', 'ថ្មក្ដៅ ដែលផ្គត់ផ្គង់ភ្នំភ្លើងជាច្រើនលើភពសុក្រ។'),
    L('Crust', 'សំបក', 0.995, 1, 0, '#9c7448', '#c79a62', 'basalt rock, 465 °C at the surface', 'ថ្មបាសាល់ ៤៦៥ °C នៅផ្ទៃ', 'Volcanic plains under thick clouds of sulfuric acid; the surface is hot enough to melt lead.', 'វាលភ្នំភ្លើង នៅក្រោមពពកអាស៊ីតស៊ុលហ្វួរីកក្រាស់។ ផ្ទៃក្ដៅល្មមរលាយសំណ។')] },
  Mars: { R: 3390, layers: [
    L('Iron core', 'ស្នូលដែក', 0, 0.54, 2, '#c8642a', '#ffb050', 'liquid iron with sulfur', 'ដែករាវ លាយស្ពាន់ធ័រ', 'Larger and lighter than expected: measured from “marsquakes” by NASA’s InSight lander (2021).', 'ធំ និងស្រាលជាងការរំពឹង៖ វាស់ពីការរញ្ជួយលើភពអង្គារ ដោយយាន InSight របស់ NASA (២០២១)។'),
    L('Mantle', 'មែនថល', 0.54, 0.985, 1, '#6a2e1a', '#a54a25', 'solid rock', 'ថ្មរឹង', 'Once fed Olympus Mons, the largest volcano in the Solar System (22 km high).', 'ធ្លាប់ផ្គត់ផ្គង់ Olympus Mons ភ្នំភ្លើងធំបំផុតក្នុងប្រព័ន្ធព្រះអាទិត្យ (ខ្ពស់ ២២ គ.ម)។'),
    L('Crust', 'សំបក', 0.985, 1, 0, '#93452a', '#c66d43', 'rock rich in iron oxide', 'ថ្មសម្បូរអុកស៊ីតដែក', 'About 50 km thick; iron oxide (rust) makes Mars red.', 'ក្រាស់ប្រហែល ៥០ គ.ម។ អុកស៊ីតដែក (ច្រែះ) ធ្វើឱ្យភពអង្គារមានពណ៌ក្រហម។')] },
  Moon: { R: 1737, layers: [
    L('Inner core', 'ស្នូលខាងក្នុង', 0, 0.14, 3, '#e8d8b0', '#fff2c8', 'solid iron', 'ដែករឹង', 'A small solid iron ball about 240 km across (radius).', 'បាល់ដែករឹងតូច កាំប្រហែល ២៤០ គ.ម។'),
    L('Outer core', 'ស្នូលខាងក្រៅ', 0.14, 0.19, 2, '#d9822b', '#ffc15a', 'liquid iron', 'ដែករាវ', 'A thin liquid shell, found from Apollo seismometer records.', 'ស្រទាប់រាវស្ដើង រកឃើញពីទិន្នន័យឧបករណ៍វាស់រញ្ជួយ Apollo។'),
    L('Partial melt', 'ស្រទាប់រលាយខ្លះ', 0.19, 0.28, 10, '#5a2418', '#8a3a22', 'partly molten rock', 'ថ្មរលាយខ្លះ', 'Rock that is partly melted, at the bottom of the mantle.', 'ថ្មដែលរលាយខ្លះ នៅបាតមែនថល។'),
    L('Mantle', 'មែនថល', 0.28, 0.98, 1, '#5c4a3c', '#83705e', 'solid rock', 'ថ្មរឹង', 'Cool and rigid today: the Moon’s volcanoes stopped about 1 billion years ago.', 'ត្រជាក់ និងរឹងសព្វថ្ងៃ៖ ភ្នំភ្លើងលើព្រះច័ន្ទបានឈប់ប្រហែល ១ ពាន់លានឆ្នាំមុន។'),
    L('Crust', 'សំបក', 0.98, 1, 0, '#8e8d88', '#bdbcb5', 'solid rock', 'ថ្មរឹង', 'About 35–40 km thick, thicker on the far side.', 'ក្រាស់ប្រហែល ៣៥–៤០ គ.ម ក្រាស់ជាងនៅម្ខាងដែលយើងមើលមិនឃើញ។')] },
  Jupiter: { R: 69911, layers: [
    L('Dilute core', 'ស្នូលលាយ', 0, 0.3, 3, '#8a7058', '#b8987a', 'rock, ice and metal mixed with hydrogen, about 20,000 °C', 'ថ្ម ទឹកកក និងលោហៈ លាយអ៊ីដ្រូសែន ប្រហែល ២០០០០ °C', 'NASA Juno found the core is not a hard ball but “fuzzy”, mixed into the hydrogen around it.', 'យាន Juno របស់ NASA រកឃើញថាស្នូលមិនមែនជាបាល់រឹងទេ តែ “ព្រិល” លាយចូលអ៊ីដ្រូសែនជុំវិញ។'),
    L('Metallic hydrogen', 'អ៊ីដ្រូសែនលោហៈ', 0.3, 0.78, 5, '#3c475c', '#7d8eae', 'liquid metal', 'លោហៈរាវ', 'Hydrogen squeezed so hard it becomes a liquid metal; its currents make Jupiter’s huge magnetic field.', 'អ៊ីដ្រូសែនត្រូវសង្កត់ខ្លាំងរហូតក្លាយជាលោហៈរាវ។ ចរន្តរបស់វាបង្កើតដែនម៉ាញេទិចដ៏ធំរបស់ភពព្រហស្បតិ៍។'),
    L('Liquid hydrogen', 'អ៊ីដ្រូសែនរាវ', 0.78, 0.98, 4, '#b48e62', '#e4cba4', 'hydrogen and helium, gas turning to liquid', 'អ៊ីដ្រូសែន និងអេលីយ៉ូម ពីឧស្ម័នទៅជារាវ', 'There is no solid surface: the gas gets denser and denser until it is a liquid.', 'គ្មានផ្ទៃរឹងទេ៖ ឧស្ម័នកាន់តែក្រាស់ រហូតក្លាយជារាវ។'),
    L('Atmosphere and clouds', 'បរិយាកាស និងពពក', 0.98, 1, 4, '#c9a27a', '#f2e2c6', 'gas: hydrogen, helium, ammonia clouds', 'ឧស្ម័ន៖ អ៊ីដ្រូសែន អេលីយ៉ូម ពពកអាម៉ូញាក់', 'Coloured cloud belts and the Great Red Spot, a storm wider than Earth.', 'ខ្សែពពកពណ៌ៗ និងចំណុចក្រហមធំ ជាព្យុះធំជាងផែនដី។')] },
  Saturn: { R: 58232, layers: [
    L('Core', 'ស្នូល', 0, 0.2, 3, '#8a7058', '#b8987a', 'rock and ice', 'ថ្ម និងទឹកកក', 'A rocky, icy core spread over a wide region, measured from waves in Saturn’s rings.', 'ស្នូលថ្ម និងទឹកកក រាលដាលលើតំបន់ធំ វាស់ពីរលកក្នុងកងរង្វង់របស់ភពសៅរ៍។'),
    L('Metallic hydrogen', 'អ៊ីដ្រូសែនលោហៈ', 0.2, 0.5, 5, '#3c475c', '#7d8eae', 'liquid metal', 'លោហៈរាវ', 'Makes Saturn’s magnetic field, perfectly lined up with its spin axis.', 'បង្កើតដែនម៉ាញេទិចភពសៅរ៍ ដែលតម្រង់ត្រង់នឹងអ័ក្សបង្វិល។'),
    L('Liquid hydrogen', 'អ៊ីដ្រូសែនរាវ', 0.5, 0.98, 4, '#c8ab78', '#efdcb2', 'hydrogen and helium', 'អ៊ីដ្រូសែន និងអេលីយ៉ូម', 'Saturn is so light that it would float in a (giant) bathtub of water.', 'ភពសៅរ៍ស្រាលណាស់ រហូតអាចអណ្ដែតក្នុងអាងទឹក (ដ៏ធំ)។'),
    L('Atmosphere and clouds', 'បរិយាកាស និងពពក', 0.98, 1, 4, '#d6bd8a', '#f4e6c4', 'gas', 'ឧស្ម័ន', 'Pale cloud belts and winds up to 1,800 km/h.', 'ខ្សែពពកស្លេក និងខ្យល់រហូតដល់ ១៨០០ គ.ម/ម៉ោង។')] },
  Uranus: { R: 25362, layers: [
    L('Rocky core', 'ស្នូលថ្ម', 0, 0.2, 3, '#7a6a5a', '#a89480', 'rock and metal, about 5,000 °C', 'ថ្ម និងលោហៈ ប្រហែល ៥០០០ °C', 'A rocky core about the size of Earth.', 'ស្នូលថ្ម ទំហំប្រហែលផែនដី។'),
    L('Ice mantle', 'មែនថលទឹកកក', 0.2, 0.75, 6, '#1f7f95', '#6fd2dd', 'hot dense fluid of water, ammonia and methane', 'វត្ថុរាវក្ដៅក្រាស់ នៃទឹក អាម៉ូញាក់ និងមេតាន', 'Called “ice” but hot and fluid; deep inside it may rain diamonds.', 'ហៅថា “ទឹកកក” តែក្ដៅ និងរាវ។ នៅជ្រៅខាងក្នុង ប្រហែលជាមានភ្លៀងពេជ្រ។'),
    L('Hydrogen–helium envelope', 'ស្រោមអ៊ីដ្រូសែន–អេលីយ៉ូម', 0.75, 1, 4, '#8fd3dc', '#c9f1f2', 'gas with methane', 'ឧស្ម័ន មានមេតាន', 'Methane gas absorbs red light, so Uranus looks blue-green. It spins lying on its side.', 'ឧស្ម័នមេតានស្រូបពន្លឺក្រហម ដូច្នេះភពអ៊ុយរ៉ានុសមើលទៅពណ៌ខៀវបៃតង។ វាបង្វិលដេកផ្អៀង។')] },
  Neptune: { R: 24622, layers: [
    L('Rocky core', 'ស្នូលថ្ម', 0, 0.25, 3, '#7a6a5a', '#a89480', 'rock and metal', 'ថ្ម និងលោហៈ', 'A rocky core a little bigger than Earth.', 'ស្នូលថ្ម ធំជាងផែនដីបន្តិច។'),
    L('Ice mantle', 'មែនថលទឹកកក', 0.25, 0.8, 6, '#1d4f9e', '#5a9be0', 'hot dense fluid of water, ammonia and methane', 'វត្ថុរាវក្ដៅក្រាស់ នៃទឹក អាម៉ូញាក់ និងមេតាន', 'Its heat drives the fastest winds in the Solar System, over 2,000 km/h.', 'កម្ដៅរបស់វាជំរុញខ្យល់លឿនបំផុតក្នុងប្រព័ន្ធព្រះអាទិត្យ លើសពី ២០០០ គ.ម/ម៉ោង។'),
    L('Hydrogen–helium envelope', 'ស្រោមអ៊ីដ្រូសែន–អេលីយ៉ូម', 0.8, 1, 4, '#3f6fd0', '#86a9ef', 'gas with methane', 'ឧស្ម័ន មានមេតាន', 'Deep blue from methane, with dark storms that come and go.', 'ពណ៌ខៀវចាស់ពីមេតាន មានព្យុះពណ៌ខ្មៅកើតឡើង ហើយរលាយបាត់។')] },
};
const RE = 6371;
INTERIORS.Earth = { R: RE, layers: [
  L('Inner core', 'ស្នូលខាងក្នុង', 0, 1 - 5150 / RE, 3, '#fff0b0', '#fffbe8', 'solid iron and nickel', 'ដែក និងនីកែលរឹង', '', ''),
  L('Outer core', 'ស្នូលខាងក្រៅ', 1 - 5150 / RE, 1 - 2891 / RE, 2, '#ff7a10', '#ffcf4a', 'liquid iron and nickel', 'ដែក និងនីកែលរាវ', '', ''),
  L('Lower mantle', 'មែនថលខាងក្រោម', 1 - 2891 / RE, 1 - 660 / RE, 1, '#8a2a0c', '#d8581c', 'solid, flows over millions of years', 'រឹង តែហូរក្នុងរយៈពេលរាប់លានឆ្នាំ', '', ''),
  L('Transition zone', 'តំបន់អន្តរកាល', 1 - 660 / RE, 1 - 410 / RE, 1, '#a63a16', '#d0602a', 'solid, denser minerals', 'រឹង រ៉ែក្រាស់ជាង', '', ''),
  L('Asthenosphere (upper mantle)', 'អាស្តេណូស្វ៊ែ (មែនថលខាងលើ)', 1 - 410 / RE, 1 - 100 / RE, 10, '#8a3216', '#c2522a', 'solid but soft, slowly flowing', 'រឹង តែទន់ ហូរយឺតៗ', '', ''),
  L('Lithospheric mantle', 'មែនថលលីតូស្វ៊ែ', 1 - 100 / RE, 1 - 35 / RE, 0, '#5e4636', '#7f6250', 'solid, rigid', 'រឹង មិនបត់បែន', '', ''),
  L('Crust', 'សំបកផែនដី', 1 - 35 / RE, 1, 0, '#8a7058', '#b39a7c', 'solid rock', 'ថ្មរឹង', '', '')] };

const NOISE = `
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y), mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * n3(p); p = p * 2.02 + 3.1; a *= 0.5; } return s; }
float worley(vec3 p){ vec3 i = floor(p), f = fract(p); float d = 9.0; for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) { vec3 g = vec3(x, y, z), o = vec3(h3(i + g), h3(i + g + 7.1), h3(i + g + 13.7)); d = min(d, length(g + o - f)); } return d; }`;
const VS = `varying vec3 vP; varying vec3 vNv; void main(){ vP = position; vNv = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `uniform float t, mode, kind, r0, r1, uHalf; uniform vec3 ca, cb, ce1, ce2, ce3, cd; varying vec3 vP; varying vec3 vNv; ${NOISE}
mat2 rot(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
void main(){
  if (mode > 0.5 && (uHalf > 0.5 ? dot(vP, cd) > 0.0 : (dot(vP, ce1) > 0.0 && dot(vP, ce2) > 0.0 && dot(vP, ce3) > 0.0))) discard;
  float r = length(vP); if (mode < 0.5 && (r > r1 + 1e-4 || r < r0 - 1e-4)) discard;
  float f = clamp((r - r0) / max(r1 - r0, 1e-4), 0.0, 1.0); vec3 q = vP, c;
  if (kind < 0.5) { float n = fbm(q * 70.0); c = mix(ca, cb, n) * (0.82 + 0.18 * sin(r * 1400.0 + n * 6.0)); }
  else if (kind < 1.5) { vec3 w = q * 4.5 + vec3(0.0, t * 0.025, t * 0.01); float n = fbm(w + fbm(w * 1.7) * 1.6); float ridge = 1.0 - abs(n * 2.0 - 1.0);
    c = mix(ca, cb, smoothstep(0.25, 0.8, n)); c += vec3(1.0, 0.5, 0.1) * pow(ridge, 7.0) * (0.25 + 0.75 * (1.0 - f)); c *= 0.8 + 0.4 * (1.0 - f); }
  else if (kind < 2.5) { vec3 s = q; s.xz = rot(t * 0.12 * (1.6 - r)) * s.xz; float w = fbm(s * 3.0 + t * 0.04); float n = fbm(s * 7.0 + w * 2.2); c = mix(ca, cb, n) * (0.95 + 0.35 * n); }
  else if (kind < 3.5) { float n = fbm(q * 28.0); c = mix(ca, cb, n) + 0.12 * pow(fbm(q * 95.0), 3.0); c *= 1.08 - 0.25 * f; }
  else if (kind < 4.5) { float lat = q.y / max(r, 1e-3); float n = fbm(q * vec3(4.0, 30.0, 4.0) + vec3(t * 0.03, 0.0, 0.0)); c = mix(ca, cb, 0.5 + 0.5 * sin(lat * 34.0 + n * 5.0)) * (0.9 + 0.15 * n); }
  else if (kind < 5.5) { vec3 s = q; s.xz = rot(t * 0.08) * s.xz; float n = fbm(s * 8.0 + fbm(s * 3.0) * 1.5); c = mix(ca, cb, n) + vec3(0.35, 0.4, 0.5) * pow(n, 5.0); }
  else if (kind < 6.5) { vec3 s = q; s.xz = rot(t * 0.1 * (1.5 - r)) * s.xz; float n = fbm(s * 6.0 + fbm(s * 2.5 + t * 0.03) * 2.0); c = mix(ca, cb, n) + vec3(0.6, 0.9, 1.0) * pow(n, 6.0) * 0.5; }
  else if (kind < 7.5) { float n = fbm(q * 14.0 + t * 0.25); c = mix(ca, cb, n) * (1.25 - 0.4 * f); }
  else if (kind < 8.5) { vec3 d = q / max(r, 1e-4); float n = fbm(d * 22.0 + vec3(r * 2.0 - t * 0.06)); float s = fbm(d * 60.0 + r * 0.5); c = mix(ca, cb, n * 0.7 + f * 0.35) * (0.85 + 0.3 * s); }
  else if (kind < 9.5) { vec3 d = q / max(r, 1e-4); float w = worley(d * 16.0 + vec3(0.0, t * 0.04, 0.0) + r * 5.0); float n = fbm(d * 30.0 + t * 0.05); c = mix(cb * 1.15, ca * 0.7, smoothstep(0.15, 0.9, w)) * (0.9 + 0.2 * n); }
  else { float n = fbm(q * 45.0 + vec3(0.0, t * 0.01, 0.0)); c = mix(ca, cb, n) + vec3(1.0, 0.45, 0.1) * smoothstep(0.62, 0.75, n) * 0.6; }
  if (mode < 0.5) { float e = min(abs(r - r0), abs(r1 - r)); c *= 1.0 - 0.45 * smoothstep(0.004, 0.0, e) * step(0.001, r0 + (1.0 - r1)); }
  else { c *= 0.5 + 0.5 * abs(vNv.z); if (mode > 1.5) c *= 0.55; }
  gl_FragColor = vec4(c, 1.0);
}`;
// cut a standard three.js material away inside the removed octant (for the planet's own textured surface)
export function cutMaterial(mat, U) {
  const m = mat.clone(); m.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform mat3 uRot; varying vec3 vObjC;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObjC = uRot * transformed;');
    sh.fragmentShader = 'uniform vec3 ce1; uniform vec3 ce2; uniform vec3 ce3; uniform vec3 cd; uniform float uHalf; varying vec3 vObjC;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n if (uHalf > 0.5 ? dot(vObjC, cd) > 0.0 : (dot(vObjC, ce1) > 0.0 && dot(vObjC, ce2) > 0.0 && dot(vObjC, ce3) > 0.0)) discard;'); };
  m.customProgramCacheKey = () => 'cut' + mat.type; return m; }
// three perpendicular unit vectors whose diagonal points at d (the octant opens towards d)
export function octant(d) { d = d.clone().normalize(); const a = new THREE.Vector3(0, 1, 0).cross(d); if (a.lengthSq() < 1e-6) a.set(1, 0, 0).cross(d); a.normalize(); const b = new THREE.Vector3().crossVectors(d, a);
  return [0, 1, 2].map(k => d.clone().multiplyScalar(1 / Math.sqrt(3)).addScaledVector(a, Math.sqrt(2 / 3) * Math.cos(k * 2 * Math.PI / 3 + 0.3)).addScaledVector(b, Math.sqrt(2 / 3) * Math.sin(k * 2 * Math.PI / 3 + 0.3)).normalize()); }
const LOW = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;

export class Interior {
  // def: INTERIORS entry; E: three axes of the removed octant; surface: material for the outer skin (or null: drawn elsewhere); surfRot: its rotation
  constructor(def, { E, surface = null, surfRot = null, parent }) {
    this.def = def; this.E = E; this.group = new THREE.Group(); this.group.visible = false; parent.add(this.group); this.split = 0; this.speed = 1; this.lang = 'en';
    // exploded view: the planet is cut in half instead (half-space facing hd, seen at an angle) and the layers slide out like nested bowls
    this.dir = E[0].clone().add(E[1]).add(E[2]).normalize(); const up = Math.abs(this.dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, this.dir).normalize();
    this.hd = this.dir.clone().multiplyScalar(0.5).addScaledVector(right, 0.87).normalize(); this.hu = new THREE.Vector3().crossVectors(this.hd, up).normalize(); this.hv = new THREE.Vector3().crossVectors(this.hd, this.hu);
    const U = this.U = { t: { value: 0 }, ce1: { value: E[0] }, ce2: { value: E[1] }, ce3: { value: E[2] }, cd: { value: this.hd }, uHalf: { value: 0 }, uRot: { value: new THREE.Matrix3() } };
    const N = def.layers.length; this.layers = def.layers.map((ly, i) => {
      const g = new THREE.Group(); this.group.add(g); const base = { ...U, kind: { value: ly.kind }, r0: { value: ly.r0 }, r1: { value: ly.r1 }, ca: { value: new THREE.Color(ly.a) }, cb: { value: new THREE.Color(ly.b) } };
      const mat = (mode, side = THREE.FrontSide) => new THREE.ShaderMaterial({ uniforms: { ...base, mode: { value: mode } }, vertexShader: VS, fragmentShader: FS, side });
      const fm = mat(0, THREE.DoubleSide); // the three cut faces (quarter rings), baked into layer coordinates
      for (const [u, v] of [[E[0], E[1]], [E[0], E[2]], [E[1], E[2]]]) { const w = new THREE.Vector3().crossVectors(u, v), geo = new THREE.RingGeometry(Math.max(ly.r0, 1e-4), ly.r1, 160, 2, 0, Math.PI / 2);
        geo.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, w)); const third = E.find(e => Math.abs(e.dot(w)) > 0.9); geo.translate(...third.clone().multiplyScalar(-0.0004).toArray()); const m = new THREE.Mesh(geo, fm); m.userData.oct = true; g.add(m); }
      { const geo = new THREE.RingGeometry(Math.max(ly.r0, 1e-4), ly.r1, 256, 2); geo.applyMatrix4(new THREE.Matrix4().makeBasis(this.hu, this.hv, this.hd)); geo.translate(...this.hd.clone().multiplyScalar(-0.0004).toArray()); const m = new THREE.Mesh(geo, fm); m.userData.half = true; m.visible = false; g.add(m); }
      const outer = i === N - 1 ? (surface ? (() => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), typeof surface === 'function' ? surface(U) : surface); if (surfRot) { m.quaternion.copy(surfRot); U.uRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(surfRot)); } return m; })() : null)
        : new THREE.Mesh(new THREE.SphereGeometry(ly.r1, 96, 48), mat(1));
      if (outer) g.add(outer); if (ly.r0 > 0.01) { const inner = new THREE.Mesh(new THREE.SphereGeometry(ly.r0, 96, 48), mat(2, THREE.BackSide)); inner.userData.wall = true; g.add(inner); }
      return { ly, g, outer, i, w: (N - 1 - i) / Math.max(1, N - 1) }; });
    // particles: convection loops in solid mantles / convective zones, swirling flow in liquid layers
    const sp = []; const n = LOW ? 0.5 : 1;
    this.layers.forEach(Lr => { const { ly } = Lr, th = ly.r1 - ly.r0; if (th < 0.12) return; const faces = [[E[0], E[1], E[2]], [E[0], E[2], E[1]], [E[1], E[2], E[0]]];
      const hu = this.hu, hv = this.hv, hd = this.hd, quads = [[hu, hv], [hv, hu.clone().negate()], [hu.clone().negate(), hv.clone().negate()], [hv.clone().negate(), hu]].map(([a, b]) => [a, b, hd, 1]);
      [...faces.map(f => [...f, 0]), ...quads].forEach(([u, v, nrm, hm], fi) => { if (ly.kind === 1 || ly.kind === 9) { const cells = Math.max(2, Math.round(th * 7)), r0 = ly.r0 + th * 0.06, r1 = ly.r1 - th * 0.06;
          for (let i = 0; i < cells; i++) for (let Lp = 0.3; Lp < 1.0; Lp += 0.14) for (let k = 0; k < 12 * n; k++) sp.push({ Lr, u, v, nrm, kind: 0, pc: (i + 0.5) * Math.PI / 2 / cells, rc: (r0 + r1) / 2, ap: Math.PI / 4 / cells * 0.88, ar: (r1 - r0) / 2 * 0.92, L: Lp, s: k / (12 * n) * 2 * Math.PI + Lp * 3, dir: (i + fi) % 2 ? 1 : -1, hot: ly.kind === 9, hm }); }
        else if ([2, 5, 6].includes(ly.kind)) for (let k = 0; k < 120 * n * th / 0.35; k++) sp.push({ Lr, u, v, nrm, kind: 1, p: Math.random() * Math.PI / 2, r: ly.r0 + th * (0.05 + Math.random() * 0.9), w: 0.1 + Math.random() * 0.1, col: new THREE.Color(ly.b).lerp(new THREE.Color('#ffffff'), 0.5), hm }); }); });
    sp.sort((a, b) => a.hm - b.hm); this.nOct = sp.filter(p => !p.hm).length;
    this.sp = sp;
    if (sp.length) { const g = new THREE.BufferGeometry(); g.setDrawRange(0, this.nOct); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(sp.length * 3), 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(sp.length * 3), 3));
      this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })); this.pts.frustumCulled = false; this.pts.renderOrder = 2; this.group.add(this.pts); }
    this.lab = document.createElement('div'); this.lab.className = 'insLabels'; this.lab.hidden = true; document.body.appendChild(this.lab);
  }
  setOn(on) { this.group.visible = on; this.lab.hidden = !on; if (!on) this._h = ''; }
  setSplit(s) { this.split = s; const h = s > 0.005; this.U.uHalf.value = h ? 1 : 0;
    for (const L of this.layers) { L.g.position.copy(this.hd).multiplyScalar(s * L.w * 1.7); for (const m of L.g.children) { if (m.userData.wall) m.visible = h; if (m.userData.oct) m.visible = !h; if (m.userData.half) m.visible = h; } if (L.outer && L.i < this.layers.length - 1) L.outer.visible = h; }
    if (this.pts) this.pts.geometry.setDrawRange(h ? this.nOct : 0, h ? this.sp.length - this.nOct : this.nOct); }
  anim(dt) { this.U.t.value += dt * this.speed; const t = dt * this.speed; if (!this.pts) return;
    const P = this.pts.geometry.attributes.position, C = this.pts.geometry.attributes.color, v = new THREE.Vector3();
    const h = this.U.uHalf.value > 0.5; this.sp.forEach((s, i) => { if (!!s.hm !== h) return; let r, p, col;
      if (s.kind === 0) { s.s += t * 0.35 * s.dir; const cs = Math.cos(s.s), sn = Math.sin(s.s); p = s.pc + s.ap * s.L * cs; r = s.rc + s.ar * s.L * sn; const up = cs * s.dir;
        col = up > 0 ? (s.hot ? [1, 0.95, 0.6] : [1, 0.85 + 0.15 * up, 0.35]) : (s.hot ? [0.6, 0.15, 0.05] : [0.35 + 0.2 * (1 + up), 0.12, 0.08]); }
      else { s.p += t * s.w; if (s.p > Math.PI / 2) s.p -= Math.PI / 2; p = s.p; r = s.r; col = [s.col.r, s.col.g, s.col.b]; }
      v.copy(s.u).multiplyScalar(r * Math.cos(p)).addScaledVector(s.v, r * Math.sin(p)).addScaledVector(s.nrm, 0.003).add(s.Lr.g.position); P.setXYZ(i, v.x, v.y, v.z); C.setXYZ(i, ...col); });
    P.needsUpdate = true; C.needsUpdate = true; }
  // labels on the cut, kept apart on screen; R in km for depths; extra(): more HTML
  labels(cam, el, names, extra = '') {
    if (!this.group.visible) return; const rc = el.getBoundingClientRect(), out = [], v = new THREE.Vector3(), N = this.layers.length, R = this.def.R; this.group.updateMatrixWorld();
    for (const L of this.layers) { const { ly } = L, mid = (ly.r0 + ly.r1) / 2, ang = 0.18 + 1.2 * L.i / Math.max(1, N - 1), hf = this.U.uHalf.value > 0.5; v.copy(hf ? this.hu : this.E[0]).multiplyScalar(mid * Math.cos(hf ? ang * 2 - 1.2 : ang)).addScaledVector(hf ? this.hv : this.E[1], mid * Math.sin(hf ? ang * 2 - 1.2 : ang)).add(L.g.position);
      this.group.localToWorld(v).project(cam); if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue; const a = Math.round((1 - ly.r1) * R), b = Math.round((1 - ly.r0) * R);
      out.push([(v.x + 1) / 2 * rc.width + rc.left, (1 - v.y) / 2 * rc.height + rc.top, `${names(ly.en, ly.km)} <i>${a.toLocaleString()}–${b.toLocaleString()} km</i>`]); }
    out.sort((p, q) => p[1] - q[1]); for (let i = 1; i < out.length; i++) if (Math.abs(out[i][0] - out[i - 1][0]) < 170 && out[i][1] - out[i - 1][1] < 17) out[i][1] = out[i - 1][1] + 17;
    const h = out.map(([x, y, s]) => `<span style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px">${s}</span>`).join('') + extra; if (h !== this._h) { this.lab.innerHTML = h; this._h = h; } }
  dispose() { this.lab.remove(); this.group.parent && this.group.parent.remove(this.group); this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); }
}
