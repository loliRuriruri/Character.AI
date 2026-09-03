import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { mixamoVRMRigMap } from "./mixamoVRMRigMap";

// In-memory cache for retargeted AnimationClips (keyed by model instance UUID)
const clipCache = new Map<string, THREE.AnimationClip>();

export function clearMixamoClipCache(): void {
  clipCache.clear();
}

/**
 * Load Mixamo FBX animation, retarget to VRM Humanoid Normalized Rig at runtime,
 * and filter unwanted tracks (hips.position, expression, lookAt) according to strict rules.
 */
export async function loadMixamoAnimation(
  url: string,
  vrm: VRM,
  clipName: string
): Promise<THREE.AnimationClip> {
  const cacheKey = `${vrm.scene.uuid}:${clipName}:${url}`;
  if (clipCache.has(cacheKey)) {
    return clipCache.get(cacheKey)!;
  }

  const loader = new FBXLoader();
  const asset = await loader.loadAsync(url);
  const rawClip =
    THREE.AnimationClip.findByName(asset.animations, "mixamo.com") ||
    asset.animations[0];

  if (!rawClip) {
    throw new Error(`[loadMixamoAnimation] No animation clip found in FBX: ${url}`);
  }

  const rawTrackCount = rawClip.tracks.length;
  const tracks: THREE.KeyframeTrack[] = [];

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();

  // Hips height scale adjustment
  const mixamoHips = asset.getObjectByName("mixamorigHips");
  const motionHipsHeight = mixamoHips ? mixamoHips.position.y : 100.0;
  const vrmHipsNode = vrm.humanoid?.getNormalizedBoneNode("hips");
  const vrmHipsHeight = vrmHipsNode ? vrmHipsNode.getWorldPosition(_vec3).y : 0.85;
  const hipsPositionScale = motionHipsHeight !== 0 ? vrmHipsHeight / motionHipsHeight : 0.01;

  const isVRM0 = vrm.meta?.metaVersion === "0";

  rawClip.tracks.forEach((track) => {
    const trackSplitted = track.name.split(".");
    const mixamoRigName = trackSplitted[0];
    const propertyName = trackSplitted[1];
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
    const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName as any);
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);

    if (!vrmNode || !mixamoRigNode) return;
    const vrmNodeName = vrmNode.name;

    // RULE 3 & 4: Permanent elimination of hips.position track to prevent root motion displacement
    if (vrmBoneName === "hips" && propertyName === "position") {
      return;
    }

    // RULE 4: Filter out any lookAt or expression tracks
    if (
      track.name.includes("VRMLookAtQuaternionProxy") ||
      track.name.includes("expression") ||
      track.name.includes("blendShape")
    ) {
      return;
    }

    // Capture rest-pose rotations
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    if (mixamoRigNode.parent) {
      mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
    } else {
      parentRestWorldRotation.identity();
    }

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const clonedValues = track.values.slice();

      for (let i = 0; i < clonedValues.length; i += 4) {
        _quatA.fromArray(clonedValues, i);

        // parentRestWorldRotation * trackRotation * restRotationInverse
        _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);

        _quatA.toArray(clonedValues, i);
      }

      // VRM 0.0 Sign Inversion: negate X and Z (indices 0 and 2 modulo 4)
      const finalValues = clonedValues.map((v, i) =>
        isVRM0 && i % 2 === 0 ? -v : v
      );

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${vrmNodeName}.${propertyName}`,
          track.times,
          finalValues
        )
      );
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      // Scale position and invert X/Z for VRM 0.0
      const finalValues = track.values.map(
        (v, i) => (isVRM0 && i % 3 !== 1 ? -v : v) * hipsPositionScale
      );
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${vrmNodeName}.${propertyName}`,
          track.times,
          finalValues
        )
      );
    }
  });

  const convertedClip = new THREE.AnimationClip(clipName, rawClip.duration, tracks);
  clipCache.set(cacheKey, convertedClip);

  console.log(
    `[loadMixamoAnimation] Retargeted '${clipName}' (${rawClip.duration.toFixed(2)}s): ` +
    `raw tracks ${rawTrackCount} -> filtered tracks ${tracks.length} ` +
    `(hips.position, expression, lookAt removed: ${rawTrackCount - tracks.length})`
  );

  return convertedClip;
}
