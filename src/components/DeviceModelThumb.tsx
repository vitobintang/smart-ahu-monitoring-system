"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AhuStatus } from "@/lib/ahu";
import { buildAhuModel3D, disposeGroupDeep } from "@/components/ahu-model-builders";

/**
 * DeviceModelThumb — the dashboard-card replacement for the old static
 * unit-iso PNG (2026-11-11): each card renders ITS OWN device's 3D exterior
 * (the same models placed in the 3D facility room), auto-framed and lit.
 *
 * While the device is RUN the fans spin, louvers oscillate and the exhaust
 * plume streams — the animation is the status indicator. While STOPPED the
 * scene renders a single settling frame and then goes fully idle (no rAF),
 * so a whole dashboard of thumbnails costs almost nothing on the GPU.
 */

export default function DeviceModelThumb({
  deviceType,
  status,
  className,
}: {
  deviceType?: string | null;
  status: AhuStatus;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const type =
      deviceType === "AC_DAK" || deviceType === "AC_SPLIT_WALL" || deviceType === "AC_STANDING" ? deviceType : "AHU";
    let disposed = false;

    const width = Math.max(96, mount.clientWidth);
    const height = Math.max(64, mount.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 60);

    // same daylight rig as the facility room, scaled down
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(4, 7, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x93c5fd, 0.75);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    const built = buildAhuModel3D({ id: `thumb-${type}`, status, hasHeater: true, outdoor: false, deviceType: type });
    scene.add(built.group);

    // auto-frame the model (slim wall split fills the thumb just like the AHU does)
    built.group.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(built.group);
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.22;
    const viewDir =
      type === "AC_SPLIT_WALL"
        ? new THREE.Vector3(0.5, 0.3, 1.3)
        : type === "AC_DAK"
          ? new THREE.Vector3(0.95, 1.05, 0.8)
          : type === "AC_STANDING"
            ? new THREE.Vector3(1.0, 0.45, 1.15)
            : new THREE.Vector3(1, 0.55, 1);
    camera.position.copy(sphere.center).addScaledVector(viewDir.normalize(), dist);
    camera.lookAt(sphere.center);

    const running = status === "RUN";
    let raf = 0;
    let fanAngle = 0;
    let last = performance.now();
    let elapsed = 0;
    let settleFrames = 3; // non-RUN: render a few frames then go fully idle

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      fanAngle += dt * 7.5;
      for (const r of built.rotors) {
        r.obj.rotation[r.axis] = -fanAngle;
      }
      built.flaps.forEach((flap, i) => {
        const ud = flap.userData as { oscAxis?: "x" | "z"; oscBase?: number; oscPhase?: number };
        const axis = ud.oscAxis ?? "x";
        const base = ud.oscBase ?? 0;
        flap.rotation[axis] = base + Math.sin(elapsed * 1.8 + (ud.oscPhase ?? i * 1.3)) * 0.3;
      });
      built.airflow?.update(dt, true);
      renderer.render(scene, camera);
      if (running) {
        raf = requestAnimationFrame(tick);
      } else if (settleFrames > 0) {
        settleFrames -= 1;
        raf = requestAnimationFrame(tick);
      }
    };
    tick();

    const onResize = () => {
      if (disposed || !mount) return;
      const w = Math.max(96, mount.clientWidth);
      const h = Math.max(64, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    resizeObserver?.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      disposeGroupDeep(built.group);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [deviceType, status]);

  return (
    <div
      ref={mountRef}
      data-device-thumb={deviceType ?? "AHU"}
      aria-hidden
      className={className ?? "h-full w-full"}
    />
  );
}
