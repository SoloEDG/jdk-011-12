import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { blockMeshes, disposeGroup } from "./meshes";
import type { Workspace, Vec3 } from "../../../shared/document";
import type { SceneHit } from "../../../shared/commands";
export function mountScene(
  host: HTMLElement,
  state: Workspace,
  onHit: (hit: SceneHit) => void,
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dce5df");
  scene.fog = new THREE.Fog("#dce5df", 55, 110);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.set(30, 27, 34);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 8;
  controls.maxDistance = 70;
  controls.enableDamping = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  scene.add(new THREE.HemisphereLight("#fffae8", "#779082", 2.5));
  const sun = new THREE.DirectionalLight("#fff1d5", 3);
  sun.position.set(-15, 32, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -25,
    right: 25,
    top: 25,
    bottom: -25,
  });
  sun.shadow.bias = -0.001;
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: "#cdd8d0", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(32, 32, "#abb9ad", "#c3cec3");
  grid.position.y = 0.005;
  scene.add(grid);
  let blocks = blockMeshes(state.doc);
  scene.add(blocks);
  const cursor = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: "#e9b261", wireframe: true }),
  );
  cursor.visible = false;
  scene.add(cursor);
  const region = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: "#eab569",
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  );
  region.visible = false;
  scene.add(region);
  const avatar = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.95, 0.38),
    new THREE.MeshStandardMaterial({ color: "#df8d4d" }),
  );
  body.position.y = 0.7;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.46),
    new THREE.MeshStandardMaterial({ color: "#f1ceac" }),
  );
  head.position.y = 1.4;
  avatar.add(body, head);
  scene.add(avatar);
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const pointer = { x: 0, y: 0, inside: false };
  let revision = state.doc.revision;
  let hoverDirty = true;
  let hoverRevision = -1;
  let hoverTool = state.tool;
  // Keep the instanced meshes in lockstep with the document so a pick can never
  // target a block that was already removed (or miss one that was just placed).
  const syncWorld = () => {
    if (revision === state.doc.revision) return;
    scene.remove(blocks);
    disposeGroup(blocks);
    blocks = blockMeshes(state.doc);
    scene.add(blocks);
    revision = state.doc.revision;
  };
  // Re-pick against the camera and block meshes as they are right now, never a
  // cached target: after an edit, a zoom, a drag or a world load the view and
  // the world both change, so a stale hit would edit the wrong cell.
  const pickAt = (clientX: number, clientY: number): SceneHit | null => {
    const r = renderer.domElement.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    if (
      clientX < r.left ||
      clientX > r.right ||
      clientY < r.top ||
      clientY > r.bottom
    )
      return null;
    syncWorld();
    mouse.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      (-(clientY - r.top) / r.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    ray.setFromCamera(mouse, camera);
    scene.updateMatrixWorld();
    // Nearest hit wins regardless of material: glass is picked exactly like an
    // opaque block, and the block revealed behind a removed one is hit next.
    const intersect = ray
      .intersectObjects(blocks.children, false)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!intersect || intersect.instanceId === undefined || !intersect.face)
      return null;
    const cell = intersect.object.userData.cells[intersect.instanceId] as Vec3;
    if (!cell) return null;
    const n = intersect.face.normal;
    return {
      cell: { x: cell.x, y: cell.y, z: cell.z },
      adjacent: { x: cell.x + n.x, y: cell.y + n.y, z: cell.z + n.z },
    };
  };
  // A press counts as a click only if the pointer never travelled far while the
  // button was down, so an orbit that wanders and comes back cannot also build.
  let press = { x: 0, y: 0, button: -1, travelled: 0 };
  const trackDrag = (e: PointerEvent) => {
    press.travelled = Math.max(
      press.travelled,
      Math.hypot(e.clientX - press.x, e.clientY - press.y),
    );
  };
  const move = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    hoverDirty = true;
    if (press.button >= 0) trackDrag(e);
  };
  const leave = () => {
    pointer.inside = false;
    hoverDirty = true;
  };
  const cancel = () => {
    press = { x: press.x, y: press.y, button: -1, travelled: 0 };
    hoverDirty = true;
  };
  const start = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    press = { x: e.clientX, y: e.clientY, button: e.button, travelled: 0 };
    hoverDirty = true;
  };
  const click = (e: PointerEvent) => {
    trackDrag(e);
    // Ignore releases of unrelated buttons while the main press is still held.
    if (e.button !== press.button) return;
    const wasLeftPress = press.button === 0;
    const dragged = press.travelled >= 5;
    press = { x: e.clientX, y: e.clientY, button: -1, travelled: 0 };
    // A drag is always a camera orbit/pan, never an edit. A genuine click is
    // resolved once, here, from the release position and whatever the camera
    // and world look like at this instant.
    if (!wasLeftPress || dragged || state.mode !== "build") return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    const target = pickAt(e.clientX, e.clientY);
    hoverDirty = true;
    if (target) onHit(target);
  };
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerenter", move);
  renderer.domElement.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("pointerdown", start);
  renderer.domElement.addEventListener("pointerup", click);
  renderer.domElement.addEventListener("pointercancel", cancel);
  const resize = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    hoverDirty = true;
  });
  resize.observe(host);
  const refreshHover = () => {
    const next = pointer.inside ? pickAt(pointer.x, pointer.y) : null;
    // The preview is what a click at this pointer position would act on: the
    // same hit the click handler re-picks, so highlight and result never drift.
    if (next) {
      const p = state.tool === "place" ? next.adjacent : next.cell;
      cursor.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5);
    }
    cursor.visible = !!next;
  };
  let frame = 0;
  function animate() {
    frame = requestAnimationFrame(animate);
    syncWorld();
    avatar.position.set(
      state.doc.player.x,
      state.doc.player.y,
      state.doc.player.z,
    );
    if (state.region) {
      const { a, b } = state.region;
      region.visible = true;
      region.position.set(
        (a.x + b.x + 1) / 2,
        (a.y + b.y + 1) / 2,
        (a.z + b.z + 1) / 2,
      );
      region.scale.set(
        Math.abs(a.x - b.x) + 1,
        Math.abs(a.y - b.y) + 1,
        Math.abs(a.z - b.z) + 1,
      );
    } else region.visible = false;
    // Damping keeps moving the camera for several frames after a wheel or drag,
    // so the preview must follow the settled view, not just pointer movement.
    const moved = controls.update();
    if (
      moved ||
      hoverDirty ||
      revision !== hoverRevision ||
      hoverTool !== state.tool
    ) {
      refreshHover();
      hoverDirty = false;
      hoverRevision = revision;
      hoverTool = state.tool;
    }
    renderer.render(scene, camera);
  }
  animate();
  return {
    reset() {
      camera.position.set(30, 27, 34);
      controls.target.set(0, 2, 0);
      hoverDirty = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      disposeGroup(blocks);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
