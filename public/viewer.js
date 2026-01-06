import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.164.1/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "https://unpkg.com/three@0.164.1/examples/jsm/loaders/OBJLoader.js";

const container = document.getElementById("viewer");
if (!container) {
  throw new Error("Viewer container not found.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5e4b9);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
camera.position.set(0, 180, 360);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 150;
controls.maxDistance = 600;
controls.maxPolarAngle = Math.PI * 0.48;

const ambient = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(120, 200, 120);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-120, 120, 80);
scene.add(fillLight);

const clock = new THREE.Clock();
let mixer = null;
let modelRoot = null;
let fallbackSpin = false;

const loader = new OBJLoader();
loader.load(
  "/guilmon.obj",
  (obj) => {
    modelRoot = obj;
    modelRoot.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    scene.add(modelRoot);

    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelRoot.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scaleFactor = 240 / maxDim;
      modelRoot.scale.setScalar(scaleFactor);
    }

    const scaledBox = new THREE.Box3().setFromObject(modelRoot);
    const scaledSize = scaledBox.getSize(new THREE.Vector3());
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    modelRoot.position.sub(scaledCenter);

    const scaledMax = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
    const fitDist = scaledMax * 2.2;
    camera.near = Math.max(0.1, scaledMax / 1000);
    camera.far = Math.max(2000, scaledMax * 6);
    camera.position.set(0, scaledSize.y * 0.7, fitDist);
    controls.target.set(0, scaledSize.y * 0.4, 0);
    camera.updateProjectionMatrix();
    controls.update();

    fallbackSpin = true;
  },
  undefined,
  (error) => {
    console.error("OBJ load error", error);
  }
);

const resize = () => {
  const { clientWidth, clientHeight } = container;
  if (clientWidth === 0 || clientHeight === 0) return;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
};

window.addEventListener("resize", resize);
resize();

const animate = () => {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (mixer) {
    mixer.update(delta);
  } else if (fallbackSpin && modelRoot) {
    modelRoot.rotation.y += delta * 0.4;
  }
  controls.update();
  renderer.render(scene, camera);
};

animate();
