"""Detección de landmarks corporales con MediaPipe Pose."""
from typing import Optional

import mediapipe as mp
import numpy as np
from PIL import Image

mp_pose = mp.solutions.pose

# Puntos que necesitamos para armar el esqueleto de corte (nombre -> índice MediaPipe).
_LANDMARK_NAMES = {
    "nose": mp_pose.PoseLandmark.NOSE,
    "left_ear": mp_pose.PoseLandmark.LEFT_EAR,
    "right_ear": mp_pose.PoseLandmark.RIGHT_EAR,
    "left_shoulder": mp_pose.PoseLandmark.LEFT_SHOULDER,
    "right_shoulder": mp_pose.PoseLandmark.RIGHT_SHOULDER,
    "left_elbow": mp_pose.PoseLandmark.LEFT_ELBOW,
    "right_elbow": mp_pose.PoseLandmark.RIGHT_ELBOW,
    "left_wrist": mp_pose.PoseLandmark.LEFT_WRIST,
    "right_wrist": mp_pose.PoseLandmark.RIGHT_WRIST,
    "left_hip": mp_pose.PoseLandmark.LEFT_HIP,
    "right_hip": mp_pose.PoseLandmark.RIGHT_HIP,
    "left_knee": mp_pose.PoseLandmark.LEFT_KNEE,
    "right_knee": mp_pose.PoseLandmark.RIGHT_KNEE,
    "left_ankle": mp_pose.PoseLandmark.LEFT_ANKLE,
    "right_ankle": mp_pose.PoseLandmark.RIGHT_ANKLE,
    "left_heel": mp_pose.PoseLandmark.LEFT_HEEL,
    "right_heel": mp_pose.PoseLandmark.RIGHT_HEEL,
    "left_foot_index": mp_pose.PoseLandmark.LEFT_FOOT_INDEX,
    "right_foot_index": mp_pose.PoseLandmark.RIGHT_FOOT_INDEX,
}


def detect_landmarks(rgb_image: Image.Image) -> Optional[dict[str, tuple[float, float]]]:
    """Devuelve {nombre: (x_px, y_px)} en coordenadas de píxel de la imagen dada.

    None si no se detecta a nadie con suficiente confianza.
    """
    array = np.array(rgb_image.convert("RGB"))
    h, w = array.shape[:2]

    with mp_pose.Pose(static_image_mode=True, model_complexity=1, min_detection_confidence=0.5) as pose:
        result = pose.process(array)

    if not result.pose_landmarks:
        return None

    points: dict[str, tuple[float, float]] = {}
    for name, idx in _LANDMARK_NAMES.items():
        lm = result.pose_landmarks.landmark[idx]
        if lm.visibility < 0.3:
            return None
        points[name] = (lm.x * w, lm.y * h)
    return points
